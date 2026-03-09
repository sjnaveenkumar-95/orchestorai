import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  agentSlackApps,
  agents,
  authUsers,
  companies,
  heartbeatRuns,
  projectMembers,
  projectSlackChannels,
  projectSlackMemberships,
  projects,
  slackEventReceipts,
  slackThreadLinks,
} from "@paperclipai/db";
import type {
  AgentSlackApp,
  LiveEvent,
  ProjectSlackChannel,
  ProjectSlackMembership,
  ProjectSlackState,
  SlackThreadLink,
} from "@paperclipai/shared";
import { buildProjectSlackChannelName } from "@paperclipai/shared";
import { createInstanceSettingsService } from "./instance-settings.js";
import { logger } from "../middleware/logger.js";
import { secretService } from "./secrets.js";
import { loadConfig } from "../config.js";
import { notFound, unprocessable } from "../errors.js";
import { heartbeatService } from "./heartbeat.js";
import { issueService } from "./issues.js";
import { logActivity } from "./activity-log.js";
import { subscribeAllLiveEvents } from "./live-events.js";

type ActorRef = {
  userId?: string | null;
  agentId?: string | null;
};

type SlackControlMessageEvent = {
  type: string;
  channel?: string;
  text?: string;
  ts?: string;
  thread_ts?: string;
  user?: string;
  bot_id?: string;
  subtype?: string;
};

type SlackControlEventEnvelope = {
  type: string;
  challenge?: string;
  event_id?: string;
  event_time?: number;
  api_app_id?: string;
  event?: SlackControlMessageEvent;
};

type SlackIssue = {
  id: string;
  companyId: string;
  projectId: string | null;
  identifier: string | null;
  title: string;
  status: string;
  priority: string;
  assigneeAgentId: string | null;
  assigneeUserId: string | null;
};

const liveEventForwarderDbs = new WeakSet<object>();
const issueThreadLinkInFlight = new Map<string, Promise<SlackThreadLink | null>>();
const projectChannelEnsureInFlight = new Map<string, Promise<ProjectSlackChannel | null>>();
const SLACK_FORWARDER_STATE_KEY = "__paperclipSlackForwarderState";

type SlackForwarderState = {
  db: object | null;
  unsubscribe: (() => void) | null;
};

class SlackApiError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly responseBody: unknown,
  ) {
    super(message);
    this.name = "SlackApiError";
  }
}

class SlackWebClient {
  constructor(private readonly token: string) {}

  private async callQuery<T extends { ok: boolean; error?: string }>(
    method: string,
    query: Record<string, string>,
  ): Promise<T> {
    const url = new URL(`https://slack.com/api/${method}`);
    for (const [key, value] of Object.entries(query)) {
      url.searchParams.set(key, value);
    }

    const response = await fetch(url, {
      headers: {
        authorization: `Bearer ${this.token}`,
      },
    });
    const json = (await response.json()) as T;
    if (!response.ok || !json.ok) {
      throw new SlackApiError(
        `Slack API call failed: ${method}`,
        json.error ?? `http_${response.status}`,
        json,
      );
    }
    return json;
  }

  private async callJson<T extends { ok: boolean; error?: string }>(
    method: string,
    payload: Record<string, unknown>,
  ): Promise<T> {
    const response = await fetch(`https://slack.com/api/${method}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.token}`,
        "content-type": "application/json; charset=utf-8",
      },
      body: JSON.stringify(payload),
    });
    const json = (await response.json()) as T;
    if (!response.ok || !json.ok) {
      throw new SlackApiError(
        `Slack API call failed: ${method}`,
        json.error ?? `http_${response.status}`,
        json,
      );
    }
    return json;
  }

  async createChannel(input: { name: string; isPrivate: boolean }) {
    return this.callJson<{
      ok: boolean;
      error?: string;
      channel: { id: string; name: string };
    }>("conversations.create", {
      name: input.name,
      is_private: input.isPrivate,
    });
  }

  async listChannels(input: {
    cursor?: string;
    excludeArchived?: boolean;
    types?: Array<"public_channel" | "private_channel">;
    limit?: number;
  } = {}) {
    return this.callQuery<{
      ok: boolean;
      error?: string;
      channels?: Array<{
        id: string;
        name: string;
        is_archived?: boolean;
        is_private?: boolean;
      }>;
      response_metadata?: {
        next_cursor?: string;
      };
    }>("conversations.list", {
      exclude_archived: String(input.excludeArchived ?? false),
      types: (input.types ?? ["public_channel", "private_channel"]).join(","),
      limit: String(input.limit ?? 1000),
      ...(input.cursor ? { cursor: input.cursor } : {}),
    });
  }

  async archiveChannel(channel: string) {
    await this.callJson("conversations.archive", {
      channel,
    });
  }

  async unarchiveChannel(channel: string) {
    await this.callJson("conversations.unarchive", {
      channel,
    });
  }

  async renameChannel(channel: string, name: string) {
    return this.callJson<{
      ok: boolean;
      error?: string;
      channel: { id: string; name: string };
    }>("conversations.rename", {
      channel,
      name,
    });
  }

  async inviteUsers(channel: string, userIds: string[]) {
    if (userIds.length === 0) return;
    await this.callJson("conversations.invite", {
      channel,
      users: userIds.join(","),
    });
  }

  async kickUser(channel: string, userId: string) {
    await this.callJson("conversations.kick", {
      channel,
      user: userId,
    });
  }

  async postMessage(input: { channel: string; text: string; threadTs?: string | null }) {
    const json = await this.callJson<{
      ok: boolean;
      error?: string;
      channel: string;
      ts: string;
      message?: { thread_ts?: string };
    }>("chat.postMessage", {
      channel: input.channel,
      text: input.text,
      ...(input.threadTs ? { thread_ts: input.threadTs } : {}),
    });
    return {
      channel: json.channel,
      ts: json.ts,
      threadTs: json.message?.thread_ts ?? input.threadTs ?? json.ts,
    };
  }
}

function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : value.slice(0, maxLength);
}

function buildSlackAppName(agentName: string): string {
  const trimmed = agentName.trim() || "Agent";
  return truncate(trimmed, 35);
}

function buildSlackBotDisplayName(agentName: string): string {
  return truncate(agentName.trim() || "Agent", 80);
}

function buildArchivedSlackChannelPlaceholderName(projectId: string, attempt: number) {
  const base = `paperclip-archived-${projectId.toLowerCase().slice(0, 8)}`;
  return truncate(
    attempt <= 1 ? base : `${base}-${attempt.toString(36)}`,
    80,
  );
}

function createAgentSlackSecretName(agentId: string, kind: "client-secret" | "bot-token" | "signing-secret") {
  return `slack/agents/${agentId}/${kind}`;
}

function parseObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function readNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function stripLeadingSlackMentions(text: string) {
  return text.replace(/^(?:<@[A-Z0-9]+>\s*)+/gi, "").trim();
}

function parseSlackMemberIds(value: string | null | undefined) {
  if (!value) return [];
  return Array.from(
    new Set(
      value
        .split(/[\s,]+/)
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0),
    ),
  );
}

function toSlackThreadLink(row: typeof slackThreadLinks.$inferSelect): SlackThreadLink {
  return {
    id: row.id,
    companyId: row.companyId,
    issueId: row.issueId,
    projectId: row.projectId,
    projectSlackChannelId: row.projectSlackChannelId,
    channelId: row.channelId,
    threadTs: row.threadTs,
    active: row.active,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function buildSlackOriginDescription(input: {
  text: string;
  slackUserId?: string | null;
  channelId: string;
  threadTs: string;
}) {
  return [
    "_Created from Slack_",
    `Slack user: ${input.slackUserId ? `<@${input.slackUserId}>` : "unknown-user"}`,
    `Slack channel: ${input.channelId}`,
    `Slack thread: ${input.threadTs}`,
    "",
    input.text.trim(),
  ].join("\n");
}

function buildSlackCommentBody(input: {
  text: string;
  slackUserId?: string | null;
  channelId: string;
  threadTs: string;
}) {
  return [
    `Slack reply from ${input.slackUserId ? `<@${input.slackUserId}>` : "unknown-user"}`,
    `Channel: ${input.channelId}`,
    `Thread: ${input.threadTs}`,
    "",
    input.text.trim(),
  ].join("\n");
}

type SlackChannelLookup = {
  id: string;
  name: string;
  isArchived: boolean;
  isPrivate: boolean;
};

function extractSlackTaskFields(text: string) {
  const normalized = stripLeadingSlackMentions(text);
  const match = /^task:\s*(.+)$/is.exec(normalized);
  if (!match) return null;
  const body = match[1]?.trim() ?? "";
  if (!body) return null;
  const [rawTitle, ...restLines] = body.split(/\r?\n/);
  const title = rawTitle?.trim() ?? "";
  if (!title) return null;
  const description = restLines.join("\n").trim() || null;
  return { title, description, sourceText: body };
}

function issueDisplay(issue: Pick<SlackIssue, "id" | "identifier" | "title">) {
  return `${issue.identifier ?? issue.id} - ${issue.title}`;
}

function issueRootMessage(
  issue: Pick<SlackIssue, "id" | "identifier" | "title" | "status" | "priority">,
) {
  return [
    `Paperclip issue: *${issueDisplay(issue)}*`,
    `Status: \`${issue.status}\``,
    `Priority: \`${issue.priority}\``,
  ].join("\n");
}

function getSlackForwarderState() {
  const root = globalThis as typeof globalThis & {
    [SLACK_FORWARDER_STATE_KEY]?: SlackForwarderState;
  };
  if (!root[SLACK_FORWARDER_STATE_KEY]) {
    root[SLACK_FORWARDER_STATE_KEY] = {
      db: null,
      unsubscribe: null,
    };
  }
  return root[SLACK_FORWARDER_STATE_KEY];
}

function toAgentSlackApp(row: typeof agentSlackApps.$inferSelect): AgentSlackApp {
  return {
    id: row.id,
    companyId: row.companyId,
    agentId: row.agentId,
    slackAppId: row.slackAppId,
    clientId: row.clientId,
    botUserId: row.botUserId,
    teamId: row.teamId,
    installStatus: row.installStatus as AgentSlackApp["installStatus"],
    installUrl: row.installUrl,
    oauthState: row.oauthState,
    clientSecretSecretId: row.clientSecretSecretId,
    botTokenSecretId: row.botTokenSecretId,
    signingSecretSecretId: row.signingSecretSecretId,
    lastError: row.lastError,
    disabledAt: row.disabledAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toProjectSlackChannel(row: typeof projectSlackChannels.$inferSelect): ProjectSlackChannel {
  return {
    id: row.id,
    companyId: row.companyId,
    projectId: row.projectId,
    channelId: row.channelId,
    channelName: row.channelName,
    visibility: row.visibility as ProjectSlackChannel["visibility"],
    status: row.status as ProjectSlackChannel["status"],
    lastError: row.lastError,
    archivedAt: row.archivedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toProjectSlackMembership(row: typeof projectSlackMemberships.$inferSelect): ProjectSlackMembership {
  return {
    id: row.id,
    companyId: row.companyId,
    projectId: row.projectId,
    projectSlackChannelId: row.projectSlackChannelId,
    agentId: row.agentId,
    agentSlackAppId: row.agentSlackAppId,
    syncStatus: row.syncStatus as ProjectSlackMembership["syncStatus"],
    lastError: row.lastError,
    syncedAt: row.syncedAt,
    removedAt: row.removedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function resolvePublicBaseUrl() {
  const config = loadConfig();
  if (config.authPublicBaseUrl) {
    return config.authPublicBaseUrl.replace(/\/+$/, "");
  }
  return `http://localhost:${config.port}`;
}

function withOAuthState(installUrl: string, oauthState: string, redirectUri: string) {
  const url = new URL(installUrl);
  url.searchParams.set("state", oauthState);
  if (!url.searchParams.has("redirect_uri")) {
    url.searchParams.set("redirect_uri", redirectUri);
  }
  return url.toString();
}

async function slackManifestCreate(input: {
  manifestToken: string;
  manifest: Record<string, unknown>;
}) {
  const params = new URLSearchParams();
  params.set("manifest", JSON.stringify(input.manifest));
  const response = await fetch("https://slack.com/api/apps.manifest.create", {
    method: "POST",
    headers: {
      authorization: `Bearer ${input.manifestToken}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: params,
  });
  const json = (await response.json()) as {
    ok: boolean;
    error?: string;
    app_id?: string;
    oauth_authorize_url?: string;
    credentials?: {
      client_id?: string;
      client_secret?: string;
      signing_secret?: string;
    };
  };
  if (!response.ok || !json.ok) {
    throw new SlackApiError(
      "Slack API call failed: apps.manifest.create",
      json.error ?? `http_${response.status}`,
      json,
    );
  }
  return json;
}

async function slackOAuthExchange(input: {
  clientId: string;
  clientSecret: string;
  code: string;
  redirectUri: string;
}) {
  const params = new URLSearchParams();
  params.set("client_id", input.clientId);
  params.set("client_secret", input.clientSecret);
  params.set("code", input.code);
  params.set("redirect_uri", input.redirectUri);

  const response = await fetch("https://slack.com/api/oauth.v2.access", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
    },
    body: params,
  });
  const json = (await response.json()) as {
    ok: boolean;
    error?: string;
    access_token?: string;
    bot_user_id?: string;
    team?: { id?: string; name?: string };
  };
  if (!response.ok || !json.ok) {
    throw new SlackApiError(
      "Slack API call failed: oauth.v2.access",
      json.error ?? `http_${response.status}`,
      json,
    );
  }
  return json;
}

export function slackIntegrationService(db: Db) {
  const secretsSvc = secretService(db);
  const instanceSettings = createInstanceSettingsService();
  const heartbeat = heartbeatService(db);
  const issuesSvc = issueService(db);

  async function getAgentRow(agentId: string) {
    return db
      .select()
      .from(agents)
      .where(eq(agents.id, agentId))
      .then((rows) => rows[0] ?? null);
  }

  async function getProjectRow(projectId: string) {
    return db
      .select({
        id: projects.id,
        companyId: projects.companyId,
        name: projects.name,
        slackChannelVisibility: projects.slackChannelVisibility,
        slackChannelName: projects.slackChannelName,
        companyName: companies.name,
      })
      .from(projects)
      .innerJoin(companies, eq(projects.companyId, companies.id))
      .where(eq(projects.id, projectId))
      .then((rows) => rows[0] ?? null);
  }

  async function getAgentSlackApp(agentId: string): Promise<AgentSlackApp | null> {
    return db
      .select()
      .from(agentSlackApps)
      .where(eq(agentSlackApps.agentId, agentId))
      .then((rows) => (rows[0] ? toAgentSlackApp(rows[0]) : null));
  }

  async function getAgentSlackAppByState(oauthState: string) {
    return db
      .select()
      .from(agentSlackApps)
      .where(eq(agentSlackApps.oauthState, oauthState))
      .then((rows) => rows[0] ?? null);
  }

  async function upsertAgentSlackApp(
    agentId: string,
    input: Partial<typeof agentSlackApps.$inferInsert>,
  ): Promise<AgentSlackApp> {
    const agent = await getAgentRow(agentId);
    if (!agent) throw notFound("Agent not found");

    const existing = await getAgentSlackApp(agentId);
    if (existing) {
      const updated = await db
        .update(agentSlackApps)
        .set({
          ...input,
          updatedAt: new Date(),
        })
        .where(eq(agentSlackApps.id, existing.id))
        .returning()
        .then((rows) => rows[0] ?? null);
      if (!updated) throw notFound("Agent Slack app not found");
      return toAgentSlackApp(updated);
    }

    const created = await db
      .insert(agentSlackApps)
      .values({
        companyId: agent.companyId,
        agentId,
        installStatus: input.installStatus ?? "not_configured",
        slackAppId: input.slackAppId ?? null,
        clientId: input.clientId ?? null,
        botUserId: input.botUserId ?? null,
        teamId: input.teamId ?? null,
        installUrl: input.installUrl ?? null,
        oauthState: input.oauthState ?? null,
        clientSecretSecretId: input.clientSecretSecretId ?? null,
        botTokenSecretId: input.botTokenSecretId ?? null,
        signingSecretSecretId: input.signingSecretSecretId ?? null,
        lastError: input.lastError ?? null,
        disabledAt: input.disabledAt ?? null,
      })
      .returning()
      .then((rows) => rows[0] ?? null);
    if (!created) throw notFound("Failed to create agent Slack app");
    return toAgentSlackApp(created);
  }

  async function createOrRotateSecret(
    companyId: string,
    agentId: string,
    kind: "client-secret" | "bot-token" | "signing-secret",
    value: string,
    actor?: ActorRef,
  ) {
    const name = createAgentSlackSecretName(agentId, kind);
    const existing = await secretsSvc.getByName(companyId, name);
    if (existing) {
      return secretsSvc.rotate(
        existing.id,
        { value },
        actor,
      );
    }
    const config = loadConfig();
    return secretsSvc.create(
      companyId,
      {
        name,
        provider: config.secretsProvider,
        value,
        description: `Paperclip-managed Slack ${kind} for agent ${agentId}`,
      },
      actor,
    );
  }

  async function getControlClient() {
    const controlBotToken = instanceSettings.getRuntimeSecretValue("slackBotToken");
    return controlBotToken ? new SlackWebClient(controlBotToken) : null;
  }

  async function ensureConfiguredChannelMembers(input: {
    client: SlackWebClient;
    channelId: string;
    projectId: string;
  }) {
    const memberIds = parseSlackMemberIds(
      instanceSettings.getRuntimeValue("slackDefaultChannelMemberIds"),
    );
    for (const memberId of memberIds) {
      try {
        await input.client.inviteUsers(input.channelId, [memberId]);
      } catch (error) {
        const slackCode = error instanceof SlackApiError ? error.code : null;
        if (slackCode === "already_in_channel") {
          continue;
        }
        logger.warn(
          { err: error, projectId: input.projectId, channelId: input.channelId, memberId },
          "failed to invite configured Slack member into project channel",
        );
      }
    }
  }

  async function findArchivedChannelByName(
    client: SlackWebClient,
    name: string,
    visibility: "public" | "private",
  ): Promise<SlackChannelLookup | null> {
    let cursor: string | undefined;
    do {
      const result = await client.listChannels({
        cursor,
        excludeArchived: false,
      });
      const match = (result.channels ?? []).find((channel) => {
        if (channel.name !== name) return false;
        if (!channel.is_archived) return false;
        return visibility === "private"
          ? Boolean(channel.is_private)
          : !Boolean(channel.is_private);
      });
      if (match) {
        return {
          id: match.id,
          name: match.name,
          isArchived: Boolean(match.is_archived),
          isPrivate: Boolean(match.is_private),
        };
      }
      const nextCursor = result.response_metadata?.next_cursor?.trim();
      cursor = nextCursor ? nextCursor : undefined;
    } while (cursor);

    return null;
  }

  async function activateExistingSlackChannel(input: {
    existing: typeof projectSlackChannels.$inferSelect | null;
    projectId: string;
    projectCompanyId: string;
    desiredVisibility: "public" | "private";
    channel: SlackChannelLookup;
    client: SlackWebClient;
  }): Promise<ProjectSlackChannel | null> {
    try {
      await input.client.unarchiveChannel(input.channel.id);
    } catch (error) {
      const slackCode = error instanceof SlackApiError ? error.code : null;
      if (slackCode !== "not_archived") {
        throw error;
      }
    }

    await ensureConfiguredChannelMembers({
      client: input.client,
      channelId: input.channel.id,
      projectId: input.projectId,
    });

    if (input.existing?.channelId && input.existing.channelId !== input.channel.id && input.existing.status === "active") {
      try {
        await input.client.archiveChannel(input.existing.channelId);
      } catch (error) {
        logger.warn(
          { err: error, projectId: input.projectId, channelId: input.existing.channelId },
          "failed to archive replaced Slack project channel while reusing archived exact-name channel",
        );
      }
    }

    if (input.existing) {
      return db
        .update(projectSlackChannels)
        .set({
          channelId: input.channel.id,
          channelName: input.channel.name,
          visibility: input.desiredVisibility,
          status: "active",
          lastError: null,
          archivedAt: null,
          updatedAt: new Date(),
        })
        .where(eq(projectSlackChannels.id, input.existing.id))
        .returning()
        .then((rows) => (rows[0] ? toProjectSlackChannel(rows[0]) : null));
    }

    return db
      .insert(projectSlackChannels)
      .values({
        companyId: input.projectCompanyId,
        projectId: input.projectId,
        channelId: input.channel.id,
        channelName: input.channel.name,
        visibility: input.desiredVisibility,
        status: "active",
      })
      .returning()
      .then((rows) => (rows[0] ? toProjectSlackChannel(rows[0]) : null));
  }

  async function renameChannelForVisibilityReplacement(input: {
    client: SlackWebClient;
    existingChannelId: string;
    existingChannelName: string | null;
    desiredChannelName: string;
    projectId: string;
  }) {
    if (!input.existingChannelName || input.existingChannelName !== input.desiredChannelName) {
      return null;
    }

    for (let attempt = 1; attempt <= 10; attempt += 1) {
      const placeholderName = buildArchivedSlackChannelPlaceholderName(input.projectId, attempt);
      try {
        const result = await input.client.renameChannel(input.existingChannelId, placeholderName);
        return result.channel.name;
      } catch (error) {
        const slackCode = error instanceof SlackApiError ? error.code : null;
        if (slackCode === "name_taken") {
          continue;
        }
        throw error;
      }
    }

    throw new Error("Unable to reserve the Slack channel name for visibility replacement.");
  }

  async function getAgentPostingClient(agentId: string | null | undefined) {
    if (!agentId) return getControlClient();
    const app = await getAgentSlackApp(agentId);
    if (!app || app.installStatus !== "active" || !app.botTokenSecretId) {
      return getControlClient();
    }
    try {
      const token = await secretsSvc.resolveValue(app.companyId, app.botTokenSecretId);
      return new SlackWebClient(token);
    } catch (error) {
      logger.warn({ err: error, agentId }, "failed to resolve agent Slack bot token");
      return getControlClient();
    }
  }

  async function getProjectSlackChannelBySlackChannelId(channelId: string) {
    return db
      .select()
      .from(projectSlackChannels)
      .where(eq(projectSlackChannels.channelId, channelId))
      .then((rows) => rows[0] ?? null);
  }

  async function getThreadLinkByIssue(issueId: string) {
    return db
      .select()
      .from(slackThreadLinks)
      .where(and(eq(slackThreadLinks.issueId, issueId), eq(slackThreadLinks.active, true)))
      .orderBy(desc(slackThreadLinks.updatedAt), desc(slackThreadLinks.createdAt))
      .then((rows) => (rows[0] ? toSlackThreadLink(rows[0]) : null));
  }

  async function getThreadLinkBySlackThread(channelId: string, threadTs: string) {
    return db
      .select()
      .from(slackThreadLinks)
      .where(
        and(
          eq(slackThreadLinks.channelId, channelId),
          eq(slackThreadLinks.threadTs, threadTs),
          eq(slackThreadLinks.active, true),
        ),
      )
      .orderBy(desc(slackThreadLinks.updatedAt), desc(slackThreadLinks.createdAt))
      .then((rows) => (rows[0] ? toSlackThreadLink(rows[0]) : null));
  }

  async function activateThreadLink(input: {
    companyId: string;
    issueId: string;
    projectId: string | null;
    projectSlackChannelId: string | null;
    channelId: string;
    threadTs: string;
  }) {
    return db.transaction(async (tx) => {
      await tx
        .update(slackThreadLinks)
        .set({
          active: false,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(slackThreadLinks.issueId, input.issueId),
            eq(slackThreadLinks.active, true),
          ),
        );

      const existing = await tx
        .select()
        .from(slackThreadLinks)
        .where(
          and(
            eq(slackThreadLinks.issueId, input.issueId),
            eq(slackThreadLinks.channelId, input.channelId),
            eq(slackThreadLinks.threadTs, input.threadTs),
          ),
        )
        .then((rows) => rows[0] ?? null);

      if (existing) {
        const updated = await tx
          .update(slackThreadLinks)
          .set({
            companyId: input.companyId,
            projectId: input.projectId,
            projectSlackChannelId: input.projectSlackChannelId,
            active: true,
            updatedAt: new Date(),
          })
          .where(eq(slackThreadLinks.id, existing.id))
          .returning()
          .then((rows) => rows[0] ?? null);
        if (!updated) throw notFound("Slack thread link not found");
        return toSlackThreadLink(updated);
      }

      const created = await tx
        .insert(slackThreadLinks)
        .values({
          companyId: input.companyId,
          issueId: input.issueId,
          projectId: input.projectId,
          projectSlackChannelId: input.projectSlackChannelId,
          channelId: input.channelId,
          threadTs: input.threadTs,
          active: true,
        })
        .returning()
        .then((rows) => rows[0] ?? null);
      if (!created) throw notFound("Failed to create Slack thread link");
      return toSlackThreadLink(created);
    });
  }

  async function markSlackEventReceived(input: {
    eventId: string;
    companyId?: string | null;
    eventType?: string | null;
    apiAppId?: string | null;
  }) {
    const inserted = await db
      .insert(slackEventReceipts)
      .values({
        companyId: input.companyId ?? null,
        eventId: input.eventId,
        eventType: input.eventType ?? null,
        apiAppId: input.apiAppId ?? null,
      })
      .onConflictDoNothing()
      .returning({ id: slackEventReceipts.id })
      .then((rows) => rows[0] ?? null);

    return Boolean(inserted);
  }

  async function getProjectName(projectId: string | null | undefined) {
    if (!projectId) return null;
    const row = await db
      .select({ name: projects.name })
      .from(projects)
      .where(eq(projects.id, projectId))
      .then((rows) => rows[0] ?? null);
    return row?.name ?? null;
  }

  async function describeAssignee(input: {
    companyId: string;
    assigneeAgentId: string | null;
    assigneeUserId: string | null;
  }) {
    if (input.assigneeAgentId) {
      const row = await db
        .select({ name: agents.name })
        .from(agents)
        .where(eq(agents.id, input.assigneeAgentId))
        .then((rows) => rows[0] ?? null);
      return row?.name ? `agent ${row.name}` : `agent ${input.assigneeAgentId}`;
    }
    if (input.assigneeUserId) {
      const row = await db
        .select({ name: authUsers.name })
        .from(authUsers)
        .where(eq(authUsers.id, input.assigneeUserId))
        .then((rows) => rows[0] ?? null);
      return row?.name ? `user ${row.name}` : `user ${input.assigneeUserId}`;
    }
    return "unassigned";
  }

  async function ensureIssueThreadLinkInternal(issue: SlackIssue) {
    const activeLink = await getThreadLinkByIssue(issue.id);
    const destinationChannel =
      issue.projectId
        ? await ensureProjectChannel(issue.projectId)
        : null;

    if (!destinationChannel?.channelId || destinationChannel.status !== "active") {
      return activeLink;
    }

    if (
      activeLink &&
      activeLink.channelId === destinationChannel.channelId &&
      activeLink.projectSlackChannelId === destinationChannel.id
    ) {
      return activeLink;
    }

    const controlClient = await getControlClient();
    if (!controlClient) {
      return activeLink;
    }

    if (activeLink && activeLink.channelId !== destinationChannel.channelId) {
      try {
        const previousProjectName = await getProjectName(activeLink.projectId);
        const nextProjectName = await getProjectName(issue.projectId);
        await controlClient.postMessage({
          channel: activeLink.channelId,
          threadTs: activeLink.threadTs,
          text: [
            `Issue moved to ${nextProjectName ?? "another project"} and future updates will post in the new project channel.`,
            previousProjectName ? `Previous project: ${previousProjectName}` : null,
          ]
            .filter((line): line is string => Boolean(line))
            .join("\n"),
        });
      } catch (error) {
        logger.warn({ err: error, issueId: issue.id }, "failed to post Slack issue handoff notice");
      }
    }

    const posted = await controlClient.postMessage({
      channel: destinationChannel.channelId,
      text: issueRootMessage(issue),
    });
    return activateThreadLink({
      companyId: issue.companyId,
      issueId: issue.id,
      projectId: issue.projectId ?? null,
      projectSlackChannelId: destinationChannel.id,
      channelId: destinationChannel.channelId,
      threadTs: posted.threadTs,
    });
  }

  async function ensureIssueThreadLink(issue: SlackIssue) {
    const inFlight = issueThreadLinkInFlight.get(issue.id);
    if (inFlight) {
      return inFlight;
    }

    const promise = ensureIssueThreadLinkInternal(issue).finally(() => {
      if (issueThreadLinkInFlight.get(issue.id) === promise) {
        issueThreadLinkInFlight.delete(issue.id);
      }
    });
    issueThreadLinkInFlight.set(issue.id, promise);
    return promise;
  }

  async function postThreadMessage(input: {
    issue: SlackIssue;
    text: string;
    agentId?: string | null;
    ensureThread?: boolean;
  }) {
    const link =
      input.ensureThread === false
        ? await getThreadLinkByIssue(input.issue.id)
        : await ensureIssueThreadLink(input.issue);
    if (!link) return null;

    const client = await getAgentPostingClient(input.agentId);
    if (!client) return link;

    try {
      await client.postMessage({
        channel: link.channelId,
        threadTs: link.threadTs,
        text: input.text,
      });
    } catch (error) {
      logger.warn({ err: error, issueId: input.issue.id }, "failed to post Slack thread message");
    }
    return link;
  }

  async function resolveIssueForLiveEvent(event: LiveEvent) {
    if (event.type === "activity.logged") {
      const entityType = readNonEmptyString(event.payload.entityType);
      const entityId = readNonEmptyString(event.payload.entityId);
      if (entityType !== "issue" || !entityId) return null;
      return issuesSvc.getById(entityId);
    }

    const runId = readNonEmptyString(event.payload.runId);
    if (!runId) return null;
    const run = await db
      .select({
        id: heartbeatRuns.id,
        companyId: heartbeatRuns.companyId,
        issueId: heartbeatRuns.contextSnapshot,
      })
      .from(heartbeatRuns)
      .where(eq(heartbeatRuns.id, runId))
      .then((rows) => rows[0] ?? null);
    if (!run) return null;
    const context = parseObject(run.issueId);
    const issueId = readNonEmptyString(context.issueId);
    if (!issueId) return null;
    return issuesSvc.getById(issueId);
  }

  async function forwardIssueCreated(issue: SlackIssue) {
    await ensureIssueThreadLink(issue);
  }

  async function forwardIssueUpdated(event: LiveEvent, issue: SlackIssue) {
    const details = parseObject(event.payload.details);
    const previous = parseObject(details._previous);
    const changes: string[] = [];

    if (readNonEmptyString(details.status) && details.status !== previous.status) {
      changes.push(`Status: \`${previous.status ?? "unset"}\` -> \`${details.status}\``);
    }
    if (readNonEmptyString(details.priority) && details.priority !== previous.priority) {
      changes.push(`Priority: \`${previous.priority ?? "unset"}\` -> \`${details.priority}\``);
    }
    if (readNonEmptyString(details.title) && details.title !== previous.title) {
      changes.push(`Title: ${String(details.title)}`);
    }
    if (Object.prototype.hasOwnProperty.call(details, "assigneeAgentId") || Object.prototype.hasOwnProperty.call(details, "assigneeUserId")) {
      const previousAssignee = await describeAssignee({
        companyId: issue.companyId,
        assigneeAgentId: readNonEmptyString(previous.assigneeAgentId),
        assigneeUserId: readNonEmptyString(previous.assigneeUserId),
      });
      const nextAssignee = await describeAssignee({
        companyId: issue.companyId,
        assigneeAgentId: issue.assigneeAgentId,
        assigneeUserId: issue.assigneeUserId,
      });
      changes.push(`Assignee: ${previousAssignee} -> ${nextAssignee}`);
    }
    if (Object.prototype.hasOwnProperty.call(details, "projectId")) {
      const previousProject = await getProjectName(readNonEmptyString(previous.projectId));
      const nextProject = await getProjectName(issue.projectId);
      changes.push(`Project: ${previousProject ?? "none"} -> ${nextProject ?? "none"}`);
    }

    if (changes.length === 0) return;

    await postThreadMessage({
      issue,
      text: [`Updated *${issueDisplay(issue)}*`, ...changes].join("\n"),
    });
  }

  async function forwardIssueComment(event: LiveEvent, issue: SlackIssue) {
    const details = parseObject(event.payload.details);
    const commentId = readNonEmptyString(details.commentId);
    if (!commentId) return;

    const comment = await issuesSvc.getComment(commentId);
    if (!comment || comment.issueId !== issue.id) return;

    const prefix =
      comment.authorUserId != null
        ? "Board comment:"
        : comment.authorAgentId != null
          ? null
          : "Paperclip update:";

    const text = prefix ? `${prefix}\n${comment.body}` : comment.body;
    await postThreadMessage({
      issue,
      text,
      agentId: comment.authorAgentId,
    });
  }

  async function forwardRunEvent(event: LiveEvent, issue: SlackIssue) {
    const runId = readNonEmptyString(event.payload.runId);
    const agentId = readNonEmptyString(event.payload.agentId);
    if (!runId) return;

    let text: string | null = null;
    if (event.type === "heartbeat.run.queued") {
      text = "Run queued.";
    } else if (event.type === "heartbeat.run.status") {
      const status = readNonEmptyString(event.payload.status);
      if (!status) return;
      if (status === "running") text = "Run started.";
      else if (status === "succeeded") text = "Run completed successfully.";
      else if (status === "cancelled") text = "Run cancelled.";
      else if (status === "timed_out") text = "Run timed out.";
      else if (status === "failed") {
        const error = readNonEmptyString(event.payload.error);
        text = error ? `Run failed: ${error}` : "Run failed.";
      }
    } else if (event.type === "heartbeat.run.event") {
      const level = readNonEmptyString(event.payload.level);
      const message = readNonEmptyString(event.payload.message);
      if (!message || (level !== "warn" && level !== "error")) {
        return;
      }
      text = `${level === "error" ? "Run error" : "Run warning"}: ${message}`;
    } else {
      return;
    }

    if (!text) return;

    await postThreadMessage({
      issue,
      text,
      agentId,
    });
  }

  async function forwardLiveEvent(event: LiveEvent) {
    try {
      if (
        event.type === "activity.logged" &&
        parseObject(event.payload.details).source === "slack"
      ) {
        return;
      }

      if (
        event.type !== "activity.logged" &&
        event.type !== "heartbeat.run.queued" &&
        event.type !== "heartbeat.run.status" &&
        event.type !== "heartbeat.run.event"
      ) {
        return;
      }

      const issue = await resolveIssueForLiveEvent(event);
      if (!issue) return;

      if (event.type === "activity.logged") {
        const action = readNonEmptyString(event.payload.action);
        if (action === "issue.created") {
          await forwardIssueCreated(issue);
          return;
        }
        if (action === "issue.updated") {
          await forwardIssueUpdated(event, issue);
          return;
        }
        if (action === "issue.comment_added") {
          await forwardIssueComment(event, issue);
        }
        return;
      }

      await forwardRunEvent(event, issue);
    } catch (error) {
      logger.warn({ err: error, liveEventType: event.type }, "failed to forward Slack live event");
    }
  }

  function startLiveEventForwarder() {
    const dbRef = db as object;
    if (liveEventForwarderDbs.has(dbRef)) {
      return;
    }
    const state = getSlackForwarderState();
    if (state.unsubscribe && state.db === dbRef) {
      liveEventForwarderDbs.add(dbRef);
      return;
    }
    state.unsubscribe?.();
    const unsubscribe = subscribeAllLiveEvents((event) => {
      void forwardLiveEvent(event);
    });
    state.db = dbRef;
    state.unsubscribe = unsubscribe;
    liveEventForwarderDbs.add(dbRef);
  }

  async function createIssueFromSlackMessage(input: {
    projectChannel: typeof projectSlackChannels.$inferSelect;
    event: SlackControlMessageEvent;
  }) {
    const threadTs = input.event.thread_ts ?? input.event.ts;
    if (!threadTs) return null;
    const task = extractSlackTaskFields(input.event.text ?? "");
    if (!task) return null;

    const issue = await issuesSvc.create(input.projectChannel.companyId, {
      projectId: input.projectChannel.projectId,
      title: task.title,
      description: buildSlackOriginDescription({
        text: task.description ?? task.sourceText,
        slackUserId: input.event.user ?? null,
        channelId: input.projectChannel.channelId ?? "",
        threadTs,
      }),
    });

    await logActivity(db, {
      companyId: issue.companyId,
      actorType: "system",
      actorId: "slack",
      action: "issue.created",
      entityType: "issue",
      entityId: issue.id,
      details: {
        title: issue.title,
        identifier: issue.identifier,
        source: "slack",
        slackChannelId: input.projectChannel.channelId,
        slackThreadTs: threadTs,
        slackUserId: input.event.user ?? null,
      },
    });

    const link = await activateThreadLink({
      companyId: issue.companyId,
      issueId: issue.id,
      projectId: issue.projectId ?? null,
      projectSlackChannelId: input.projectChannel.id,
      channelId: input.projectChannel.channelId ?? "",
      threadTs,
    });

    await postThreadMessage({
      issue,
      text: `Created Paperclip issue *${issueDisplay(issue)}*.`,
      ensureThread: false,
    });

    return { issue, link };
  }

  async function addSlackReplyToIssue(input: {
    link: SlackThreadLink;
    event: SlackControlMessageEvent;
  }) {
    const text = stripLeadingSlackMentions(input.event.text ?? "");
    if (!text) return null;

    const issue = await issuesSvc.getById(input.link.issueId);
    if (!issue) return null;

    const comment = await issuesSvc.addComment(
      issue.id,
      buildSlackCommentBody({
        text,
        slackUserId: input.event.user ?? null,
        channelId: input.link.channelId,
        threadTs: input.link.threadTs,
      }),
      {},
    );

    await logActivity(db, {
      companyId: issue.companyId,
      actorType: "system",
      actorId: "slack",
      action: "issue.comment_added",
      entityType: "issue",
      entityId: issue.id,
      details: {
        commentId: comment.id,
        bodySnippet: comment.body.slice(0, 120),
        identifier: issue.identifier,
        issueTitle: issue.title,
        source: "slack",
        slackChannelId: input.link.channelId,
        slackThreadTs: input.link.threadTs,
        slackUserId: input.event.user ?? null,
      },
    });

    if (issue.assigneeAgentId && issue.status !== "done" && issue.status !== "cancelled") {
      void heartbeat
        .wakeup(issue.assigneeAgentId, {
          source: "automation",
          triggerDetail: "system",
          reason: "issue_commented",
          payload: { issueId: issue.id, commentId: comment.id, mutation: "comment" },
          requestedByActorType: "system",
          requestedByActorId: "slack",
          contextSnapshot: {
            issueId: issue.id,
            taskId: issue.id,
            commentId: comment.id,
            wakeCommentId: comment.id,
            wakeReason: "issue_commented",
            source: "slack.comment",
          },
        })
        .catch((error) => logger.warn({ err: error, issueId: issue.id }, "failed to wake assignee from Slack reply"));
    }

    return comment;
  }

  async function handleSlackControlEvent(envelope: SlackControlEventEnvelope) {
    if (envelope.type !== "event_callback" || !envelope.event_id || !envelope.event) {
      return;
    }

    const channelId = readNonEmptyString(envelope.event.channel);
    if (!channelId) return;

    const projectChannel = await getProjectSlackChannelBySlackChannelId(channelId);
    const accepted = await markSlackEventReceived({
      eventId: envelope.event_id,
      companyId: projectChannel?.companyId ?? null,
      eventType: envelope.event.type,
      apiAppId: envelope.api_app_id ?? null,
    });
    if (!accepted) {
      return;
    }

    if (
      envelope.event.type !== "message" ||
      envelope.event.subtype ||
      envelope.event.bot_id ||
      !projectChannel ||
      projectChannel.status !== "active"
    ) {
      return;
    }

    const threadTs = envelope.event.thread_ts ?? envelope.event.ts;
    if (!threadTs) return;

    const isThreadReply = Boolean(envelope.event.thread_ts && envelope.event.thread_ts !== envelope.event.ts);
    if (!isThreadReply) {
      const created = await createIssueFromSlackMessage({
        projectChannel,
        event: envelope.event,
      });

      const eventText = readNonEmptyString(envelope.event.text);
      if (!created && eventText && /^task:/i.test(stripLeadingSlackMentions(eventText))) {
        const controlClient = await getControlClient();
        if (controlClient) {
          try {
            await controlClient.postMessage({
              channel: channelId,
              threadTs,
              text: "Use `task: <title>` to create a Paperclip issue in this project channel.",
            });
          } catch (error) {
            logger.warn({ err: error, channelId }, "failed to post Slack task usage hint");
          }
        }
      }
      return;
    }

    const link = await getThreadLinkBySlackThread(channelId, threadTs);
    if (!link) return;
    await addSlackReplyToIssue({
      link,
      event: envelope.event,
    });
  }

  async function markMembershipPending(
    membershipId: string,
    input: {
      agentSlackAppId?: string | null;
      projectSlackChannelId?: string | null;
      lastError?: string | null;
    },
  ) {
    await db
      .update(projectSlackMemberships)
      .set({
        agentSlackAppId: input.agentSlackAppId ?? null,
        projectSlackChannelId: input.projectSlackChannelId ?? null,
        syncStatus: "pending",
        lastError: input.lastError ?? null,
        removedAt: null,
        updatedAt: new Date(),
      })
      .where(eq(projectSlackMemberships.id, membershipId));
  }

  async function upsertProjectMembershipRow(input: {
    companyId: string;
    projectId: string;
    agentId: string;
    projectSlackChannelId?: string | null;
    agentSlackAppId?: string | null;
  }) {
    const existing = await db
      .select()
      .from(projectSlackMemberships)
      .where(
        and(
          eq(projectSlackMemberships.projectId, input.projectId),
          eq(projectSlackMemberships.agentId, input.agentId),
        ),
      )
      .then((rows) => rows[0] ?? null);

    if (existing) {
      return db
        .update(projectSlackMemberships)
        .set({
          projectSlackChannelId: input.projectSlackChannelId ?? existing.projectSlackChannelId,
          agentSlackAppId: input.agentSlackAppId ?? existing.agentSlackAppId,
          removedAt: null,
          updatedAt: new Date(),
        })
        .where(eq(projectSlackMemberships.id, existing.id))
        .returning()
        .then((rows) => rows[0] ?? null);
    }

    return db
      .insert(projectSlackMemberships)
      .values({
        companyId: input.companyId,
        projectId: input.projectId,
        agentId: input.agentId,
        projectSlackChannelId: input.projectSlackChannelId ?? null,
        agentSlackAppId: input.agentSlackAppId ?? null,
        syncStatus: "pending",
      })
      .returning()
      .then((rows) => rows[0] ?? null);
  }

  async function ensureProjectChannelInternal(projectId: string): Promise<ProjectSlackChannel | null> {
    const project = await getProjectRow(projectId);
    if (!project) throw notFound("Project not found");
    const desiredVisibility = (project.slackChannelVisibility ?? "public") as "public" | "private";
    const desiredChannelName =
      project.slackChannelName?.trim() ||
      buildProjectSlackChannelName(project.companyName, project.name);

    const existing = await db
      .select()
      .from(projectSlackChannels)
      .where(eq(projectSlackChannels.projectId, projectId))
      .then((rows) => rows[0] ?? null);
    const replacingVisibility =
      Boolean(existing?.channelId) &&
      existing?.status === "active" &&
      existing.visibility !== desiredVisibility;

    const controlBotToken = instanceSettings.getRuntimeSecretValue("slackBotToken");
    if (
      existing?.channelId &&
      existing.status === "active" &&
      !replacingVisibility &&
      existing.channelName !== desiredChannelName
    ) {
      if (!controlBotToken) {
        return db
          .update(projectSlackChannels)
          .set({
            lastError: "SLACK_BOT_TOKEN is not configured.",
            updatedAt: new Date(),
          })
          .where(eq(projectSlackChannels.id, existing.id))
          .returning()
          .then((rows) => (rows[0] ? toProjectSlackChannel(rows[0]) : null));
      }

      const renameClient = new SlackWebClient(controlBotToken);
      try {
        const result = await renameClient.renameChannel(existing.channelId, desiredChannelName);
        return db
          .update(projectSlackChannels)
          .set({
            channelName: result.channel.name,
            visibility: desiredVisibility,
            status: "active",
            lastError: null,
            updatedAt: new Date(),
          })
          .where(eq(projectSlackChannels.id, existing.id))
          .returning()
          .then((rows) => (rows[0] ? toProjectSlackChannel(rows[0]) : null));
      } catch (error) {
        if (error instanceof SlackApiError && error.code === "name_taken") {
          try {
            const archivedMatch = await findArchivedChannelByName(
              renameClient,
              desiredChannelName,
              desiredVisibility,
            );
            if (archivedMatch) {
              return activateExistingSlackChannel({
                existing,
                projectId,
                projectCompanyId: project.companyId,
                desiredVisibility,
                channel: archivedMatch,
                client: renameClient,
              });
            }
          } catch (lookupError) {
            logger.warn(
              { err: lookupError, projectId, desiredChannelName },
              "failed to look up archived Slack channel for exact-name reuse",
            );
          }
        }
        const message = error instanceof Error ? error.message : String(error);
        logger.warn(
          { err: error, projectId, channelId: existing.channelId },
          "failed to rename Slack project channel",
        );
        return db
          .update(projectSlackChannels)
          .set({
            lastError: message,
            updatedAt: new Date(),
          })
          .where(eq(projectSlackChannels.id, existing.id))
          .returning()
          .then((rows) => (rows[0] ? toProjectSlackChannel(rows[0]) : null));
      }
    }

    if (existing?.channelId && existing.status === "active" && !replacingVisibility) {
      return toProjectSlackChannel(existing);
    }

    if (!controlBotToken) {
      const message = "SLACK_BOT_TOKEN is not configured.";
      if (existing) {
        return db
          .update(projectSlackChannels)
          .set({
            status: existing.channelId ? existing.status : "pending",
            lastError: message,
            updatedAt: new Date(),
          })
          .where(eq(projectSlackChannels.id, existing.id))
          .returning()
          .then((rows) => (rows[0] ? toProjectSlackChannel(rows[0]) : null));
      }
      return db
        .insert(projectSlackChannels)
        .values({
          companyId: project.companyId,
          projectId,
          visibility: desiredVisibility,
          status: "pending",
          channelName: desiredChannelName,
          lastError: message,
        })
        .returning()
        .then((rows) => (rows[0] ? toProjectSlackChannel(rows[0]) : null));
    }

    const client = new SlackWebClient(controlBotToken);
    const baseName = desiredChannelName;
    let createdChannel: { id: string; name: string } | null = null;
    let chosenName = baseName;
    let replacedChannelTemporaryName: string | null = null;
    if (replacingVisibility && existing?.channelId) {
      try {
        replacedChannelTemporaryName = await renameChannelForVisibilityReplacement({
          client,
          existingChannelId: existing.channelId,
          existingChannelName: existing.channelName,
          desiredChannelName: baseName,
          projectId,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.warn(
          { err: error, projectId, channelId: existing.channelId },
          "failed to reserve Slack channel name before visibility replacement",
        );
        return db
          .update(projectSlackChannels)
          .set({
            visibility: desiredVisibility,
            status: "error",
            lastError: message,
            updatedAt: new Date(),
          })
          .where(eq(projectSlackChannels.id, existing.id))
          .returning()
          .then((rows) => (rows[0] ? toProjectSlackChannel(rows[0]) : null));
      }
    }
    for (let suffix = 1; suffix <= 50; suffix += 1) {
      const candidateName =
        suffix === 1 ? baseName : truncate(`${baseName}-${suffix}`, 80);
      try {
        const result = await client.createChannel({
          name: candidateName,
          isPrivate: desiredVisibility === "private",
        });
        createdChannel = result.channel;
        chosenName = result.channel.name;
        break;
      } catch (error) {
        if (error instanceof SlackApiError && error.code === "name_taken") {
          if (suffix === 1) {
            try {
              const archivedMatch = await findArchivedChannelByName(
                client,
                candidateName,
                desiredVisibility,
              );
              if (archivedMatch) {
                return activateExistingSlackChannel({
                  existing,
                  projectId,
                  projectCompanyId: project.companyId,
                  desiredVisibility,
                  channel: archivedMatch,
                  client,
                });
              }
            } catch (lookupError) {
              logger.warn(
                { err: lookupError, projectId, desiredChannelName: candidateName },
                "failed to look up archived Slack channel for exact-name reuse during channel creation",
              );
            }
          }
          continue;
        }
        const message = error instanceof Error ? error.message : String(error);
        logger.warn({ err: error, projectId }, "failed to create Slack project channel");
        if (replacingVisibility && existing?.channelId && replacedChannelTemporaryName) {
          try {
            await client.renameChannel(existing.channelId, baseName);
          } catch (restoreError) {
            logger.warn(
              { err: restoreError, projectId, channelId: existing.channelId, baseName },
              "failed to restore Slack channel name after visibility replacement create failure",
            );
          }
        }
        if (existing) {
          return db
            .update(projectSlackChannels)
            .set({
              visibility: desiredVisibility,
              status: "error",
              lastError: message,
              updatedAt: new Date(),
            })
            .where(eq(projectSlackChannels.id, existing.id))
            .returning()
            .then((rows) => (rows[0] ? toProjectSlackChannel(rows[0]) : null));
        }
        return db
        .insert(projectSlackChannels)
        .values({
          companyId: project.companyId,
          projectId,
          visibility: desiredVisibility,
          status: "error",
          channelName: candidateName,
          lastError: message,
          })
          .returning()
          .then((rows) => (rows[0] ? toProjectSlackChannel(rows[0]) : null));
      }
    }

    if (!createdChannel) {
      const message = "Unable to allocate a unique Slack channel name.";
      if (replacingVisibility && existing?.channelId && replacedChannelTemporaryName) {
        try {
          await client.renameChannel(existing.channelId, baseName);
        } catch (restoreError) {
          logger.warn(
            { err: restoreError, projectId, channelId: existing.channelId, baseName },
            "failed to restore Slack channel name after visibility replacement name allocation failure",
          );
        }
      }
      if (existing) {
        return db
          .update(projectSlackChannels)
          .set({
            status: "error",
            lastError: message,
            updatedAt: new Date(),
          })
          .where(eq(projectSlackChannels.id, existing.id))
          .returning()
          .then((rows) => (rows[0] ? toProjectSlackChannel(rows[0]) : null));
      }
      return db
        .insert(projectSlackChannels)
        .values({
          companyId: project.companyId,
          projectId,
          visibility: desiredVisibility,
          status: "error",
          channelName: chosenName,
          lastError: message,
        })
        .returning()
        .then((rows) => (rows[0] ? toProjectSlackChannel(rows[0]) : null));
    }

    await ensureConfiguredChannelMembers({
      client,
      channelId: createdChannel.id,
      projectId,
    });

    if (existing) {
      if (replacingVisibility && existing.channelId) {
        try {
          await client.archiveChannel(existing.channelId);
        } catch (error) {
          logger.warn(
            { err: error, projectId, channelId: existing.channelId },
            "failed to archive replaced Slack project channel after visibility change",
          );
        }
      }
      return db
        .update(projectSlackChannels)
        .set({
          channelId: createdChannel.id,
          channelName: createdChannel.name,
          visibility: desiredVisibility,
          status: "active",
          lastError: null,
          archivedAt: null,
          updatedAt: new Date(),
        })
        .where(eq(projectSlackChannels.id, existing.id))
        .returning()
        .then((rows) => (rows[0] ? toProjectSlackChannel(rows[0]) : null));
    }

    return db
      .insert(projectSlackChannels)
      .values({
        companyId: project.companyId,
        projectId,
        channelId: createdChannel.id,
        channelName: createdChannel.name,
        visibility: desiredVisibility,
        status: "active",
      })
      .returning()
      .then((rows) => (rows[0] ? toProjectSlackChannel(rows[0]) : null));
  }

  async function ensureProjectChannel(projectId: string): Promise<ProjectSlackChannel | null> {
    const inFlight = projectChannelEnsureInFlight.get(projectId);
    if (inFlight) {
      return inFlight;
    }

    const promise = ensureProjectChannelInternal(projectId).finally(() => {
      if (projectChannelEnsureInFlight.get(projectId) === promise) {
        projectChannelEnsureInFlight.delete(projectId);
      }
    });
    projectChannelEnsureInFlight.set(projectId, promise);
    return promise;
  }

  async function listProjectSlackState(projectId: string): Promise<ProjectSlackState> {
    const channel = await db
      .select()
      .from(projectSlackChannels)
      .where(eq(projectSlackChannels.projectId, projectId))
      .then((rows) => (rows[0] ? toProjectSlackChannel(rows[0]) : null));

    const memberships = await db
      .select({
        membership: projectSlackMemberships,
        agentSlackApp: agentSlackApps,
      })
      .from(projectSlackMemberships)
      .leftJoin(agentSlackApps, eq(projectSlackMemberships.agentSlackAppId, agentSlackApps.id))
      .where(eq(projectSlackMemberships.projectId, projectId))
      .orderBy(asc(projectSlackMemberships.createdAt), asc(projectSlackMemberships.id));

    return {
      channel,
      memberships: memberships.map((row) => ({
        ...toProjectSlackMembership(row.membership),
        agentSlackApp: row.agentSlackApp ? toAgentSlackApp(row.agentSlackApp) : null,
      })),
    };
  }

  async function syncProjectSlack(projectId: string): Promise<ProjectSlackState> {
    const project = await getProjectRow(projectId);
    if (!project) throw notFound("Project not found");

    const channel = await ensureProjectChannel(projectId);
    const controlBotToken = instanceSettings.getRuntimeSecretValue("slackBotToken");
    const controlClient = controlBotToken ? new SlackWebClient(controlBotToken) : null;

    if (channel?.channelId && channel.status === "active" && controlClient) {
      await ensureConfiguredChannelMembers({
        client: controlClient,
        channelId: channel.channelId,
        projectId,
      });
    }

    const members = await db
      .select()
      .from(projectMembers)
      .where(eq(projectMembers.projectId, projectId))
      .orderBy(asc(projectMembers.createdAt), asc(projectMembers.id));

    const memberAgentIds = members.map((member) => member.agentId);
    const agentApps =
      memberAgentIds.length > 0
        ? await db
            .select()
            .from(agentSlackApps)
            .where(inArray(agentSlackApps.agentId, memberAgentIds))
        : [];
    const appByAgentId = new Map(agentApps.map((row) => [row.agentId, row] as const));

    const existingMemberships = await db
      .select()
      .from(projectSlackMemberships)
      .where(eq(projectSlackMemberships.projectId, projectId));

    for (const member of members) {
      const app = appByAgentId.get(member.agentId) ?? null;
      const membership = await upsertProjectMembershipRow({
        companyId: project.companyId,
        projectId,
        agentId: member.agentId,
        projectSlackChannelId: channel?.id ?? null,
        agentSlackAppId: app?.id ?? null,
      });
      if (!membership) continue;

      if (!app || app.installStatus !== "active" || !app.botUserId) {
        await markMembershipPending(membership.id, {
          agentSlackAppId: app?.id ?? null,
          projectSlackChannelId: channel?.id ?? null,
          lastError: !app
            ? "Agent Slack app has not been provisioned."
            : app.installStatus === "install_pending"
              ? "Agent Slack app installation is still pending."
              : "Agent Slack app is not active.",
        });
        continue;
      }

      if (!channel?.channelId || channel.status !== "active" || !controlClient) {
        await markMembershipPending(membership.id, {
          agentSlackAppId: app.id,
          projectSlackChannelId: channel?.id ?? null,
          lastError: !controlClient
            ? "SLACK_BOT_TOKEN is not configured."
            : "Project Slack channel is not active yet.",
        });
        continue;
      }

      try {
        await controlClient.inviteUsers(channel.channelId, [app.botUserId]);
      } catch (error) {
        const slackCode = error instanceof SlackApiError ? error.code : null;
        if (slackCode !== "already_in_channel") {
          const message = error instanceof Error ? error.message : String(error);
          await db
            .update(projectSlackMemberships)
            .set({
              projectSlackChannelId: channel.id,
              agentSlackAppId: app.id,
              syncStatus: "error",
              lastError: message,
              updatedAt: new Date(),
            })
            .where(eq(projectSlackMemberships.id, membership.id));
          continue;
        }
      }

      await db
        .update(projectSlackMemberships)
        .set({
          projectSlackChannelId: channel.id,
          agentSlackAppId: app.id,
          syncStatus: "active",
          lastError: null,
          syncedAt: new Date(),
          removedAt: null,
          updatedAt: new Date(),
        })
        .where(eq(projectSlackMemberships.id, membership.id));
    }

    const desiredAgentIds = new Set(memberAgentIds);
    for (const membership of existingMemberships) {
      if (desiredAgentIds.has(membership.agentId)) continue;

      const app = membership.agentSlackAppId
        ? await db
            .select()
            .from(agentSlackApps)
            .where(eq(agentSlackApps.id, membership.agentSlackAppId))
            .then((rows) => rows[0] ?? null)
        : null;
      let removalError: string | null = null;
      if (channel?.channelId && controlClient && app?.botUserId) {
        try {
          await controlClient.kickUser(channel.channelId, app.botUserId);
        } catch (error) {
          const slackCode = error instanceof SlackApiError ? error.code : null;
          if (slackCode !== "user_not_in_channel" && slackCode !== "not_in_channel") {
            removalError = error instanceof Error ? error.message : String(error);
          }
        }
      } else if (!controlClient && channel?.channelId && app?.botUserId) {
        removalError = "SLACK_BOT_TOKEN is not configured.";
      }

      await db
        .update(projectSlackMemberships)
        .set({
          syncStatus: "removed",
          lastError: removalError,
          removedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(projectSlackMemberships.id, membership.id));
    }

    return listProjectSlackState(projectId);
  }

  async function syncAgentProjectMemberships(agentId: string) {
    const memberships = await db
      .select({ projectId: projectMembers.projectId })
      .from(projectMembers)
      .where(eq(projectMembers.agentId, agentId));
    const projectIds = Array.from(new Set(memberships.map((row) => row.projectId)));
    for (const projectId of projectIds) {
      await syncProjectSlack(projectId);
    }
  }

  async function archiveProjectChannel(projectId: string): Promise<ProjectSlackState> {
    const project = await getProjectRow(projectId);
    if (!project) throw notFound("Project not found");

    const existing = await db
      .select()
      .from(projectSlackChannels)
      .where(eq(projectSlackChannels.projectId, projectId))
      .then((rows) => rows[0] ?? null);
    if (!existing) {
      return listProjectSlackState(projectId);
    }

    const controlBotToken = instanceSettings.getRuntimeSecretValue("slackBotToken");
    if (existing.channelId && controlBotToken) {
      const client = new SlackWebClient(controlBotToken);
      try {
        await client.archiveChannel(existing.channelId);
      } catch (error) {
        const slackCode = error instanceof SlackApiError ? error.code : null;
        if (slackCode !== "already_archived" && slackCode !== "channel_not_found") {
          const message = error instanceof Error ? error.message : String(error);
          await db
            .update(projectSlackChannels)
            .set({
              status: "error",
              lastError: message,
              updatedAt: new Date(),
            })
            .where(eq(projectSlackChannels.id, existing.id));
          throw error;
        }
      }
    }

    const archivedAt = new Date();
    await db
      .update(projectSlackChannels)
      .set({
        status: "archived",
        lastError: null,
        archivedAt,
        updatedAt: archivedAt,
      })
      .where(eq(projectSlackChannels.id, existing.id));

    await db
      .update(projectSlackMemberships)
      .set({
        syncStatus: "pending",
        lastError: "Project Slack channel is archived.",
        updatedAt: archivedAt,
      })
      .where(eq(projectSlackMemberships.projectId, projectId));

    return listProjectSlackState(projectId);
  }

  return {
    getAgentSlackApp,
    startLiveEventForwarder,
    handleSlackControlEvent,

    async provisionAgentApp(agentId: string, actor?: ActorRef) {
      const agent = await getAgentRow(agentId);
      if (!agent) throw notFound("Agent not found");

      const existing = await getAgentSlackApp(agentId);
      if (existing?.installStatus === "active") {
        return existing;
      }
      if (existing?.installStatus === "install_pending" && existing.installUrl && existing.oauthState) {
        return existing;
      }

      const manifestToken = instanceSettings.getRuntimeSecretValue("slackManifestToken");
      if (!manifestToken) {
        return upsertAgentSlackApp(agentId, {
          installStatus: "not_configured",
          lastError: "SLACK_APP_MANIFEST_TOKEN is not configured.",
        });
      }

      const redirectUri = `${resolvePublicBaseUrl()}/api/slack/agent-oauth/callback`;
      const created = await slackManifestCreate({
        manifestToken,
        manifest: {
          display_information: {
            name: buildSlackAppName(agent.name),
          },
          features: {
            bot_user: {
              display_name: buildSlackBotDisplayName(agent.name),
              always_online: false,
            },
          },
          oauth_config: {
            redirect_urls: [redirectUri],
            scopes: {
              bot: ["chat:write"],
            },
          },
          settings: {
            socket_mode_enabled: false,
            org_deploy_enabled: false,
          },
        },
      });

      const clientId = created.credentials?.client_id;
      const clientSecret = created.credentials?.client_secret;
      const signingSecret = created.credentials?.signing_secret;
      if (!created.app_id || !clientId || !clientSecret || !signingSecret || !created.oauth_authorize_url) {
        throw unprocessable("Slack app provisioning returned incomplete credentials");
      }
      const oauthState = randomUUID();

      const clientSecretRecord = await createOrRotateSecret(
        agent.companyId,
        agent.id,
        "client-secret",
        clientSecret,
        actor,
      );
      const signingSecretRecord = await createOrRotateSecret(
        agent.companyId,
        agent.id,
        "signing-secret",
        signingSecret,
        actor,
      );

      return upsertAgentSlackApp(agentId, {
        slackAppId: created.app_id,
        clientId,
        installStatus: "install_pending",
        installUrl: withOAuthState(created.oauth_authorize_url, oauthState, redirectUri),
        oauthState,
        clientSecretSecretId: clientSecretRecord.id,
        signingSecretSecretId: signingSecretRecord.id,
        lastError: null,
        disabledAt: null,
      });
    },

    async completeAgentInstall(input: { code: string; state: string }, actor?: ActorRef) {
      const agentApp = await getAgentSlackAppByState(input.state);
      if (!agentApp) throw notFound("Unknown Slack OAuth state");
      if (!agentApp.clientId || !agentApp.clientSecretSecretId) {
        throw unprocessable("Slack app is missing OAuth client credentials");
      }

      const clientSecret = await secretsSvc.resolveValue(
        agentApp.companyId,
        agentApp.clientSecretSecretId,
      );
      const redirectUri = `${resolvePublicBaseUrl()}/api/slack/agent-oauth/callback`;
      const exchange = await slackOAuthExchange({
        clientId: agentApp.clientId,
        clientSecret,
        code: input.code,
        redirectUri,
      });
      if (!exchange.access_token || !exchange.bot_user_id || !exchange.team?.id) {
        throw unprocessable("Slack OAuth callback returned incomplete bot installation data");
      }

      const botTokenSecret = await createOrRotateSecret(
        agentApp.companyId,
        agentApp.agentId,
        "bot-token",
        exchange.access_token,
        actor,
      );

      const updated = await upsertAgentSlackApp(agentApp.agentId, {
        botUserId: exchange.bot_user_id,
        teamId: exchange.team.id,
        botTokenSecretId: botTokenSecret.id,
        installStatus: "active",
        lastError: null,
        disabledAt: null,
      });
      await syncAgentProjectMemberships(agentApp.agentId);
      return updated;
    },

    ensureProjectChannel,
    archiveProjectChannel,
    syncProjectSlack,
    listProjectSlackState,
    syncAgentProjectMemberships,
    getThreadLinkByIssue,
  };
}
