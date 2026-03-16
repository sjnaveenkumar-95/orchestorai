import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "@orchestorai/db";
import {
  agentSlackApps,
  agents,
  approvals,
  authUsers,
  companyChatThreads,
  companies,
  companyChatRooms,
  heartbeatRuns,
  projectMembers,
  projectSlackChannels,
  projectSlackMemberships,
  projects,
  slackActionRuns,
  slackApprovalThreadLinks,
  slackEventReceipts,
  slackThreadLinks,
} from "@orchestorai/db";
import type {
  AgentSlackApp,
  CompanyChatRoom,
  LiveEvent,
  ProjectSlackChannel,
  ProjectSlackMembership,
  ProjectSlackState,
  SlackControlInterpreterResult,
  SlackControlMessageContext,
  SlackApprovalThreadLink,
  SlackThreadLink,
} from "@orchestorai/shared";
import {
  buildProjectSlackChannelName,
  normalizeSlackChannelName,
  normalizeReferenceAlias,
  readReferenceAliases,
} from "@orchestorai/shared";
import { createInstanceSettingsService } from "./instance-settings.js";
import { logger } from "../middleware/logger.js";
import { secretService } from "./secrets.js";
import { loadConfig } from "../config.js";
import { notFound, unprocessable } from "../errors.js";
import { agentService } from "./agents.js";
import { heartbeatService } from "./heartbeat.js";
import { issueCommandService } from "./issue-commands.js";
import { approvalService } from "./approvals.js";
import { hostCommandFallbackService } from "./host-command-fallbacks.js";
import { issueService } from "./issues.js";
import { logActivity } from "./activity-log.js";
import { subscribeAllLiveEvents } from "./live-events.js";
import { projectService } from "./projects.js";
import { socialRoomService } from "./social-room.js";
import {
  type SlackActionInterpreterInput,
  type SlackInterpreterCandidateAgent,
  type SlackInterpreterCandidateIssue,
  type SlackInterpreterCandidateProject,
  slackActionInterpreterService,
} from "./slack-action-interpreter.js";

type ActorRef = {
  userId?: string | null;
  agentId?: string | null;
};

type SlackControlMessageFile = {
  id?: string;
  name?: string;
  title?: string;
  mimetype?: string;
  filetype?: string;
  pretty_type?: string;
  size?: number;
  permalink?: string;
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
  files?: SlackControlMessageFile[];
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

type SlackActionRunStatus =
  | "received"
  | "clarification"
  | "executed"
  | "ignored"
  | "failed";

type SlackActionExecutionOutcome = {
  status: SlackActionRunStatus;
  slackReply: string | null;
  issue: SlackIssue | null;
  canonicalLink: SlackThreadLink | null;
  executionResult: Record<string, unknown> | null;
};

const liveEventForwarderDbs = new WeakSet<object>();
const issueThreadLinkInFlight = new Map<string, Promise<SlackThreadLink | null>>();
const projectChannelEnsureInFlight = new Map<string, Promise<ProjectSlackChannel | null>>();
const SLACK_FORWARDER_STATE_KEY = "__orchestoraiSlackForwarderState";
const SLACK_SYSTEM_ACTOR_ID = "slack_control";
const SLACK_AUTO_APPLY_CONFIDENCE = 0.7;
const SLACK_API_TIMEOUT_MS = 15000;
const SLACK_THREAD_STATUS_REFRESH_MS = 4000;
const MAX_SLACK_CONTROL_FILES = 5;
const SUPPORTED_SLACK_CONTROL_SUBTYPES = new Set(["file_share", "thread_broadcast", "message_replied"]);
const ACTIONABLE_APPROVAL_STATUSES = new Set(["pending", "revision_requested"]);

export function deriveSocialRoomThreadStatusFromHeartbeatEvent(input: {
  eventType: LiveEvent["type"];
  runStatus?: string | null;
  hasActiveResponders: boolean;
}) {
  if (input.eventType === "heartbeat.run.queued") {
    return "Selecting responders...";
  }
  if (input.eventType !== "heartbeat.run.status") {
    return null;
  }
  const runStatus = readNonEmptyString(input.runStatus);
  if (!runStatus) return null;
  if (runStatus === "queued") return "Selecting responders...";
  if (runStatus === "running") return "Waiting for replies...";
  if (
    runStatus === "succeeded" ||
    runStatus === "failed" ||
    runStatus === "cancelled" ||
    runStatus === "timed_out"
  ) {
    return input.hasActiveResponders ? "Waiting for replies..." : "";
  }
  return null;
}

type SocialRoomProgressResponder = {
  agentName: string;
  runStatus: string;
};

function formatHumanNameList(names: string[]) {
  if (names.length === 0) return "";
  if (names.length === 1) return names[0] ?? "";
  if (names.length === 2) return `${names[0] ?? ""} and ${names[1] ?? ""}`;
  return `${names[0] ?? ""}, ${names[1] ?? ""} +${names.length - 2} more`;
}

export function formatSocialRoomThreadProgressStatus(input: {
  activeResponders: SocialRoomProgressResponder[];
  followOnPending: boolean;
  fallbackStatus?: string | null;
}) {
  const runningResponder = input.activeResponders.find((responder) => responder.runStatus === "running");
  if (runningResponder) {
    const queuedCount = Math.max(input.activeResponders.length - 1, 0);
    if (queuedCount <= 0) {
      return `${runningResponder.agentName} is replying...`;
    }
    return `${runningResponder.agentName} is replying... ${queuedCount} more queued.`;
  }

  if (input.activeResponders.length > 0) {
    return `Waiting on ${formatHumanNameList(input.activeResponders.map((responder) => responder.agentName))}...`;
  }

  if (input.followOnPending) {
    return "Choosing the next speaker...";
  }

  return input.fallbackStatus ?? "";
}

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

  private async fetchWithTimeout(input: string | URL, init: RequestInit) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), SLACK_API_TIMEOUT_MS);
    try {
      return await fetch(input, {
        ...init,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  private async callQuery<T extends { ok: boolean; error?: string }>(
    method: string,
    query: Record<string, string>,
  ): Promise<T> {
    const url = new URL(`https://slack.com/api/${method}`);
    for (const [key, value] of Object.entries(query)) {
      url.searchParams.set(key, value);
    }

    const response = await this.fetchWithTimeout(url, {
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
    const response = await this.fetchWithTimeout(`https://slack.com/api/${method}`, {
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

  async addReaction(input: { channel: string; messageTs: string; emoji: string }) {
    await this.callJson("reactions.add", {
      channel: input.channel,
      timestamp: input.messageTs,
      name: input.emoji,
    });
  }

  async listThreadReplies(input: { channel: string; threadTs: string; limit?: number }) {
    return this.callQuery<{
      ok: boolean;
      error?: string;
      messages?: Array<{
        user?: string;
        text?: string;
        ts?: string;
        bot_id?: string;
        subtype?: string;
      }>;
    }>("conversations.replies", {
      channel: input.channel,
      ts: input.threadTs,
      limit: String(input.limit ?? 20),
      inclusive: "true",
    });
  }

  async getPermalink(input: { channel: string; messageTs: string }) {
    return this.callQuery<{
      ok: boolean;
      error?: string;
      permalink?: string;
    }>("chat.getPermalink", {
      channel: input.channel,
      message_ts: input.messageTs,
    });
  }

  async getUserInfo(input: { userId: string }) {
    return this.callQuery<{
      ok: boolean;
      error?: string;
      user?: {
        name?: string;
        real_name?: string;
        real_name_normalized?: string;
        profile?: {
          display_name?: string;
          display_name_normalized?: string;
          real_name?: string;
          real_name_normalized?: string;
        };
      };
    }>("users.info", {
      user: input.userId,
    });
  }

  async setThreadStatus(input: { channelId: string; threadTs: string; status: string }) {
    await this.callJson("assistant.threads.setStatus", {
      channel_id: input.channelId,
      thread_ts: input.threadTs,
      status: input.status,
    });
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
  const base = `orchestorai-archived-${projectId.toLowerCase().slice(0, 8)}`;
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

function collapseWhitespace(value: string) {
  return value
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function formatSlackControlFileLabel(file: SlackControlMessageFile) {
  const name = readNonEmptyString(file.name) ?? readNonEmptyString(file.title) ?? readNonEmptyString(file.id) ?? "unnamed file";
  const parts = uniqueStrings([readNonEmptyString(file.pretty_type), readNonEmptyString(file.mimetype)]);
  if (parts.length === 0) {
    return name;
  }
  return `${name} (${parts.join(", ")})`;
}

function buildSlackControlFileSummary(files: SlackControlMessageFile[] | null | undefined) {
  if (!Array.isArray(files) || files.length === 0) {
    return "";
  }

  const labels = files
    .slice(0, MAX_SLACK_CONTROL_FILES)
    .map((file) => formatSlackControlFileLabel(file))
    .filter(Boolean);

  if (labels.length === 0) {
    return "";
  }

  return ["Attached files:", ...labels.map((label) => `- ${label}`)].join("\n");
}

export function buildSlackControlMessageText(input: {
  text?: string | null;
  files?: SlackControlMessageFile[] | null;
}) {
  const text = String(input.text ?? "").trim();
  const fileSummary = buildSlackControlFileSummary(input.files);

  if (text && fileSummary) {
    return `${text}\n\n${fileSummary}`;
  }
  return text || fileSummary;
}

export function isSupportedSlackControlSubtype(subtype: string | null | undefined) {
  const normalized = readNonEmptyString(subtype);
  if (!normalized) {
    return true;
  }
  return SUPPORTED_SLACK_CONTROL_SUBTYPES.has(normalized);
}

function extractSlackMentionIds(text: string) {
  return Array.from(
    new Set(
      Array.from(text.matchAll(/<@([A-Z0-9]+)>/gi))
        .map((match) => match[1]?.trim().toUpperCase() ?? "")
        .filter(Boolean),
    ),
  );
}

function extractPlainAgentMentions(text: string) {
  return Array.from(
    new Set(
      Array.from(text.matchAll(/\B@([^\s@,!?.:;()[\]{}<>]+)/g))
        .map((match) => match[1]?.trim() ?? "")
        .filter(Boolean),
    ),
  );
}

function normalizeLookupKey(value: string | null | undefined) {
  return normalizeReferenceAlias(value) ?? null;
}

function uniqueStrings(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value))));
}

function parseSlackLookupMappings(value: string | null | undefined) {
  const raw = readNonEmptyString(value);
  if (!raw) return new Map<string, string>();
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return new Map<string, string>();
    }
    return new Map(
      Object.entries(parsed as Record<string, unknown>)
        .map(([key, entry]) => {
          const normalizedKey = normalizeLookupKey(key);
          const normalizedValue = readNonEmptyString(String(entry ?? ""));
          return normalizedKey && normalizedValue ? [normalizedKey, normalizedValue] as const : null;
        })
        .filter((entry): entry is readonly [string, string] => Boolean(entry)),
    );
  } catch {
    return new Map<string, string>();
  }
}

function isSameSlackThread(
  left: Pick<SlackThreadLink, "channelId" | "threadTs"> | null | undefined,
  right: { channelId: string; threadTs: string },
) {
  if (!left) return false;
  return left.channelId === right.channelId && left.threadTs === right.threadTs;
}

function buildSlackThreadPointer(link: SlackThreadLink) {
  return `channel ${link.channelId}, thread ${link.threadTs}`;
}

function formatReadableAgentLabel(input: { name: string; title?: string | null; role?: string | null }) {
  const baseName = input.name.trim();
  const title = readNonEmptyString(input.title);
  if (title && title !== baseName) {
    return `${baseName} (${title})`;
  }
  const role = readNonEmptyString(input.role);
  if (role && role !== baseName) {
    return `${baseName} (${role})`;
  }
  return baseName || "Slack user";
}

function toSlackIssue(issue: SlackIssue | null | undefined): SlackIssue | null {
  if (!issue) return null;
  return {
    id: issue.id,
    companyId: issue.companyId,
    projectId: issue.projectId ?? null,
    identifier: issue.identifier ?? null,
    title: issue.title,
    status: issue.status,
    priority: issue.priority,
    assigneeAgentId: issue.assigneeAgentId ?? null,
    assigneeUserId: issue.assigneeUserId ?? null,
  };
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

function toSlackApprovalThreadLink(
  row: typeof slackApprovalThreadLinks.$inferSelect,
): SlackApprovalThreadLink {
  return {
    id: row.id,
    companyId: row.companyId,
    approvalId: row.approvalId,
    projectId: row.projectId,
    projectSlackChannelId: row.projectSlackChannelId,
    channelId: row.channelId,
    threadTs: row.threadTs,
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

function buildSlackApprovalCommentBody(input: {
  text: string;
  slackUserId?: string | null;
  channelId: string;
  threadTs: string;
}) {
  return [
    `Slack approval-thread reply from ${input.slackUserId ? `<@${input.slackUserId}>` : "unknown-user"}`,
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
    `OrchestorAI issue: *${issueDisplay(issue)}*`,
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

function toCompanyChatRoom(row: typeof companyChatRooms.$inferSelect): CompanyChatRoom {
  return {
    ...row,
    status: row.status as CompanyChatRoom["status"],
    allowedTopics: Array.isArray(row.allowedTopics)
      ? (row.allowedTopics as unknown as CompanyChatRoom["allowedTopics"])
      : [],
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

async function slackManifestExport(input: {
  manifestToken: string;
  appId: string;
}) {
  const params = new URLSearchParams();
  params.set("app_id", input.appId);
  const response = await fetch("https://slack.com/api/apps.manifest.export", {
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
    manifest?: Record<string, unknown>;
  };
  if (!response.ok || !json.ok) {
    throw new SlackApiError(
      "Slack API call failed: apps.manifest.export",
      json.error ?? `http_${response.status}`,
      json,
    );
  }
  return json;
}

async function slackManifestUpdate(input: {
  manifestToken: string;
  appId: string;
  manifest: Record<string, unknown>;
}) {
  const params = new URLSearchParams();
  params.set("app_id", input.appId);
  params.set("manifest", JSON.stringify(input.manifest));
  const response = await fetch("https://slack.com/api/apps.manifest.update", {
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
  };
  if (!response.ok || !json.ok) {
    throw new SlackApiError(
      "Slack API call failed: apps.manifest.update",
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
  const agentsSvc = agentService(db);
  const heartbeat = heartbeatService(db);
  const socialRooms = socialRoomService(db);
  const issueCommands = issueCommandService(db);
  const interpreter = slackActionInterpreterService({ instanceSettings });
  const approvalsSvc = approvalService(db);
  const hostCommandSvc = hostCommandFallbackService(db);
  const issuesSvc = issueService(db);
  const projectsSvc = projectService(db);
  const slackUserLabelCache = new Map<string, Promise<string>>();
  const slackChannelLabelCache = new Map<string, Promise<string>>();
  const slackThreadPermalinkCache = new Map<string, Promise<string | null>>();

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
        description: `OrchestorAI-managed Slack ${kind} for agent ${agentId}`,
      },
      actor,
    );
  }

  async function getControlClient() {
    const controlBotToken = instanceSettings.getRuntimeSecretValue("slackBotToken");
    return controlBotToken ? new SlackWebClient(controlBotToken) : null;
  }

  function createControlThreadStatusController(input: {
    channelId: string;
    threadTs: string;
  }) {
    let stopped = false;
    let currentStatus = "";
    let intervalId: ReturnType<typeof setInterval> | null = null;
    let clientPromise: Promise<SlackWebClient | null> | null = null;

    const getClient = async () => {
      clientPromise ??= getControlClient();
      return clientPromise;
    };

    const clearRefresh = () => {
      if (!intervalId) return;
      clearInterval(intervalId);
      intervalId = null;
    };

    const pushStatus = async (status: string) => {
      const client = await getClient();
      if (!client) return;
      try {
        await client.setThreadStatus({
          channelId: input.channelId,
          threadTs: input.threadTs,
          status,
        });
      } catch (error) {
        logger.debug(
          {
            err: error,
            channelId: input.channelId,
            threadTs: input.threadTs,
            status,
          },
          "failed to update Slack control thread status",
        );
      }
    };

    const ensureRefresh = () => {
      if (intervalId || !currentStatus) return;
      intervalId = setInterval(() => {
        if (stopped || !currentStatus) {
          clearRefresh();
          return;
        }
        void pushStatus(currentStatus);
      }, SLACK_THREAD_STATUS_REFRESH_MS);
    };

    return {
      async start(status: string) {
        if (stopped) return;
        currentStatus = status;
        await pushStatus(status);
        ensureRefresh();
      },
      async update(status: string) {
        if (stopped || !status || status === currentStatus) return;
        currentStatus = status;
        await pushStatus(status);
        ensureRefresh();
      },
      async stop() {
        if (stopped) return;
        stopped = true;
        clearRefresh();
        if (!currentStatus) return;
        currentStatus = "";
        await pushStatus("");
      },
    };
  }

  async function setSlackThreadStatusBestEffort(input: {
    channelId: string;
    threadTs: string;
    status: string;
    runId?: string;
    chatThreadId?: string;
  }) {
    const client = await getControlClient();
    if (!client) return;
    try {
      await client.setThreadStatus({
        channelId: input.channelId,
        threadTs: input.threadTs,
        status: input.status,
      });
    } catch (error) {
      logger.debug(
        {
          err: error,
          channelId: input.channelId,
          threadTs: input.threadTs,
          status: input.status,
          runId: input.runId,
          chatThreadId: input.chatThreadId,
        },
        "failed to update Slack social-room thread status",
      );
    }
  }

  async function resolveSlackUserLabel(input: {
    companyId: string;
    slackUserId?: string | null;
  }) {
    const slackUserId = readNonEmptyString(input.slackUserId);
    if (!slackUserId) return "Slack user";

    const cacheKey = `${input.companyId}:${slackUserId}`;
    const cached = slackUserLabelCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const promise = (async () => {
      const agentRow = await db
        .select({
          name: agents.name,
          title: agents.title,
          role: agents.role,
        })
        .from(agentSlackApps)
        .innerJoin(agents, eq(agentSlackApps.agentId, agents.id))
        .where(and(
          eq(agentSlackApps.companyId, input.companyId),
          eq(agentSlackApps.botUserId, slackUserId),
        ))
        .then((rows) => rows[0] ?? null);
      if (agentRow) {
        return formatReadableAgentLabel(agentRow);
      }

      const client = await getControlClient();
      if (client) {
        try {
          const result = await client.getUserInfo({ userId: slackUserId });
          const user = result.user;
          const label = readNonEmptyString(
            user?.profile?.display_name_normalized
            ?? user?.profile?.display_name
            ?? user?.real_name_normalized
            ?? user?.real_name
            ?? user?.name,
          );
          if (label) {
            return label;
          }
        } catch (error) {
          logger.debug({ err: error, slackUserId }, "failed to resolve Slack user label");
        }
      }

      return "Slack user";
    })();

    slackUserLabelCache.set(cacheKey, promise);
    return promise;
  }

  async function resolveSlackChannelLabel(input: {
    channelId: string;
    channelName?: string | null;
  }) {
    const channelId = readNonEmptyString(input.channelId);
    if (!channelId) return "Slack channel";
    const directName = readNonEmptyString(input.channelName);
    if (directName) {
      return `#${directName}`;
    }

    const cached = slackChannelLabelCache.get(channelId);
    if (cached) {
      return cached;
    }

    const promise = db
      .select({ channelName: projectSlackChannels.channelName })
      .from(projectSlackChannels)
      .where(eq(projectSlackChannels.channelId, channelId))
      .then((rows) => rows[0] ?? null)
      .then((row) => {
        const channelName = readNonEmptyString(row?.channelName);
        return channelName ? `#${channelName}` : "Slack channel";
      });

    slackChannelLabelCache.set(channelId, promise);
    return promise;
  }

  async function resolveSlackThreadPermalink(input: {
    channelId: string;
    threadTs: string;
  }) {
    const channelId = readNonEmptyString(input.channelId);
    const threadTs = readNonEmptyString(input.threadTs);
    if (!channelId || !threadTs) return null;

    const cacheKey = `${channelId}:${threadTs}`;
    const cached = slackThreadPermalinkCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const promise = (async () => {
      const client = await getControlClient();
      if (!client) return null;
      try {
        const result = await client.getPermalink({
          channel: channelId,
          messageTs: threadTs,
        });
        return readNonEmptyString(result.permalink);
      } catch (error) {
        logger.debug({ err: error, channelId, threadTs }, "failed to resolve Slack thread permalink");
        return null;
      }
    })();

    slackThreadPermalinkCache.set(cacheKey, promise);
    return promise;
  }

  async function formatSlackTextForBoard(input: {
    companyId: string;
    text: string;
  }) {
    let formatted = input.text.trim();
    for (const slackUserId of extractSlackMentionIds(formatted)) {
      const label = await resolveSlackUserLabel({
        companyId: input.companyId,
        slackUserId,
      });
      formatted = formatted.replaceAll(`<@${slackUserId}>`, label);
    }
    return formatted;
  }

  async function buildSlackOriginDescription(input: {
    companyId: string;
    text: string;
    slackUserId?: string | null;
    channelId: string;
    channelName?: string | null;
    threadTs: string;
  }) {
    const [userLabel, channelLabel, threadPermalink, formattedText] = await Promise.all([
      resolveSlackUserLabel({ companyId: input.companyId, slackUserId: input.slackUserId }),
      resolveSlackChannelLabel({ channelId: input.channelId, channelName: input.channelName }),
      resolveSlackThreadPermalink({ channelId: input.channelId, threadTs: input.threadTs }),
      formatSlackTextForBoard({ companyId: input.companyId, text: input.text }),
    ]);

    return [
      "_Created from Slack_",
      `Requested by: ${userLabel}`,
      `Channel: ${channelLabel}`,
      `Thread: ${threadPermalink ?? `${channelLabel} thread`}`,
      "",
      formattedText,
    ].join("\n");
  }

  async function buildSlackCommentBody(input: {
    companyId: string;
    text: string;
    slackUserId?: string | null;
    channelId: string;
    channelName?: string | null;
    threadTs: string;
  }) {
    const [userLabel, channelLabel, threadPermalink, formattedText] = await Promise.all([
      resolveSlackUserLabel({ companyId: input.companyId, slackUserId: input.slackUserId }),
      resolveSlackChannelLabel({ channelId: input.channelId, channelName: input.channelName }),
      resolveSlackThreadPermalink({ channelId: input.channelId, threadTs: input.threadTs }),
      formatSlackTextForBoard({ companyId: input.companyId, text: input.text }),
    ]);

    return [
      `Slack reply from ${userLabel}`,
      `Channel: ${channelLabel}`,
      `Thread: ${threadPermalink ?? `${channelLabel} thread`}`,
      "",
      formattedText,
    ].join("\n");
  }

  async function buildSlackActionCommentBody(input: {
    companyId: string;
    text: string;
    summary?: string | null;
    slackUserId?: string | null;
    channelId: string;
    channelName?: string | null;
    threadTs: string;
  }) {
    const rawSummary = readNonEmptyString(input.summary);
    const [summary, formattedOriginal, original] = await Promise.all([
      rawSummary
        ? formatSlackTextForBoard({
            companyId: input.companyId,
            text: rawSummary,
          })
        : Promise.resolve<string | null>(null),
      formatSlackTextForBoard({
        companyId: input.companyId,
        text: input.text,
      }),
      buildSlackCommentBody(input),
    ]);

    if (!summary || collapseWhitespace(summary) === collapseWhitespace(formattedOriginal)) {
      return original;
    }
    return [
      summary,
      "",
      "---",
      "",
      original,
    ].join("\n");
  }

  function buildSlackActionDetails(input: {
    channelId: string;
    threadTs: string;
    slackUserId?: string | null;
    slackUserName?: string | null;
    messageTs?: string | null;
    eventId?: string | null;
  }) {
    return {
      source: "slack",
      slackChannelId: input.channelId,
      slackThreadTs: input.threadTs,
      slackUserId: input.slackUserId ?? null,
      slackUserName: input.slackUserName ?? null,
      slackMessageTs: input.messageTs ?? null,
      slackEventId: input.eventId ?? null,
    };
  }

  async function createSlackActionRun(input: {
    companyId: string;
    projectId: string | null;
    issueId: string | null;
    eventId: string;
    channelId: string;
    threadTs: string;
    messageTs: string;
    slackUserId: string | null;
    slackUserName: string | null;
    requestText: string;
    normalizedText: string;
  }) {
    return db
      .insert(slackActionRuns)
      .values({
        companyId: input.companyId,
        projectId: input.projectId,
        issueId: input.issueId,
        eventId: input.eventId,
        channelId: input.channelId,
        threadTs: input.threadTs,
        messageTs: input.messageTs,
        slackUserId: input.slackUserId,
        slackUserName: input.slackUserName,
        status: "received",
        requestText: input.requestText,
        normalizedText: input.normalizedText,
      })
      .returning()
      .then((rows) => rows[0] ?? null);
  }

  async function updateSlackActionRun(
    actionRunId: string,
    input: {
      projectId?: string | null;
      issueId?: string | null;
      status: SlackActionRunStatus;
      actionType?: string | null;
      confidence?: number | null;
      interpreterResult?: SlackControlInterpreterResult | null;
      executionResult?: Record<string, unknown> | null;
      error?: string | null;
    },
  ) {
    await db
      .update(slackActionRuns)
      .set({
        ...(input.projectId !== undefined ? { projectId: input.projectId } : {}),
        ...(input.issueId !== undefined ? { issueId: input.issueId } : {}),
        status: input.status,
        actionType: input.actionType ?? null,
        confidence:
          typeof input.confidence === "number" && Number.isFinite(input.confidence)
            ? input.confidence.toFixed(3)
            : null,
        interpreterResult: input.interpreterResult
          ? (input.interpreterResult as unknown as Record<string, unknown>)
          : null,
        executionResult: input.executionResult ?? null,
        error: input.error ?? null,
        updatedAt: new Date(),
      })
      .where(eq(slackActionRuns.id, actionRunId));
  }

  async function postControlThreadReply(input: {
    channelId: string;
    threadTs: string;
    text: string;
  }) {
    const client = await getControlClient();
    if (!client) return null;
    try {
      return await client.postMessage({
        channel: input.channelId,
        threadTs: input.threadTs,
        text: input.text,
      });
    } catch (error) {
      logger.warn(
        { err: error, channelId: input.channelId, threadTs: input.threadTs },
        "failed to post Slack control reply",
      );
      return null;
    }
  }

  async function listRecentSlackMessages(channelId: string, threadTs: string) {
    const client = await getControlClient();
    if (!client) return [];
    try {
      const result = await client.listThreadReplies({
        channel: channelId,
        threadTs,
        limit: interpreter.getSettings().contextLimit,
      });
      return (result.messages ?? [])
        .filter((message) => !message.bot_id && !message.subtype)
        .map((message) => ({
          author: readNonEmptyString(message.user),
          text: collapseWhitespace(message.text ?? ""),
          ts: readNonEmptyString(message.ts) ?? threadTs,
        }))
        .filter((entry) => entry.text.length > 0);
    } catch (error) {
      logger.debug({ err: error, channelId, threadTs }, "failed to load recent Slack thread replies");
      return [];
    }
  }

  async function loadAgentCandidates(companyId: string) {
    const mappingEntries = parseSlackLookupMappings(
      instanceSettings.getRuntimeValue("slackAgentMappingsJson"),
    );
    const rows = await agentsSvc.list(companyId);
    const agentIds = rows.map((agent) => agent.id);
    const installedApps = agentIds.length
      ? await db
          .select({
            agentId: agentSlackApps.agentId,
            botUserId: agentSlackApps.botUserId,
            slackAppId: agentSlackApps.slackAppId,
            installStatus: agentSlackApps.installStatus,
          })
          .from(agentSlackApps)
          .where(and(
            eq(agentSlackApps.companyId, companyId),
            inArray(agentSlackApps.agentId, agentIds),
          ))
      : [];
    const installedAppByAgentId = new Map(
      installedApps.map((app) => [app.agentId, app]),
    );
    const candidates: SlackInterpreterCandidateAgent[] = rows.map((agent) => {
      const aliases = readReferenceAliases(agent.metadata)?.aliases ?? [];
      const installedApp = installedAppByAgentId.get(agent.id);
      const slackKeys = Array.from(mappingEntries.entries())
        .filter(([, value]) => {
          const normalizedValue = normalizeLookupKey(value);
          return (
            value === agent.id ||
            normalizedValue === normalizeLookupKey(agent.id) ||
            normalizedValue === normalizeLookupKey(agent.urlKey) ||
            normalizedValue === normalizeLookupKey(agent.name) ||
            aliases.includes(normalizedValue ?? "")
          );
        })
        .map(([key]) => key);
      if (installedApp?.installStatus === "active") {
        const botUserId = readNonEmptyString(installedApp.botUserId);
        if (botUserId) {
          slackKeys.push(botUserId);
        }
        const slackAppId = readNonEmptyString(installedApp.slackAppId);
        if (slackAppId) {
          slackKeys.push(slackAppId);
        }
      }
      return {
        id: agent.id,
        name: agent.name,
        urlKey: readNonEmptyString(agent.urlKey),
        aliases,
        slackKeys: uniqueStrings(slackKeys),
      };
    });
    return {
      mappings: mappingEntries,
      candidates,
    };
  }

  async function loadProjectCandidates(companyId: string) {
    const mappingEntries = parseSlackLookupMappings(
      instanceSettings.getRuntimeValue("slackProjectMappingsJson"),
    );
    const rows = await projectsSvc.list(companyId);
    const candidates: SlackInterpreterCandidateProject[] = rows.map((project) => {
      const aliases = readReferenceAliases(project.metadata)?.aliases ?? [];
      const slackKeys = Array.from(mappingEntries.entries())
        .filter(([, value]) => {
          const normalizedValue = normalizeLookupKey(value);
          return (
            value === project.id ||
            normalizedValue === normalizeLookupKey(project.id) ||
            normalizedValue === normalizeLookupKey(project.urlKey) ||
            normalizedValue === normalizeLookupKey(project.name) ||
            aliases.includes(normalizedValue ?? "")
          );
        })
        .map(([key]) => key);
      return {
        id: project.id,
        name: project.name,
        urlKey: readNonEmptyString(project.urlKey),
        aliases,
        slackKeys,
      };
    });
    return {
      mappings: mappingEntries,
      candidates,
    };
  }

  function resolveAgentReference(
    ref: string | null | undefined,
    candidates: SlackInterpreterCandidateAgent[],
    mappings: Map<string, string>,
  ) {
    const raw = readNonEmptyString(ref);
    if (!raw) return null;
    const normalized = normalizeLookupKey(raw);
    const mapped = normalized ? mappings.get(normalized) : null;

    const exact = candidates.find((candidate) => candidate.id === raw);
    if (exact) return exact;

    const mappedCandidate = mapped
      ? candidates.find((candidate) => candidate.id === mapped)
      : null;
    if (mappedCandidate) return mappedCandidate;

    if (normalized) {
      const byAlias = candidates.find((candidate) =>
        candidate.aliases.includes(normalized) ||
        candidate.slackKeys.includes(normalized) ||
        normalizeLookupKey(candidate.urlKey) === normalized ||
        normalizeLookupKey(candidate.name) === normalized,
      );
      if (byAlias) return byAlias;
    }

    return null;
  }

  function resolveMentionedAgentIds(
    text: string,
    candidates: SlackInterpreterCandidateAgent[],
    mappings: Map<string, string>,
  ) {
    const tokens = uniqueStrings([
      ...extractSlackMentionIds(text),
      ...extractPlainAgentMentions(text),
    ]);
    return uniqueStrings(
      tokens
        .map((token) => resolveAgentReference(token, candidates, mappings)?.id ?? null),
    );
  }

  function resolveProjectReference(
    ref: string | null | undefined,
    candidates: SlackInterpreterCandidateProject[],
    mappings: Map<string, string>,
  ) {
    const raw = readNonEmptyString(ref);
    if (!raw) return null;
    const normalized = normalizeLookupKey(raw);
    const mapped = normalized ? mappings.get(normalized) : null;

    const exact = candidates.find((candidate) => candidate.id === raw);
    if (exact) return exact;

    const mappedCandidate = mapped
      ? candidates.find((candidate) => candidate.id === mapped)
      : null;
    if (mappedCandidate) return mappedCandidate;

    if (normalized) {
      const byAlias = candidates.find((candidate) =>
        candidate.aliases.includes(normalized) ||
        candidate.slackKeys.includes(normalized) ||
        normalizeLookupKey(candidate.urlKey) === normalized ||
        normalizeLookupKey(candidate.name) === normalized,
      );
      if (byAlias) return byAlias;
    }

    return null;
  }

  async function loadIssueCandidates(input: {
    companyId: string;
    projectId: string | null;
    normalizedText: string;
    linkedIssue: SlackIssue | null;
  }) {
    const candidates = new Map<string, SlackInterpreterCandidateIssue>();
    const addIssue = (issue: SlackIssue | null | undefined, projectName: string | null = null) => {
      if (!issue) return;
      candidates.set(issue.id, {
        id: issue.id,
        identifier: issue.identifier ?? null,
        title: issue.title,
        projectId: issue.projectId ?? null,
        projectName,
        status: issue.status,
        priority: issue.priority,
        assigneeAgentId: issue.assigneeAgentId ?? null,
      });
    };

    if (input.linkedIssue) {
      addIssue(input.linkedIssue, await getProjectName(input.linkedIssue.projectId));
    }

    const identifierMatches = uniqueStrings(
      Array.from(input.normalizedText.matchAll(/\b([A-Z]+-\d+)\b/gi)).map(
        (match) => match[1]?.toUpperCase() ?? "",
      ),
    );
    for (const identifier of identifierMatches) {
      const issue = await issuesSvc.getByIdentifier(identifier);
      if (issue && issue.companyId === input.companyId) {
        addIssue(issue, await getProjectName(issue.projectId));
      }
    }

    const searchText = input.normalizedText.slice(0, 160);
    if (searchText.length > 0) {
      const matches = await issuesSvc.list(input.companyId, {
        ...(input.projectId ? { projectId: input.projectId } : {}),
        q: searchText,
      });
      for (const issue of matches.slice(0, 8)) {
        addIssue(issue, await getProjectName(issue.projectId));
      }
    }

    return Array.from(candidates.values());
  }

  async function resolveIssueReference(
    ref: string | null | undefined,
    input: {
      companyId: string;
      linkedIssue: SlackIssue | null;
      candidateIssues: SlackInterpreterCandidateIssue[];
    },
  ) {
    const raw = readNonEmptyString(ref);
    if (!raw) return input.linkedIssue;
    if (input.linkedIssue) {
      const normalized = raw.toLowerCase();
      if (normalized === "this" || normalized === "current" || normalized === "it") {
        return input.linkedIssue;
      }
    }

    const directId = await issuesSvc.getById(raw);
    if (directId && directId.companyId === input.companyId) return directId;

    if (/^[A-Z]+-\d+$/i.test(raw)) {
      const byIdentifier = await issuesSvc.getByIdentifier(raw.toUpperCase());
      if (byIdentifier && byIdentifier.companyId === input.companyId) return byIdentifier;
    }

    const byCandidate = input.candidateIssues.find((issue) =>
      issue.id === raw ||
      issue.identifier === raw.toUpperCase() ||
      collapseWhitespace(issue.title).toLowerCase() === collapseWhitespace(raw).toLowerCase(),
    );
    if (byCandidate) {
      return issuesSvc.getById(byCandidate.id);
    }

    return null;
  }

  async function buildInterpreterInput(input: {
    projectChannel: typeof projectSlackChannels.$inferSelect;
    threadLink: SlackThreadLink | null;
    event: SlackControlMessageEvent;
    originalText: string;
    normalizedText: string;
    threadTs: string;
    isThreadReply: boolean;
  }): Promise<{
    messageContext: SlackControlMessageContext;
    payload: SlackActionInterpreterInput;
    mappedAgents: Map<string, string>;
    mappedProjects: Map<string, string>;
  }> {
    const linkedIssue = input.threadLink
      ? await issuesSvc.getById(input.threadLink.issueId)
      : null;
    const project = input.projectChannel.projectId
      ? await projectsSvc.getById(input.projectChannel.projectId)
      : null;
    const projectChannelId = input.projectChannel.channelId ?? "";
    const recentSlackMessages = await listRecentSlackMessages(
      projectChannelId,
      input.threadTs,
    );
    const recentIssueComments = linkedIssue
      ? (await issuesSvc.listComments(linkedIssue.id))
          .slice(0, interpreter.getSettings().contextLimit)
          .reverse()
          .map((comment) => ({
            authorAgentId: comment.authorAgentId ?? null,
            authorUserId: comment.authorUserId ?? null,
            body: comment.body,
            createdAt: comment.createdAt.toISOString(),
          }))
      : [];

    const { candidates: candidateAgents, mappings: mappedAgents } = await loadAgentCandidates(
      input.projectChannel.companyId,
    );
    const { candidates: candidateProjects, mappings: mappedProjects } = await loadProjectCandidates(
      input.projectChannel.companyId,
    );
    const candidateIssues = await loadIssueCandidates({
      companyId: input.projectChannel.companyId,
      projectId: input.projectChannel.projectId,
      normalizedText: input.normalizedText,
      linkedIssue,
    });

    const messageContext: SlackControlMessageContext = {
      companyId: input.projectChannel.companyId,
      projectId: input.projectChannel.projectId,
      issueId: linkedIssue?.id ?? null,
      channelId: projectChannelId,
      channelName: input.projectChannel.channelName,
      threadTs: input.threadTs,
      messageTs: readNonEmptyString(input.event.ts) ?? input.threadTs,
      authorSlackUserId: readNonEmptyString(input.event.user),
      authorSlackUserName: null,
      originalText: input.originalText,
      normalizedText: input.normalizedText,
      isThreadReply: input.isThreadReply,
      isLinkedIssueThread: Boolean(input.threadLink),
      isRootProjectMessage: !input.isThreadReply,
    };

    return {
      messageContext,
      mappedAgents,
      mappedProjects,
      payload: {
        message: messageContext,
        project: project
          ? {
              id: project.id,
              name: project.name,
              urlKey: project.urlKey ?? null,
              status: project.status,
            }
          : null,
        linkedIssue: linkedIssue
          ? {
              id: linkedIssue.id,
              identifier: linkedIssue.identifier ?? null,
              title: linkedIssue.title,
              description: linkedIssue.description ?? null,
              projectId: linkedIssue.projectId ?? null,
              status: linkedIssue.status,
              priority: linkedIssue.priority,
              assigneeAgentId: linkedIssue.assigneeAgentId ?? null,
              assigneeUserId: linkedIssue.assigneeUserId ?? null,
            }
          : null,
        recentSlackMessages,
        recentIssueComments,
        candidateAgents,
        candidateProjects,
        candidateIssues,
      },
    };
  }

  async function executeSlackAction(input: {
    projectChannel: typeof projectSlackChannels.$inferSelect;
    threadLink: SlackThreadLink | null;
    threadTs: string;
    eventId: string;
    event: SlackControlMessageEvent;
    interpretation: SlackControlInterpreterResult;
    messageContext: SlackControlMessageContext;
    mappedAgents: Map<string, string>;
    mappedProjects: Map<string, string>;
    candidateAgents: SlackInterpreterCandidateAgent[];
    candidateProjects: SlackInterpreterCandidateProject[];
    candidateIssues: SlackInterpreterCandidateIssue[];
  }): Promise<SlackActionExecutionOutcome> {
    const mutation = input.interpretation.normalizedMutation;
    const actionType = input.interpretation.actionType;
    const issueRef = mutation?.issueRef ?? input.interpretation.targetIssueRef;
    const parentIssueRef = mutation?.parentIssueRef ?? input.interpretation.targetIssueRef;
    const agentRef = mutation?.assigneeAgentRef ?? input.interpretation.targetAgentRef;
    const projectRef = mutation?.projectRef ?? input.interpretation.targetProjectRef;
    const linkedIssue = input.threadLink ? await issuesSvc.getById(input.threadLink.issueId) : null;

    if (
      actionType === "clarify" ||
      input.interpretation.needsClarification ||
      (actionType !== "query" && actionType !== "noop" && input.interpretation.confidence < SLACK_AUTO_APPLY_CONFIDENCE)
    ) {
      return {
        status: "clarification",
        slackReply: input.interpretation.slackReply,
        issue: toSlackIssue(linkedIssue),
        canonicalLink: input.threadLink,
        executionResult: {
          actionType,
          reason: input.interpretation.reasons,
        },
      };
    }

    if (actionType === "query" || actionType === "noop") {
      return {
        status: "ignored",
        slackReply: input.interpretation.slackReply,
        issue: toSlackIssue(linkedIssue),
        canonicalLink: input.threadLink,
        executionResult: {
          actionType,
        },
      };
    }

    const resolvedAgent = resolveAgentReference(agentRef, input.candidateAgents, input.mappedAgents);
    const resolvedProject =
      resolveProjectReference(projectRef, input.candidateProjects, input.mappedProjects)
      ?? input.candidateProjects.find((project) => project.id === input.projectChannel.projectId)
      ?? null;
    const resolvedIssue = await resolveIssueReference(issueRef, {
      companyId: input.projectChannel.companyId,
      linkedIssue,
      candidateIssues: input.candidateIssues,
    });
    const resolvedParentIssue = await resolveIssueReference(parentIssueRef, {
      companyId: input.projectChannel.companyId,
      linkedIssue,
      candidateIssues: input.candidateIssues,
    });
    const mentionedAgentIds = resolveMentionedAgentIds(
      input.messageContext.originalText,
      input.candidateAgents,
      input.mappedAgents,
    );
    const details = buildSlackActionDetails({
      channelId: input.projectChannel.channelId ?? input.messageContext.channelId,
      threadTs: input.threadTs,
      slackUserId: input.event.user ?? null,
      slackUserName: null,
      messageTs: input.event.ts ?? null,
      eventId: input.eventId,
    });
    const actor = {
      actorType: "system" as const,
      actorId: SLACK_SYSTEM_ACTOR_ID,
      agentId: null,
      runId: null,
    };

    switch (actionType) {
      case "create_issue": {
        const projectId = resolvedProject?.id ?? input.projectChannel.projectId;
        const title = readNonEmptyString(mutation?.title);
        if (!projectId || !title) {
          return {
            status: "clarification",
            slackReply: "I need a project and a ticket title before I can create that issue.",
            issue: null,
            canonicalLink: input.threadLink,
            executionResult: { actionType, missing: ["projectId", "title"] },
          };
        }

        const issue = await issueCommands.createIssue(
          input.projectChannel.companyId,
          {
            projectId,
            title,
            description: await buildSlackOriginDescription({
              companyId: input.projectChannel.companyId,
              text: mutation?.description ?? input.messageContext.originalText,
              slackUserId: input.event.user ?? null,
              channelId: input.projectChannel.channelId ?? input.messageContext.channelId,
              channelName: input.projectChannel.channelName,
              threadTs: input.threadTs,
            }),
            status: mutation?.status ?? (resolvedAgent ? "todo" : "backlog"),
            priority: mutation?.priority ?? "medium",
            assigneeAgentId: resolvedAgent?.id ?? null,
          },
          actor,
          { details },
        );

        const link = await activateThreadLink({
          companyId: issue.companyId,
          issueId: issue.id,
          projectId: issue.projectId ?? null,
          projectSlackChannelId: input.projectChannel.id,
          channelId: input.projectChannel.channelId ?? input.messageContext.channelId,
          threadTs: input.threadTs,
        });

        const persistedComment = mutation?.commentBody || input.interpretation.commentaryToPersist
          ? await buildSlackActionCommentBody({
              companyId: input.projectChannel.companyId,
              text: input.messageContext.originalText,
              summary: mutation?.commentBody ?? input.interpretation.commentaryToPersist,
              slackUserId: input.event.user ?? null,
              channelId: input.projectChannel.channelId ?? input.messageContext.channelId,
              channelName: input.projectChannel.channelName,
              threadTs: input.threadTs,
            })
          : null;
        if (persistedComment) {
          await issueCommands.addComment(issue.id, persistedComment, actor, {
            details,
            mentionedAgentIds,
          });
        }

        return {
          status: "executed",
          slackReply: input.interpretation.slackReply,
          issue: toSlackIssue(issue),
          canonicalLink: link,
          executionResult: {
            actionType,
            issueId: issue.id,
            identifier: issue.identifier,
          },
        };
      }

      case "create_child_issue": {
        const parentIssue = resolvedParentIssue ?? linkedIssue;
        const title = readNonEmptyString(mutation?.title);
        const projectId = resolvedProject?.id ?? parentIssue?.projectId ?? input.projectChannel.projectId;
        if (!parentIssue || !projectId || !title) {
          return {
            status: "clarification",
            slackReply: "I need the parent issue and child ticket title before I can create that subtask.",
            issue: toSlackIssue(parentIssue),
            canonicalLink: input.threadLink,
            executionResult: { actionType, missing: ["parentIssue", "projectId", "title"] },
          };
        }

        const issue = await issueCommands.createIssue(
          input.projectChannel.companyId,
          {
            projectId,
            parentId: parentIssue.id,
            title,
            description: await buildSlackOriginDescription({
              companyId: input.projectChannel.companyId,
              text: mutation?.description ?? input.messageContext.originalText,
              slackUserId: input.event.user ?? null,
              channelId: input.projectChannel.channelId ?? input.messageContext.channelId,
              channelName: input.projectChannel.channelName,
              threadTs: input.threadTs,
            }),
            status: mutation?.status ?? (resolvedAgent ? "todo" : "backlog"),
            priority: mutation?.priority ?? "medium",
            assigneeAgentId: resolvedAgent?.id ?? null,
          },
          actor,
          { details },
        );

        const link = await ensureIssueThreadLink(issue);
        const childReply = readNonEmptyString(input.interpretation.slackReply)
          ?? `Created child issue *${issueDisplay(issue)}*.`;
        if (link) {
          await postControlThreadReply({
            channelId: link.channelId,
            threadTs: link.threadTs,
            text: childReply,
          });
        }

        return {
          status: "executed",
          slackReply: childReply,
          issue: toSlackIssue(issue),
          canonicalLink: link,
          executionResult: {
            actionType,
            issueId: issue.id,
            parentIssueId: parentIssue.id,
            identifier: issue.identifier,
          },
        };
      }

      case "update_issue": {
        const issue = resolvedIssue ?? linkedIssue;
        if (!issue) {
          return {
            status: "clarification",
            slackReply: "I could not determine which issue you want to update.",
            issue: null,
            canonicalLink: input.threadLink,
            executionResult: { actionType, missing: ["issue"] },
          };
        }

        const updateFields: Record<string, unknown> = {};
        if (mutation?.title) updateFields.title = mutation.title;
        if (mutation?.description) updateFields.description = mutation.description;
        if (mutation?.status) updateFields.status = mutation.status;
        if (mutation?.priority) updateFields.priority = mutation.priority;
        if (resolvedAgent) updateFields.assigneeAgentId = resolvedAgent.id;
        if (resolvedProject && resolvedProject.id !== issue.projectId) updateFields.projectId = resolvedProject.id;
        if (mutation?.goalRef) updateFields.goalId = mutation.goalRef;

        const commentText =
          readNonEmptyString(mutation?.commentBody)
          ?? readNonEmptyString(input.interpretation.commentaryToPersist)
          ?? (mutation?.persistOriginalMessage ? input.messageContext.originalText : null);
        const commentBody = commentText
          ? await buildSlackActionCommentBody({
              companyId: input.projectChannel.companyId,
              text: input.messageContext.originalText,
              summary: commentText,
              slackUserId: input.event.user ?? null,
              channelId: input.projectChannel.channelId ?? input.messageContext.channelId,
              channelName: input.projectChannel.channelName,
              threadTs: input.threadTs,
            })
          : null;

        if (Object.keys(updateFields).length === 0 && commentBody) {
          const comment = await issueCommands.addComment(issue.id, commentBody, actor, {
            details,
            mentionedAgentIds,
          });
          return {
            status: "executed",
            slackReply: input.interpretation.slackReply,
            issue: toSlackIssue(issue),
            canonicalLink: await getThreadLinkByIssue(issue.id),
            executionResult: {
              actionType: "add_comment",
              issueId: issue.id,
              commentId: comment?.id ?? null,
            },
          };
        }

        if (Object.keys(updateFields).length === 0) {
          return {
            status: "clarification",
            slackReply: "I did not find any concrete issue changes to apply.",
            issue: toSlackIssue(issue),
            canonicalLink: await getThreadLinkByIssue(issue.id),
            executionResult: {
              actionType,
              missing: ["mutation"],
            },
          };
        }

        const updated = await issueCommands.updateIssue(issue.id, updateFields, actor, {
          comment: commentBody,
          details,
          mentionedAgentIds,
        });
        const latestIssue = updated?.issue ?? issue;
        const link =
          Object.prototype.hasOwnProperty.call(updateFields, "projectId")
            ? await ensureIssueThreadLink(latestIssue)
            : await getThreadLinkByIssue(latestIssue.id);

        return {
          status: "executed",
          slackReply: input.interpretation.slackReply,
          issue: toSlackIssue(latestIssue),
          canonicalLink: link,
          executionResult: {
            actionType,
            issueId: latestIssue.id,
            commentId: updated?.comment?.id ?? null,
          },
        };
      }

      case "add_comment": {
        const issue = resolvedIssue ?? linkedIssue;
        if (!issue) {
          return {
            status: "clarification",
            slackReply: "I could not determine which issue should receive that comment.",
            issue: null,
            canonicalLink: input.threadLink,
            executionResult: { actionType, missing: ["issue"] },
          };
        }

        const commentBody = await buildSlackActionCommentBody({
          companyId: input.projectChannel.companyId,
          text: input.messageContext.originalText,
          summary:
            mutation?.commentBody
            ?? input.interpretation.commentaryToPersist
            ?? input.messageContext.originalText,
          slackUserId: input.event.user ?? null,
          channelId: input.projectChannel.channelId ?? input.messageContext.channelId,
          channelName: input.projectChannel.channelName,
          threadTs: input.threadTs,
        });
        const comment = await issueCommands.addComment(issue.id, commentBody, actor, {
          details,
          mentionedAgentIds,
        });
        return {
          status: "executed",
          slackReply: input.interpretation.slackReply,
          issue: toSlackIssue(issue),
          canonicalLink: await getThreadLinkByIssue(issue.id),
          executionResult: {
            actionType,
            issueId: issue.id,
            commentId: comment?.id ?? null,
          },
        };
      }

      case "checkout_issue": {
        const issue = resolvedIssue ?? linkedIssue;
        const checkoutAgent = resolvedAgent
          ?? (issue?.assigneeAgentId
            ? input.candidateAgents.find((candidate) => candidate.id === issue.assigneeAgentId) ?? null
            : null);
        if (!issue || !checkoutAgent) {
          return {
            status: "clarification",
            slackReply: "I need both the target issue and the assignee agent before I can start work.",
            issue: toSlackIssue(issue),
            canonicalLink: input.threadLink,
            executionResult: { actionType, missing: ["issue", "agent"] },
          };
        }

        const updated = await issueCommands.checkoutIssue(
          issue.id,
          checkoutAgent.id,
          mutation?.expectedStatuses?.length ? mutation.expectedStatuses : [issue.status],
          actor,
          null,
          { details },
        );
        return {
          status: "executed",
          slackReply: input.interpretation.slackReply,
          issue: toSlackIssue(updated),
          canonicalLink: await getThreadLinkByIssue(issue.id),
          executionResult: {
            actionType,
            issueId: issue.id,
            agentId: checkoutAgent.id,
          },
        };
      }

      case "release_issue": {
        const issue = resolvedIssue ?? linkedIssue;
        if (!issue) {
          return {
            status: "clarification",
            slackReply: "I could not determine which issue should be released.",
            issue: null,
            canonicalLink: input.threadLink,
            executionResult: { actionType, missing: ["issue"] },
          };
        }
        const released = await issueCommands.releaseIssue(issue.id, actor, null, { details });
        return {
          status: "executed",
          slackReply: input.interpretation.slackReply,
          issue: toSlackIssue(released),
          canonicalLink: await getThreadLinkByIssue(issue.id),
          executionResult: {
            actionType,
            issueId: issue.id,
          },
        };
      }

      default:
        return {
          status: "clarification",
          slackReply: "I could not determine the Slack action to execute.",
          issue: toSlackIssue(linkedIssue),
          canonicalLink: input.threadLink,
          executionResult: {
            actionType,
            unsupported: true,
          },
        };
    }
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

  async function getCompanyChatRoomBySlackChannelId(channelId: string) {
    return db
      .select()
      .from(companyChatRooms)
      .where(eq(companyChatRooms.slackChannelId, channelId))
      .then((rows) => (rows[0] ? toCompanyChatRoom(rows[0]) : null));
  }

  async function ensureCompanyChatRoomChannel(companyId: string): Promise<CompanyChatRoom | null> {
    const room = await db
      .select({
        room: companyChatRooms,
        companyName: companies.name,
      })
      .from(companyChatRooms)
      .innerJoin(companies, eq(companyChatRooms.companyId, companies.id))
      .where(eq(companyChatRooms.companyId, companyId))
      .then((rows) => rows[0] ?? null);
    if (!room) {
      throw notFound("Company chat room not found");
    }

    const desiredChannelName =
      room.room.slackChannelName?.trim() || normalizeSlackChannelName(`${room.companyName} chat room`) || "company-chat-room";

    const controlBotToken = instanceSettings.getRuntimeSecretValue("slackBotToken");
    if (!controlBotToken) {
      return db
        .update(companyChatRooms)
        .set({
          slackChannelName: desiredChannelName,
          status: room.room.slackChannelId ? room.room.status : "pending",
          lastError: "SLACK_BOT_TOKEN is not configured.",
          updatedAt: new Date(),
        })
        .where(eq(companyChatRooms.id, room.room.id))
        .returning()
        .then((rows) => (rows[0] ? toCompanyChatRoom(rows[0]) : null));
    }

    const client = new SlackWebClient(controlBotToken);
    if (room.room.slackChannelId && room.room.status === "active") {
      if (room.room.slackChannelName !== desiredChannelName) {
        try {
          const renamed = await client.renameChannel(room.room.slackChannelId, desiredChannelName);
          return db
            .update(companyChatRooms)
            .set({
              slackChannelName: renamed.channel.name,
              status: "active",
              lastError: null,
              updatedAt: new Date(),
            })
            .where(eq(companyChatRooms.id, room.room.id))
            .returning()
            .then((rows) => (rows[0] ? toCompanyChatRoom(rows[0]) : null));
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return db
            .update(companyChatRooms)
            .set({
              lastError: message,
              updatedAt: new Date(),
            })
            .where(eq(companyChatRooms.id, room.room.id))
            .returning()
            .then((rows) => (rows[0] ? toCompanyChatRoom(rows[0]) : null));
        }
      }
      return toCompanyChatRoom(room.room);
    }

    let createdChannel: { id: string; name: string } | null = null;
    for (let suffix = 1; suffix <= 50; suffix += 1) {
      const candidateName = suffix === 1 ? desiredChannelName : truncate(`${desiredChannelName}-${suffix}`, 80);
      try {
        const created = await client.createChannel({
          name: candidateName,
          isPrivate: false,
        });
        createdChannel = created.channel;
        break;
      } catch (error) {
        if (error instanceof SlackApiError && error.code === "name_taken") {
          if (suffix === 1) {
            try {
              const archivedMatch = await findArchivedChannelByName(client, candidateName, "public");
              if (archivedMatch) {
                try {
                  await client.unarchiveChannel(archivedMatch.id);
                } catch (unarchiveError) {
                  const slackCode = unarchiveError instanceof SlackApiError ? unarchiveError.code : null;
                  if (slackCode !== "not_archived") throw unarchiveError;
                }
                await ensureConfiguredChannelMembers({
                  client,
                  channelId: archivedMatch.id,
                  projectId: room.room.id,
                });
                return db
                  .update(companyChatRooms)
                  .set({
                    slackChannelId: archivedMatch.id,
                    slackChannelName: archivedMatch.name,
                    status: "active",
                    lastError: null,
                    archivedAt: null,
                    updatedAt: new Date(),
                  })
                  .where(eq(companyChatRooms.id, room.room.id))
                  .returning()
                  .then((rows) => (rows[0] ? toCompanyChatRoom(rows[0]) : null));
              }
            } catch (lookupError) {
              logger.warn(
                { err: lookupError, companyId, desiredChannelName: candidateName },
                "failed to reuse archived Slack social-room channel",
              );
            }
          }
          continue;
        }

        const message = error instanceof Error ? error.message : String(error);
        return db
          .update(companyChatRooms)
          .set({
            slackChannelName: candidateName,
            status: "error",
            lastError: message,
            updatedAt: new Date(),
          })
          .where(eq(companyChatRooms.id, room.room.id))
          .returning()
          .then((rows) => (rows[0] ? toCompanyChatRoom(rows[0]) : null));
      }
    }

    if (!createdChannel) {
      return db
        .update(companyChatRooms)
        .set({
          slackChannelName: desiredChannelName,
          status: "error",
          lastError: "Unable to allocate a unique Slack social-room channel name.",
          updatedAt: new Date(),
        })
        .where(eq(companyChatRooms.id, room.room.id))
        .returning()
        .then((rows) => (rows[0] ? toCompanyChatRoom(rows[0]) : null));
    }

    await ensureConfiguredChannelMembers({
      client,
      channelId: createdChannel.id,
      projectId: room.room.id,
    });

    return db
      .update(companyChatRooms)
      .set({
        slackChannelId: createdChannel.id,
        slackChannelName: createdChannel.name,
        status: "active",
        lastError: null,
        archivedAt: null,
        updatedAt: new Date(),
      })
      .where(eq(companyChatRooms.id, room.room.id))
      .returning()
      .then((rows) => (rows[0] ? toCompanyChatRoom(rows[0]) : null));
  }

  async function syncCompanyChatRoom(companyId: string): Promise<CompanyChatRoom | null> {
    return ensureCompanyChatRoomChannel(companyId);
  }

  async function postCompanyChatMessage(input: {
    companyId: string;
    channelId: string;
    text: string;
    threadTs?: string | null;
    agentId?: string | null;
  }) {
    const client = await getAgentPostingClient(input.agentId);
    if (!client) {
      throw new Error("No Slack client is configured for company chat room posting");
    }
    try {
      return await client.postMessage({
        channel: input.channelId,
        text: input.text,
        threadTs: input.threadTs ?? null,
      });
    } catch (error) {
      if (input.agentId) {
        const fallbackClient = await getControlClient();
        if (fallbackClient) {
          return fallbackClient.postMessage({
            channel: input.channelId,
            text: input.text,
            threadTs: input.threadTs ?? null,
          });
        }
      }
      throw error;
    }
  }

  async function postCompanyChatReaction(input: {
    companyId: string;
    channelId: string;
    messageTs: string;
    emoji: string;
    agentId?: string | null;
  }) {
    const client = await getAgentPostingClient(input.agentId);
    if (!client) {
      throw new Error("No Slack client is configured for company chat room reactions");
    }
    try {
      await client.addReaction({
        channel: input.channelId,
        messageTs: input.messageTs,
        emoji: input.emoji,
      });
    } catch (error) {
      if (error instanceof SlackApiError && error.code === "already_reacted") {
        return;
      }
      if (input.agentId) {
        const fallbackClient = await getControlClient();
        if (fallbackClient) {
          try {
            await fallbackClient.addReaction({
              channel: input.channelId,
              messageTs: input.messageTs,
              emoji: input.emoji,
            });
            return;
          } catch (fallbackError) {
            if (fallbackError instanceof SlackApiError && fallbackError.code === "already_reacted") {
              return;
            }
            throw fallbackError;
          }
        }
      }
      throw error;
    }
  }

  async function setCompanyChatThreadStatus(input: {
    channelId: string;
    threadTs: string;
    status: string;
  }) {
    await setSlackThreadStatusBestEffort({
      channelId: input.channelId,
      threadTs: input.threadTs,
      status: input.status,
    });
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

  async function getApprovalThreadLinkBySlackThread(channelId: string, threadTs: string) {
    return db
      .select()
      .from(slackApprovalThreadLinks)
      .where(
        and(
          eq(slackApprovalThreadLinks.channelId, channelId),
          eq(slackApprovalThreadLinks.threadTs, threadTs),
        ),
      )
      .orderBy(desc(slackApprovalThreadLinks.updatedAt), desc(slackApprovalThreadLinks.createdAt))
      .then((rows) => (rows[0] ? toSlackApprovalThreadLink(rows[0]) : null));
  }

  async function upsertApprovalThreadLink(input: {
    companyId: string;
    approvalId: string;
    projectId: string | null;
    projectSlackChannelId: string | null;
    channelId: string;
    threadTs: string;
  }) {
    const updated = await db
      .insert(slackApprovalThreadLinks)
      .values({
        companyId: input.companyId,
        approvalId: input.approvalId,
        projectId: input.projectId,
        projectSlackChannelId: input.projectSlackChannelId,
        channelId: input.channelId,
        threadTs: input.threadTs,
      })
      .onConflictDoUpdate({
        target: [slackApprovalThreadLinks.approvalId],
        set: {
          companyId: input.companyId,
          projectId: input.projectId,
          projectSlackChannelId: input.projectSlackChannelId,
          channelId: input.channelId,
          threadTs: input.threadTs,
          updatedAt: new Date(),
        },
      })
      .returning()
      .then((rows) => rows[0] ?? null);
    return updated ? toSlackApprovalThreadLink(updated) : null;
  }

function parseApprovalDecision(text: string): "once" | "always" | "reject" | null {
    const normalized = stripLeadingSlackMentions(text)
      .trim()
      .toLowerCase()
      .replace(/[.!]+$/g, "");
    if (normalized === "approved for now") return "once";
    if (normalized === "approved always") return "always";
    if (normalized === "reject" || normalized === "rejected") return "reject";
    return null;
  }

  function parseConfiguredSlackApproverIds() {
    return new Set(
      parseSlackMemberIds(instanceSettings.getRuntimeValue("slackBoardApproverUserIds")),
    );
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
        contextSnapshot: heartbeatRuns.contextSnapshot,
      })
      .from(heartbeatRuns)
      .where(eq(heartbeatRuns.id, runId))
      .then((rows) => rows[0] ?? null);
    if (!run) return null;
    const context = parseObject(run.contextSnapshot);
    const issueId = readNonEmptyString(context.issueId);
    if (!issueId) return null;
    return issuesSvc.getById(issueId);
  }

  async function resolveSocialRoomThreadForRun(runId: string) {
    const run = await db
      .select({
        companyId: heartbeatRuns.companyId,
        contextSnapshot: heartbeatRuns.contextSnapshot,
      })
      .from(heartbeatRuns)
      .where(eq(heartbeatRuns.id, runId))
      .then((rows) => rows[0] ?? null);
    if (!run) return null;
    const context = parseObject(run.contextSnapshot);
    const chatThreadId = readNonEmptyString(context.chatThreadId);
    if (!chatThreadId) return null;
    const thread = await socialRooms.getThreadById(chatThreadId);
    if (!thread?.slackChannelId || !thread.slackThreadTs) return null;
    return {
      companyId: run.companyId,
      chatThreadId,
      channelId: thread.slackChannelId,
      threadTs: thread.slackThreadTs,
    };
  }

  async function listActiveSocialRoomResponders(input: {
    companyId: string;
    chatThreadId: string;
  }) {
    const activeRuns = await db
      .select({
        agentId: heartbeatRuns.agentId,
        runStatus: heartbeatRuns.status,
        agentName: agents.name,
      })
      .from(heartbeatRuns)
      .leftJoin(agents, eq(heartbeatRuns.agentId, agents.id))
      .where(
        and(
          eq(heartbeatRuns.companyId, input.companyId),
          inArray(heartbeatRuns.status, ["queued", "running"]),
          sql`${heartbeatRuns.contextSnapshot} ->> 'chatThreadId' = ${input.chatThreadId}`,
        ),
      );

    const deduped = new Map<string, SocialRoomProgressResponder>();
    for (const row of activeRuns) {
      const agentName = readNonEmptyString(row.agentName) ?? "Agent";
      const key = readNonEmptyString(row.agentId) ?? agentName;
      const nextResponder = {
        agentName,
        runStatus: readNonEmptyString(row.runStatus) ?? "queued",
      } satisfies SocialRoomProgressResponder;
      const existing = deduped.get(key);
      if (!existing || (existing.runStatus !== "running" && nextResponder.runStatus === "running")) {
        deduped.set(key, nextResponder);
      }
    }

    return Array.from(deduped.values()).sort((left, right) => {
      if (left.runStatus === right.runStatus) {
        return left.agentName.localeCompare(right.agentName);
      }
      return left.runStatus === "running" ? -1 : 1;
    });
  }

  async function refreshCompanyChatThreadStatus(input: {
    threadId: string;
    fallbackStatus?: string | null;
  }) {
    const thread = await db
      .select({
        id: companyChatThreads.id,
        companyId: companyChatThreads.companyId,
        status: companyChatThreads.status,
        followOnDueAt: companyChatThreads.followOnDueAt,
        slackChannelId: companyChatThreads.slackChannelId,
        slackThreadTs: companyChatThreads.slackThreadTs,
      })
      .from(companyChatThreads)
      .where(eq(companyChatThreads.id, input.threadId))
      .then((rows) => rows[0] ?? null);
    if (!thread?.slackChannelId || !thread.slackThreadTs) {
      return;
    }

    const activeResponders = await listActiveSocialRoomResponders({
      companyId: thread.companyId,
      chatThreadId: thread.id,
    });
    const status = formatSocialRoomThreadProgressStatus({
      activeResponders,
      followOnPending:
        thread.status === "active" &&
        Boolean(thread.followOnDueAt && thread.followOnDueAt.getTime() > Date.now()),
      fallbackStatus: input.fallbackStatus ?? null,
    });

    await setSlackThreadStatusBestEffort({
      channelId: thread.slackChannelId,
      threadTs: thread.slackThreadTs,
      status,
      chatThreadId: thread.id,
    });
  }

  async function forwardSocialRoomRunEventStatus(event: LiveEvent) {
    if (event.type !== "heartbeat.run.queued" && event.type !== "heartbeat.run.status") {
      return;
    }
    const runId = readNonEmptyString(event.payload.runId);
    if (!runId) return;
    const socialThread = await resolveSocialRoomThreadForRun(runId);
    if (!socialThread) return;
    await refreshCompanyChatThreadStatus({
      threadId: socialThread.chatThreadId,
    });
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
          : "OrchestorAI update:";

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

      if (event.type === "heartbeat.run.queued" || event.type === "heartbeat.run.status") {
        await forwardSocialRoomRunEventStatus(event);
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
      description: await buildSlackOriginDescription({
        companyId: input.projectChannel.companyId,
        text: task.description ?? task.sourceText,
        slackUserId: input.event.user ?? null,
        channelId: input.projectChannel.channelId ?? "",
        channelName: input.projectChannel.channelName,
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
      text: `Created OrchestorAI issue *${issueDisplay(issue)}*.`,
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
      await buildSlackCommentBody({
        companyId: issue.companyId,
        text,
        slackUserId: input.event.user ?? null,
        channelId: input.link.channelId,
        channelName: input.link.projectSlackChannelId
          ? await db
              .select({ channelName: projectSlackChannels.channelName })
              .from(projectSlackChannels)
              .where(eq(projectSlackChannels.id, input.link.projectSlackChannelId))
              .then((rows) => rows[0]?.channelName ?? null)
          : null,
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

  async function postHostCommandFallbackApprovalMessage(input: {
    approvalId: string;
    projectId: string | null;
  }) {
    if (!input.projectId) return null;

    const projectSlack = await listProjectSlackState(input.projectId);
    const channel = projectSlack.channel;
    if (!channel?.channelId || channel.status !== "active") {
      return null;
    }

    const approval = await approvalsSvc.getById(input.approvalId);
    if (!approval || approval.type !== "host_command_fallback") {
      return null;
    }
    const request = await hostCommandSvc.getByApprovalId(input.approvalId);
    if (!request) return null;

    const controlClient = await getControlClient();
    if (!controlClient) {
      return null;
    }

    const posted = await controlClient.postMessage({
      channel: channel.channelId,
      text: [
        "*OrchestorAI approval required: host command fallback*",
        `Approval: ${approval.id}`,
        `Issue: ${request.issueId}`,
        `Binary: \`${request.binary}\``,
        `Args: ${request.args.length > 0 ? `\`${request.args.join(" ")}\`` : "`(none)`"}`,
        `Cwd: \`${request.cwd}\``,
        `Reason: ${request.reason}`,
        request.missingCommand ? `Missing command: \`${request.missingCommand}\`` : null,
        request.localErrorExcerpt ? `Local error: ${request.localErrorExcerpt}` : null,
        "",
        "Reply in this thread with one of:",
        "- `approved for now`",
        "- `approved always`",
        "- `reject`",
      ]
        .filter((line): line is string => Boolean(line))
        .join("\n"),
    });

    return upsertApprovalThreadLink({
      companyId: approval.companyId,
      approvalId: approval.id,
      projectId: request.projectId,
      projectSlackChannelId: channel.id,
      channelId: posted.channel,
      threadTs: posted.threadTs,
    });
  }

  async function postApprovalThreadResponse(input: {
    link: SlackApprovalThreadLink;
    text: string;
  }) {
    const message = input.text.trim();
    if (!message) return;

    const controlClient = await getControlClient();
    if (!controlClient) return;

    try {
      await controlClient.postMessage({
        channel: input.link.channelId,
        threadTs: input.link.threadTs,
        text: message,
      });
    } catch (error) {
      logger.warn(
        { err: error, approvalId: input.link.approvalId, channelId: input.link.channelId },
        "failed to post Slack approval thread response",
      );
    }
  }

  async function handleApprovalThreadReply(input: {
    link: SlackApprovalThreadLink;
    event: SlackControlMessageEvent;
  }) {
    const slackUserId = readNonEmptyString(input.event.user);
    if (!slackUserId) {
      return { handled: true as const, outcome: "ignored" as const };
    }

    const approverIds = parseConfiguredSlackApproverIds();
    if (!approverIds.has(slackUserId)) {
      await postApprovalThreadResponse({
        link: input.link,
        text: "Only configured board approvers can approve or reject this request from Slack.",
      });
      return { handled: true as const, outcome: "unauthorized" as const };
    }

    const approval = await approvalsSvc.getById(input.link.approvalId);
    if (!approval) {
      await postApprovalThreadResponse({
        link: input.link,
        text: "This approval request no longer exists.",
      });
      return { handled: true as const, outcome: "missing_approval" as const };
    }

    const text = stripLeadingSlackMentions(input.event.text ?? "");
    if (!text) {
      return { handled: true as const, outcome: "ignored" as const };
    }

    const request = await hostCommandSvc.getByApprovalId(approval.id);
    const actorId = `slack:${slackUserId}`;
    const decision = parseApprovalDecision(text);

    if (decision && !ACTIONABLE_APPROVAL_STATUSES.has(approval.status)) {
      await postApprovalThreadResponse({
        link: input.link,
        text: `This approval is already ${approval.status.replace(/_/g, " ")}.`,
      });
      return { handled: true as const, outcome: "already_resolved" as const };
    }

    if (decision === "once" || decision === "always") {
      await hostCommandSvc.assertCanApprove(
        approval.id,
        decision === "always" ? "always" : "once",
      );
      const updated = await approvalsSvc.approve(approval.id, actorId, null);

      await logActivity(db, {
        companyId: updated.companyId,
        actorType: "user",
        actorId,
        action: "approval.approved",
        entityType: "approval",
        entityId: updated.id,
        details: {
          type: updated.type,
          requestedByAgentId: updated.requestedByAgentId,
          linkedIssueIds: request ? [request.issueId] : [],
          source: "slack",
          slackUserId,
        },
      });

      await hostCommandSvc.handleApprovalApproved(updated.id, actorId, decision);
      await postApprovalThreadResponse({
        link: input.link,
        text:
          decision === "always"
            ? "Approved always. This request is queued, and future requests for this binary in this project will bypass approval."
            : "Approved for now. This request is queued for one-time host execution.",
      });
      return {
        handled: true as const,
        outcome: decision === "always" ? ("approved_always" as const) : ("approved_once" as const),
      };
    }

    if (decision === "reject") {
      const updated = await approvalsSvc.reject(approval.id, actorId, null);

      await logActivity(db, {
        companyId: updated.companyId,
        actorType: "user",
        actorId,
        action: "approval.rejected",
        entityType: "approval",
        entityId: updated.id,
        details: {
          type: updated.type,
          source: "slack",
          slackUserId,
        },
      });

      await hostCommandSvc.handleApprovalRejected(updated.id, actorId);
      await postApprovalThreadResponse({
        link: input.link,
        text: "Rejected. This host command request will not execute.",
      });
      return { handled: true as const, outcome: "rejected" as const };
    }

    const comment = await approvalsSvc.addComment(
      approval.id,
      buildSlackApprovalCommentBody({
        text,
        slackUserId,
        channelId: input.link.channelId,
        threadTs: input.link.threadTs,
      }),
      { userId: actorId },
    );

    await logActivity(db, {
      companyId: approval.companyId,
      actorType: "user",
      actorId,
      action: "approval.comment_added",
      entityType: "approval",
      entityId: approval.id,
      details: {
        commentId: comment.id,
        source: "slack",
        slackUserId,
      },
    });

    await postApprovalThreadResponse({
      link: input.link,
      text: "Recorded as an approval comment.",
    });
    return { handled: true as const, outcome: "comment_added" as const };
  }

  async function handleApprovalThreadMessage(input: {
    channelId: string;
    threadTs: string;
    slackUserId?: string | null;
    text?: string | null;
  }) {
    const link = await getApprovalThreadLinkBySlackThread(input.channelId, input.threadTs);
    if (!link) {
      return { handled: false as const, outcome: "not_found" as const };
    }

    return handleApprovalThreadReply({
      link,
      event: {
        type: "message",
        channel: input.channelId,
        thread_ts: input.threadTs,
        ts: input.threadTs,
        user: input.slackUserId ?? undefined,
        text: input.text ?? undefined,
      },
    });
  }

  async function handleSlackControlEvent(envelope: SlackControlEventEnvelope) {
    if (envelope.type !== "event_callback" || !envelope.event_id || !envelope.event) {
      return;
    }

    const channelId = readNonEmptyString(envelope.event.channel);
    if (!channelId) return;

    const companyChatRoom = await getCompanyChatRoomBySlackChannelId(channelId);
    const projectChannel = await getProjectSlackChannelBySlackChannelId(channelId);
    const accepted = await markSlackEventReceived({
      eventId: envelope.event_id,
      companyId: companyChatRoom?.companyId ?? projectChannel?.companyId ?? null,
      eventType: envelope.event.type,
      apiAppId: envelope.api_app_id ?? null,
    });
    if (!accepted) {
      return;
    }

    if (
      envelope.event.type !== "message" ||
      !isSupportedSlackControlSubtype(envelope.event.subtype) ||
      envelope.event.bot_id ||
      (companyChatRoom ? companyChatRoom.status !== "active" || !companyChatRoom.enabled : false) &&
      (!projectChannel || projectChannel.status !== "active")
    ) {
      return;
    }

    const threadTs = envelope.event.thread_ts ?? envelope.event.ts;
    if (!threadTs) return;

    const isThreadReply = Boolean(envelope.event.thread_ts && envelope.event.thread_ts !== envelope.event.ts);
    const originalText = buildSlackControlMessageText({
      text: envelope.event.text ?? "",
      files: envelope.event.files ?? [],
    });
    const normalizedText = collapseWhitespace(stripLeadingSlackMentions(originalText));
    if (!normalizedText) return;

    if (companyChatRoom && companyChatRoom.status === "active" && companyChatRoom.enabled) {
      await setSlackThreadStatusBestEffort({
        channelId,
        threadTs,
        status: "Selecting responders...",
      });
      const socialResult = isThreadReply
        ? await socialRooms.handleIncomingSlackReply({
            companyId: companyChatRoom.companyId,
            channelId,
            threadTs,
            messageTs: readNonEmptyString(envelope.event.ts) ?? threadTs,
            text: envelope.event.text ?? "",
          })
        : await socialRooms.handleIncomingSlackRootMessage({
            companyId: companyChatRoom.companyId,
            channelId,
            threadTs,
            messageTs: readNonEmptyString(envelope.event.ts) ?? threadTs,
            text: envelope.event.text ?? "",
          });
      await refreshCompanyChatThreadStatus({
        threadId: socialResult.thread.id,
        fallbackStatus:
          socialResult.wakeSelection?.selectedAgentIds.length === 0 ? "No responders selected yet." : null,
      });
      return;
    }

    if (isThreadReply) {
      const approvalResult = await handleApprovalThreadMessage({
        channelId,
        threadTs,
        slackUserId: envelope.event.user ?? null,
        text: envelope.event.text ?? null,
      });
      if (approvalResult.handled) {
        return;
      }
    }

    const threadLink = isThreadReply
      ? await getThreadLinkBySlackThread(channelId, threadTs)
      : null;

    const actionRun = await createSlackActionRun({
      companyId: projectChannel.companyId,
      projectId: projectChannel.projectId,
      issueId: threadLink?.issueId ?? null,
      eventId: envelope.event_id,
      channelId,
      threadTs,
      messageTs: readNonEmptyString(envelope.event.ts) ?? threadTs,
      slackUserId: readNonEmptyString(envelope.event.user),
      slackUserName: null,
      requestText: originalText,
      normalizedText,
    });

    const processingStatus = createControlThreadStatusController({
      channelId,
      threadTs,
    });

    try {
      await processingStatus.start("Gathering information...");
      const interpreterInput = await buildInterpreterInput({
        projectChannel,
        threadLink,
        event: envelope.event,
        originalText,
        normalizedText,
        threadTs,
        isThreadReply,
      });
      await processingStatus.update("Thinking...");
      const interpretation = await interpreter.interpret(interpreterInput.payload);
      await processingStatus.update(
        interpretation.actionType === "query" ||
          interpretation.actionType === "clarify" ||
          interpretation.actionType === "noop"
          ? "Preparing response..."
          : "Updating the board...",
      );
      const outcome = await executeSlackAction({
        projectChannel,
        threadLink,
        threadTs,
        eventId: envelope.event_id,
        event: envelope.event,
        interpretation,
        messageContext: interpreterInput.messageContext,
        mappedAgents: interpreterInput.mappedAgents,
        mappedProjects: interpreterInput.mappedProjects,
        candidateAgents: interpreterInput.payload.candidateAgents,
        candidateProjects: interpreterInput.payload.candidateProjects,
        candidateIssues: interpreterInput.payload.candidateIssues,
      });

      let replyText = outcome.slackReply ?? interpretation.slackReply;
      if (
        outcome.canonicalLink &&
        !isSameSlackThread(outcome.canonicalLink, { channelId, threadTs })
      ) {
        replyText = [
          replyText,
          `Canonical issue thread: ${buildSlackThreadPointer(outcome.canonicalLink)}.`,
        ]
          .filter((line): line is string => Boolean(line))
          .join("\n");
      }

      if (replyText) {
        await processingStatus.update("Posting update...");
        await postControlThreadReply({
          channelId,
          threadTs,
          text: replyText,
        });
      }

      if (
        outcome.status === "executed" &&
        outcome.canonicalLink &&
        !isSameSlackThread(outcome.canonicalLink, { channelId, threadTs })
      ) {
        await postControlThreadReply({
          channelId: outcome.canonicalLink.channelId,
          threadTs: outcome.canonicalLink.threadTs,
          text: [
            "Slack control action applied from another thread.",
            interpretation.slackReply,
          ].join("\n"),
        });
      }

      if (actionRun) {
        await updateSlackActionRun(actionRun.id, {
          projectId: outcome.issue?.projectId ?? projectChannel.projectId,
          issueId: outcome.issue?.id ?? threadLink?.issueId ?? null,
          status: outcome.status,
          actionType: interpretation.actionType,
          confidence: interpretation.confidence,
          interpreterResult: interpretation,
          executionResult: outcome.executionResult,
        });
      }
    } catch (error) {
      if (actionRun) {
        await updateSlackActionRun(actionRun.id, {
          projectId: projectChannel.projectId,
          issueId: threadLink?.issueId ?? null,
          status: "failed",
          error: error instanceof Error ? error.message : String(error),
        });
      }
      throw error;
    } finally {
      await processingStatus.stop();
    }
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

    async syncAgentAppDisplayName(agentId: string) {
      const agent = await getAgentRow(agentId);
      if (!agent) throw notFound("Agent not found");

      const existing = await getAgentSlackApp(agentId);
      const slackAppId = readNonEmptyString(existing?.slackAppId);
      if (!existing || !slackAppId) {
        return { synced: false, reason: "not_provisioned" as const };
      }

      const manifestToken = instanceSettings.getRuntimeSecretValue("slackManifestToken");
      if (!manifestToken) {
        await upsertAgentSlackApp(agentId, {
          lastError: "SLACK_APP_MANIFEST_TOKEN is not configured.",
        });
        return { synced: false, reason: "manifest_token_missing" as const };
      }

      try {
        const exported = await slackManifestExport({
          manifestToken,
          appId: slackAppId,
        });
        const manifest = parseObject(exported.manifest);
        const displayInformation = parseObject(manifest.display_information);
        const features = parseObject(manifest.features);
        const botUser = parseObject(features.bot_user);

        displayInformation.name = buildSlackAppName(agent.name);
        botUser.display_name = buildSlackBotDisplayName(agent.name);
        if (typeof botUser.always_online !== "boolean") {
          botUser.always_online = false;
        }

        manifest.display_information = displayInformation;
        features.bot_user = botUser;
        manifest.features = features;

        await slackManifestUpdate({
          manifestToken,
          appId: slackAppId,
          manifest,
        });

        await upsertAgentSlackApp(agentId, { lastError: null });
        return { synced: true as const };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await upsertAgentSlackApp(agentId, { lastError: message });
        logger.warn(
          {
            err: error,
            agentId,
            slackAppId,
          },
          "failed to sync Slack app display name",
        );
        return {
          synced: false as const,
          reason: "sync_failed" as const,
          error: message,
        };
      }
    },

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
    syncCompanyChatRoom,
    listProjectSlackState,
    syncAgentProjectMemberships,
    getCompanyChatRoomBySlackChannelId,
    postCompanyChatMessage,
    postCompanyChatReaction,
    setCompanyChatThreadStatus,
    refreshCompanyChatThreadStatus,
    getThreadLinkByIssue,
    postHostCommandFallbackApprovalMessage,
    handleApprovalThreadMessage,
  };
}
