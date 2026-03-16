import fs from "node:fs/promises";
import path from "node:path";
import { and, asc, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import type { Db } from "@orchestorai/db";
import {
  agents,
  companies,
  companyChatMessages,
  companyChatParticipation,
  companyChatReactions,
  companyChatRooms,
  companyChatThreads,
  heartbeatRuns,
} from "@orchestorai/db";
import type {
  CompanyChatCompletionAssessment,
  CompanyChatMessage,
  CompanyChatParticipation,
  CompanyChatPromptPack,
  CompanyChatReaction,
  CompanyChatRoom,
  CompanyChatThread,
  CompanyChatTopic,
  CreateCompanyChatMessage,
  CreateCompanyChatReaction,
  CreateCompanyChatThread,
  UpdateCompanyChatPromptPack,
  UpdateCompanyChatRoom,
} from "@orchestorai/shared";
import { normalizeSlackChannelName } from "@orchestorai/shared";
import {
  DEFAULT_SOCIAL_ROOM_FOLLOW_ON_DEBOUNCE_MS,
  DEFAULT_SOCIAL_ROOM_FOLLOW_ON_TARGET,
  DEFAULT_SOCIAL_ROOM_INITIAL_WAVE_TARGET,
  DEFAULT_SOCIAL_ROOM_MAX_CONSECUTIVE_AGENT_MESSAGES,
  DEFAULT_SOCIAL_ROOM_THREAD_EXPIRY_MINUTES,
  DEFAULT_SOCIAL_ROOM_TOPICS,
  SOCIAL_ROOM_PROMPT_FILE_NAMES,
  buildDefaultSocialRoomPromptPack,
  classifySocialRoomThreadCompletion,
  countConsecutiveAgentMessages,
  evaluateAutonomousStartEligibility,
  extractMentionedSocialSpeakerAgentIds,
  findSocialRoomReplayMessageForAgentRun,
  resolveSocialRoomIncomingWakePlan,
  shouldAutoExpireSocialRoomThread,
  type SocialSpeakerCandidate,
  type SocialSpeakerSelectionMode,
} from "@orchestorai/social-room-runtime";
import { conflict, notFound } from "../errors.js";
import { resolveOrchestorAIInstanceRoot } from "../home-paths.js";
import { logger } from "../middleware/logger.js";
import { resolveAgentPersonaDigest } from "../social-room/agent-persona-digest.js";
import { selectSocialRoomSpeakers } from "../social-room/speaker-selector.js";
import { heartbeatService } from "./heartbeat.js";

const INELIGIBLE_AGENT_STATUSES = new Set(["paused", "terminated", "pending_approval"]);
const INITIAL_WAVE_TARGET = DEFAULT_SOCIAL_ROOM_INITIAL_WAVE_TARGET;
const FOLLOW_ON_TARGET = DEFAULT_SOCIAL_ROOM_FOLLOW_ON_TARGET;
const FOLLOW_ON_DEBOUNCE_MS = DEFAULT_SOCIAL_ROOM_FOLLOW_ON_DEBOUNCE_MS;
const FOLLOW_ON_POLL_LIMIT = 20;
const MAX_CONSECUTIVE_AGENT_MESSAGES = DEFAULT_SOCIAL_ROOM_MAX_CONSECUTIVE_AGENT_MESSAGES;
const THREAD_AUTO_EXPIRE_MINUTES = DEFAULT_SOCIAL_ROOM_THREAD_EXPIRY_MINUTES;

export interface SocialRoomActor {
  actorType: "user" | "agent" | "system";
  actorId: string | null;
  userId?: string | null;
  agentId?: string | null;
  runId?: string | null;
}

interface PromptPackPaths {
  directory: string;
  systemPath: string;
  agentsPath: string;
  soulPath: string;
}

interface CreateThreadOptions {
  slackChannelId?: string | null;
  slackThreadTs?: string | null;
  slackMessageTs?: string | null;
  authorSource?: "slack" | "api" | "agent" | "system";
}

interface CreateMessageOptions {
  slackChannelId?: string | null;
  slackMessageTs?: string | null;
  authorSource?: "slack" | "api" | "agent" | "system";
}

interface CreateMessageResult {
  thread: CompanyChatThread;
  message: CompanyChatMessage;
  deduplicated: boolean;
  wakeSelection: SocialRoomWakeSelectionSummary | null;
}

interface SocialRoomWakeSelectionSummary {
  selectedAgentIds: string[];
}

function coerceTopics(raw: unknown): CompanyChatTopic[] {
  if (!Array.isArray(raw)) return DEFAULT_SOCIAL_ROOM_TOPICS;
  const topics = raw
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const candidate = entry as Record<string, unknown>;
      const slug = typeof candidate.slug === "string" ? candidate.slug.trim() : "";
      const label = typeof candidate.label === "string" ? candidate.label.trim() : "";
      if (!slug || !label) return null;
      return {
        slug,
        label,
        description:
          typeof candidate.description === "string" && candidate.description.trim().length > 0
            ? candidate.description.trim()
            : null,
        autonomousAllowed:
          typeof candidate.autonomousAllowed === "boolean" ? candidate.autonomousAllowed : true,
        internetAllowed:
          typeof candidate.internetAllowed === "boolean" ? candidate.internetAllowed : true,
      } satisfies CompanyChatTopic;
    })
    .filter((entry): entry is CompanyChatTopic => Boolean(entry));
  return topics.length > 0 ? topics : DEFAULT_SOCIAL_ROOM_TOPICS;
}

function toRoom(row: typeof companyChatRooms.$inferSelect): CompanyChatRoom {
  return {
    ...row,
    status: row.status as CompanyChatRoom["status"],
    allowedTopics: coerceTopics(row.allowedTopics),
  };
}

function toThread(row: typeof companyChatThreads.$inferSelect): CompanyChatThread {
  const { followOnDueAt: _followOnDueAt, followOnGeneration: _followOnGeneration, ...thread } = row;
  return {
    ...thread,
    origin: thread.origin as CompanyChatThread["origin"],
    status: thread.status as CompanyChatThread["status"],
    completionAssessment: thread.completionAssessment as CompanyChatCompletionAssessment,
  };
}

function toMessage(row: typeof companyChatMessages.$inferSelect): CompanyChatMessage {
  return {
    ...row,
    authorType: row.authorType as CompanyChatMessage["authorType"],
    source: row.source as CompanyChatMessage["source"],
  };
}

function toReaction(row: typeof companyChatReactions.$inferSelect): CompanyChatReaction {
  return {
    ...row,
    authorType: row.authorType as CompanyChatReaction["authorType"],
    source: row.source as CompanyChatReaction["source"],
  };
}

function toParticipation(row: typeof companyChatParticipation.$inferSelect): CompanyChatParticipation {
  return row;
}

function buildDefaultRoomDisplayName(companyName: string): string {
  const trimmed = companyName.trim();
  return trimmed.length > 0 ? `${trimmed} chat room` : "Company chat room";
}

function buildDefaultRoomChannelName(companyName: string): string {
  return normalizeSlackChannelName(`${companyName} chat room`) ?? "company-chat-room";
}

function resolvePromptPackPaths(companyId: string): PromptPackPaths {
  const directory = path.resolve(
    resolveOrchestorAIInstanceRoot(),
    "data",
    "social-rooms",
    companyId,
  );
  return {
    directory,
    systemPath: path.resolve(directory, SOCIAL_ROOM_PROMPT_FILE_NAMES.system),
    agentsPath: path.resolve(directory, SOCIAL_ROOM_PROMPT_FILE_NAMES.agents),
    soulPath: path.resolve(directory, SOCIAL_ROOM_PROMPT_FILE_NAMES.soul),
  };
}

async function fileExists(filePath: string) {
  return fs
    .stat(filePath)
    .then((stats) => stats.isFile())
    .catch(() => false);
}

function parseObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asBoolean(value: unknown, fallback = false) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") return true;
    if (normalized === "false") return false;
  }
  return fallback;
}

function isWakeOnDemandEnabled(agentRow: typeof agents.$inferSelect) {
  const runtimeConfig = parseObject(agentRow.runtimeConfig);
  const heartbeatConfig = parseObject(runtimeConfig.heartbeat);
  return asBoolean(
    heartbeatConfig.wakeOnDemand ??
      heartbeatConfig.wakeOnAssignment ??
      heartbeatConfig.wakeOnOnDemand ??
      heartbeatConfig.wakeOnAutomation,
    true,
  );
}

function formatConversationForSelection(input: {
  topic?: string | null;
  topicLabel?: string | null;
  topicDescription?: string | null;
  messages: Array<{
    authorType: "user" | "agent" | "system";
    text: string;
  }>;
}) {
  const lines = input.messages
    .slice(-12)
    .map((message) => `${message.authorType}: ${message.text.trim()}`)
    .filter((line) => line.length > 0);

  return [
    input.topic ? `Topic: ${input.topic}` : null,
    input.topicLabel ? `Topic label: ${input.topicLabel}` : null,
    input.topicDescription ? `Topic description: ${input.topicDescription}` : null,
    ...lines,
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");
}

function recentSpeakerAgentIdsFromMessages(rows: Array<typeof companyChatMessages.$inferSelect>) {
  const recentIds: string[] = [];
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const agentId = rows[index]?.authorAgentId;
    if (!agentId) continue;
    if (recentIds.includes(agentId)) continue;
    recentIds.push(agentId);
    if (recentIds.length >= 5) break;
  }
  return recentIds;
}

export function socialRoomService(db: Db) {
  const heartbeat = heartbeatService(db);
  const followOnInFlight = new Set<string>();

  async function getCompanyRow(companyId: string) {
    return db
      .select()
      .from(companies)
      .where(eq(companies.id, companyId))
      .then((rows) => rows[0] ?? null);
  }

  async function getRoomRowByCompanyId(companyId: string) {
    return db
      .select()
      .from(companyChatRooms)
      .where(eq(companyChatRooms.companyId, companyId))
      .then((rows) => rows[0] ?? null);
  }

  async function getThreadRow(threadId: string) {
    return db
      .select()
      .from(companyChatThreads)
      .where(eq(companyChatThreads.id, threadId))
      .then((rows) => rows[0] ?? null);
  }

  async function getRoomOrThrow(companyId: string) {
    const room = await getRoomRowByCompanyId(companyId);
    if (!room) throw notFound("Company chat room not found");
    return room;
  }

  async function ensurePromptPack(roomRow: typeof companyChatRooms.$inferSelect, companyName: string) {
    const defaults = buildDefaultSocialRoomPromptPack(companyName);
    const paths = resolvePromptPackPaths(roomRow.companyId);
    await fs.mkdir(paths.directory, { recursive: true });

    if (!(await fileExists(paths.systemPath))) {
      await fs.writeFile(paths.systemPath, defaults.system, "utf8");
    }
    if (!(await fileExists(paths.agentsPath))) {
      await fs.writeFile(paths.agentsPath, defaults.agents, "utf8");
    }
    if (!(await fileExists(paths.soulPath))) {
      await fs.writeFile(paths.soulPath, defaults.soul, "utf8");
    }

    const needsPathRefresh =
      roomRow.promptPackDir !== paths.directory ||
      roomRow.promptSystemPath !== paths.systemPath ||
      roomRow.promptAgentsPath !== paths.agentsPath ||
      roomRow.promptSoulPath !== paths.soulPath;

    if (needsPathRefresh) {
      const updated = await db
        .update(companyChatRooms)
        .set({
          promptPackDir: paths.directory,
          promptSystemPath: paths.systemPath,
          promptAgentsPath: paths.agentsPath,
          promptSoulPath: paths.soulPath,
          updatedAt: new Date(),
        })
        .where(eq(companyChatRooms.id, roomRow.id))
        .returning()
        .then((rows) => rows[0] ?? roomRow);
      return { roomRow: updated, paths };
    }

    return { roomRow, paths };
  }

  async function readPromptPackFromPaths(input: {
    roomRow: typeof companyChatRooms.$inferSelect;
    paths: PromptPackPaths;
  }): Promise<CompanyChatPromptPack> {
    const [system, agentsPrompt, soul] = await Promise.all([
      fs.readFile(input.paths.systemPath, "utf8"),
      fs.readFile(input.paths.agentsPath, "utf8"),
      fs.readFile(input.paths.soulPath, "utf8"),
    ]);

    return {
      roomId: input.roomRow.id,
      companyId: input.roomRow.companyId,
      directory: input.paths.directory,
      systemPath: input.paths.systemPath,
      agentsPath: input.paths.agentsPath,
      soulPath: input.paths.soulPath,
      system,
      agents: agentsPrompt,
      soul,
    };
  }

  async function recomputeThreadAssessment(threadId: string) {
    const messages = await db
      .select()
      .from(companyChatMessages)
      .where(eq(companyChatMessages.threadId, threadId))
      .orderBy(asc(companyChatMessages.createdAt), asc(companyChatMessages.id));

    const assessment = classifySocialRoomThreadCompletion(
      messages.map((message) => ({
        authorType: message.authorType as "user" | "agent" | "system",
        text: message.text,
      })),
    );

    const updated = await db
      .update(companyChatThreads)
      .set({
        completionAssessment: assessment,
        updatedAt: new Date(),
      })
      .where(eq(companyChatThreads.id, threadId))
      .returning()
      .then((rows) => rows[0] ?? null);

    return updated ? toThread(updated) : null;
  }

  async function touchRoomActivity(roomId: string, at: Date) {
    await db
      .update(companyChatRooms)
      .set({
        lastRoomActivityAt: at,
        updatedAt: at,
      })
      .where(eq(companyChatRooms.id, roomId));
  }

  async function bumpParticipation(input: {
    companyId: string;
    roomId: string;
    agentId: string;
    messageIncrement?: number;
    autonomousStartIncrement?: number;
    participatedAt?: Date | null;
    autonomousStartedAt?: Date | null;
  }) {
    const existing = await db
      .select()
      .from(companyChatParticipation)
      .where(
        and(
          eq(companyChatParticipation.roomId, input.roomId),
          eq(companyChatParticipation.agentId, input.agentId),
        ),
      )
      .then((rows) => rows[0] ?? null);

    if (!existing) {
      const created = await db
        .insert(companyChatParticipation)
        .values({
          companyId: input.companyId,
          roomId: input.roomId,
          agentId: input.agentId,
          messageCount: input.messageIncrement ?? 0,
          autonomousStartsCount: input.autonomousStartIncrement ?? 0,
          lastParticipatedAt: input.participatedAt ?? null,
          lastAutonomousStartedAt: input.autonomousStartedAt ?? null,
        })
        .returning()
        .then((rows) => rows[0] ?? null);
      return created ? toParticipation(created) : null;
    }

    const updated = await db
      .update(companyChatParticipation)
      .set({
        messageCount: existing.messageCount + (input.messageIncrement ?? 0),
        autonomousStartsCount:
          existing.autonomousStartsCount + (input.autonomousStartIncrement ?? 0),
        lastParticipatedAt: input.participatedAt ?? existing.lastParticipatedAt,
        lastAutonomousStartedAt:
          input.autonomousStartedAt ?? existing.lastAutonomousStartedAt,
        updatedAt: new Date(),
      })
      .where(eq(companyChatParticipation.id, existing.id))
      .returning()
      .then((rows) => rows[0] ?? existing);

    return toParticipation(updated);
  }

  async function getEligibleParticipantAgents(input: {
    companyId: string;
    roomId: string;
    excludeAgentIds?: string[];
  }) {
    const candidates = await db
      .select()
      .from(agents)
      .where(eq(agents.companyId, input.companyId))
      .orderBy(asc(agents.createdAt), asc(agents.id));

    const participationRows = await db
      .select()
      .from(companyChatParticipation)
      .where(eq(companyChatParticipation.roomId, input.roomId));
    const participationByAgentId = new Map(
      participationRows.map((row) => [row.agentId, row] as const),
    );
    const excludeSet = new Set(input.excludeAgentIds ?? []);

    return candidates
      .filter((agentRow) => !INELIGIBLE_AGENT_STATUSES.has(agentRow.status))
      .filter((agentRow) => !excludeSet.has(agentRow.id))
      .filter((agentRow) => isWakeOnDemandEnabled(agentRow))
      .map((agentRow) => ({
        agentRow,
        lastParticipatedAt:
          participationByAgentId.get(agentRow.id)?.lastParticipatedAt ?? null,
      }));
  }

  function sortAgentsByFallbackRotation(
    entries: Array<{
      agentRow: typeof agents.$inferSelect;
      lastParticipatedAt: Date | null;
    }>,
  ) {
    return [...entries].sort((left, right) => {
      const leftAt = left.lastParticipatedAt?.getTime() ?? 0;
      const rightAt = right.lastParticipatedAt?.getTime() ?? 0;
      if (leftAt !== rightAt) return leftAt - rightAt;
      return left.agentRow.createdAt.getTime() - right.agentRow.createdAt.getTime();
    });
  }

  async function chooseAgentsForConversation(input: {
    companyId: string;
    roomId: string;
    mode: SocialSpeakerSelectionMode;
    maxSelections: number;
    recentConversationText: string;
    preferredMentionText?: string | null;
    excludeAgentIds?: string[];
    recentSpeakerAgentIds?: string[];
    immediatePreviousSpeakerAgentId?: string | null;
  }) {
    const eligible = await getEligibleParticipantAgents({
      companyId: input.companyId,
      roomId: input.roomId,
      excludeAgentIds: input.excludeAgentIds,
    });
    const selectorCandidates: SocialSpeakerCandidate[] = await Promise.all(
      eligible.map(async (entry) => {
        const { digest } = await resolveAgentPersonaDigest({
          id: entry.agentRow.id,
          name: entry.agentRow.name,
          role: entry.agentRow.role,
          title: entry.agentRow.title,
          capabilities: entry.agentRow.capabilities,
          adapterConfig: entry.agentRow.adapterConfig,
        });
        return {
          id: entry.agentRow.id,
          name: entry.agentRow.name,
          role: entry.agentRow.role,
          title: entry.agentRow.title,
          capabilities: entry.agentRow.capabilities,
          personaDigest: digest,
          lastParticipatedAt: entry.lastParticipatedAt,
        } satisfies SocialSpeakerCandidate;
      }),
    );

    const preferredAgentIds = input.preferredMentionText
      ? extractMentionedSocialSpeakerAgentIds({
          text: input.preferredMentionText,
          candidates: selectorCandidates,
        })
      : [];
    const preferredAgentIdSet = new Set(preferredAgentIds);

    const fallbackOrdered = sortAgentsByFallbackRotation(eligible).sort((left, right) => {
      const leftPreferred = preferredAgentIdSet.has(left.agentRow.id);
      const rightPreferred = preferredAgentIdSet.has(right.agentRow.id);
      if (leftPreferred !== rightPreferred) return leftPreferred ? -1 : 1;
      return 0;
    });
    const fallbackAgentIds = fallbackOrdered
      .slice(0, Math.max(0, input.maxSelections))
      .map((entry) => entry.agentRow.id);

    const selection = await selectSocialRoomSpeakers({
      companyId: input.companyId,
      roomId: input.roomId,
      mode: input.mode,
      maxSelections: input.maxSelections,
      recentConversationText: input.recentConversationText,
      candidates: selectorCandidates,
      fallbackAgentIds,
      preferredAgentIds,
      recentSpeakerAgentIds: input.recentSpeakerAgentIds,
      immediatePreviousSpeakerAgentId: input.immediatePreviousSpeakerAgentId,
    });

    const agentById = new Map(eligible.map((entry) => [entry.agentRow.id, entry.agentRow] as const));
    const selectedAgents = selection.decision.selectedAgentIds
      .map((agentId) => agentById.get(agentId) ?? null)
      .filter((agentRow): agentRow is typeof agents.$inferSelect => Boolean(agentRow));

    logger.info(
      {
        companyId: input.companyId,
        roomId: input.roomId,
        mode: input.mode,
        shortlistedAgentIds: selection.shortlistedAgentIds,
        selectedAgentIds: selection.decision.selectedAgentIds,
        cameoAgentIds: selection.cameoAgentIds,
        source: selection.source,
        fallbackReason: selection.fallbackReason,
        summary: selection.decision.summary,
      },
      "social-room speaker selection completed",
    );

    return {
      selectedAgents,
      selection,
    };
  }

  async function wakeAgentsForThread(input: {
    thread: CompanyChatThread;
    reason: string;
    requestedBy: SocialRoomActor;
    mode: SocialSpeakerSelectionMode;
    maxSelections: number;
    recentConversationText: string;
    preferredMentionText?: string | null;
    excludeAgentIds?: string[];
    recentSpeakerAgentIds?: string[];
    immediatePreviousSpeakerAgentId?: string | null;
  }) {
    const { selectedAgents, selection } = await chooseAgentsForConversation({
      companyId: input.thread.companyId,
      roomId: input.thread.roomId,
      mode: input.mode,
      maxSelections: input.maxSelections,
      recentConversationText: input.recentConversationText,
      preferredMentionText: input.preferredMentionText,
      excludeAgentIds: input.excludeAgentIds,
      recentSpeakerAgentIds: input.recentSpeakerAgentIds,
      immediatePreviousSpeakerAgentId: input.immediatePreviousSpeakerAgentId,
    });

    await Promise.all(
      selectedAgents.map((agentRow) =>
        heartbeat
          .wakeup(agentRow.id, {
            source: "on_demand",
            triggerDetail: "system",
            reason: input.reason,
            requestedByActorType: input.requestedBy.actorType,
            requestedByActorId: input.requestedBy.actorId ?? null,
            contextSnapshot: {
              wakeReason: input.reason,
              chatRoomId: input.thread.roomId,
              chatThreadId: input.thread.id,
              chatTopic: input.thread.topic,
              chatOrigin: input.thread.origin,
              chatInternetAllowed: true,
              chatPersonaMode: "overlay",
            },
          })
          .catch((error) => {
            logger.warn(
              { err: error, roomId: input.thread.roomId, threadId: input.thread.id, agentId: agentRow.id },
              "failed to wake social-room responder",
            );
          }),
      ),
    );

    return selection;
  }

  async function maybeWakeForIncomingActivity(input: {
    thread: CompanyChatThread;
    authorType: "user" | "agent" | "system";
    authorAgentId?: string | null;
    requestedBy: SocialRoomActor;
    recentConversationText: string;
    latestMessageText: string;
    recentSpeakerAgentIds: string[];
  }) {
    const wakePlan = resolveSocialRoomIncomingWakePlan({
      authorType: input.authorType,
      threadMessageCount: input.thread.messageCount,
      initialWaveTarget: INITIAL_WAVE_TARGET,
    });
    if (!wakePlan.shouldWake || !wakePlan.mode || !wakePlan.reason) {
      return null;
    }
    const selection = await wakeAgentsForThread({
      thread: input.thread,
      reason: wakePlan.reason,
      requestedBy: input.requestedBy,
      mode: wakePlan.mode,
      maxSelections: wakePlan.maxSelections,
      recentConversationText: input.recentConversationText,
      preferredMentionText: input.latestMessageText,
      recentSpeakerAgentIds: input.recentSpeakerAgentIds,
      excludeAgentIds: input.authorAgentId ? [input.authorAgentId] : [],
    });
    return {
      selectedAgentIds: selection.decision.selectedAgentIds,
    } satisfies SocialRoomWakeSelectionSummary;
  }

  async function listThreadMessagesRaw(threadId: string) {
    return db
      .select()
      .from(companyChatMessages)
      .where(eq(companyChatMessages.threadId, threadId))
      .orderBy(asc(companyChatMessages.createdAt), asc(companyChatMessages.id));
  }

  async function createThreadRecord(input: {
    companyId: string;
    room: typeof companyChatRooms.$inferSelect;
    topic: string | null;
    text: string;
    autonomous: boolean;
    actor: SocialRoomActor;
    options?: CreateThreadOptions;
  }) {
    if (!input.room.enabled) {
      throw conflict("Company chat room is disabled");
    }

    const origin =
      input.actor.actorType === "agent"
        ? "agent"
        : input.actor.actorType === "user"
          ? "human"
          : "system";

    if (origin === "agent" && input.autonomous) {
      const activeAutonomousThreads = await db
        .select()
        .from(companyChatThreads)
        .where(
          and(
            eq(companyChatThreads.roomId, input.room.id),
            eq(companyChatThreads.autonomous, true),
            eq(companyChatThreads.status, "active"),
          ),
        );
      if (activeAutonomousThreads.length >= input.room.maxAutonomousThreads) {
        throw conflict("Autonomous social-room thread cap reached");
      }
    }

    const now = new Date();
    const followOnDueAt = null;
    const initialAssessment = classifySocialRoomThreadCompletion([
      {
        authorType: input.actor.actorType === "agent" ? "agent" : input.actor.actorType === "user" ? "user" : "system",
        text: input.text,
      },
    ]);

    const created = await db.transaction(async (tx) => {
      const thread = await tx
        .insert(companyChatThreads)
        .values({
          companyId: input.companyId,
          roomId: input.room.id,
          topic: input.topic,
          origin,
          autonomous: input.autonomous,
          initiatedByAgentId: input.actor.agentId ?? null,
          initiatedByUserId: input.actor.userId ?? null,
          slackChannelId: input.options?.slackChannelId ?? null,
          slackThreadTs: input.options?.slackThreadTs ?? null,
          status: "active",
          completionAssessment: initialAssessment,
          lastActivityAt: now,
          followOnDueAt,
          followOnGeneration: 0,
          messageCount: 1,
        })
        .returning()
        .then((rows) => rows[0]);

      const message = await tx
        .insert(companyChatMessages)
        .values({
          companyId: input.companyId,
          roomId: input.room.id,
          threadId: thread.id,
          authorType:
            input.actor.actorType === "agent"
              ? "agent"
              : input.actor.actorType === "user"
                ? "user"
                : "system",
          authorAgentId: input.actor.agentId ?? null,
          authorUserId: input.actor.userId ?? null,
          source:
            input.options?.authorSource ??
            (input.actor.actorType === "agent"
              ? "agent"
              : input.actor.actorType === "system"
                ? "system"
                : "api"),
          slackChannelId: input.options?.slackChannelId ?? null,
          slackMessageTs: input.options?.slackMessageTs ?? null,
          text: input.text,
          internetBacked: false,
        })
        .returning()
        .then((rows) => rows[0]);

      await tx
        .update(companyChatRooms)
        .set({
          lastRoomActivityAt: now,
          updatedAt: now,
        })
        .where(eq(companyChatRooms.id, input.room.id));

      return { thread, message };
    });

    if (input.actor.agentId) {
      await bumpParticipation({
        companyId: input.companyId,
        roomId: input.room.id,
        agentId: input.actor.agentId,
        messageIncrement: 1,
        autonomousStartIncrement: input.autonomous ? 1 : 0,
        participatedAt: now,
        autonomousStartedAt: input.autonomous ? now : null,
      });
    }

    const thread = toThread(created.thread);
    const wakeSelection = await maybeWakeForIncomingActivity({
      thread,
      authorType: created.message.authorType as "user" | "agent" | "system",
      authorAgentId: created.message.authorAgentId,
      requestedBy: input.actor,
      recentConversationText: formatConversationForSelection({
        topic: input.topic,
        messages: [
          {
            authorType: created.message.authorType as "user" | "agent" | "system",
            text: created.message.text,
          },
        ],
      }),
      latestMessageText: created.message.text,
      recentSpeakerAgentIds: created.message.authorAgentId ? [created.message.authorAgentId] : [],
    });

    return {
      thread,
      message: toMessage(created.message),
      deduplicated: false,
      wakeSelection,
    };
  }

  async function createMessageRecord(input: {
    thread: typeof companyChatThreads.$inferSelect;
    room: typeof companyChatRooms.$inferSelect;
    body: CreateCompanyChatMessage;
    actor: SocialRoomActor;
    options?: CreateMessageOptions;
  }) {
    if (!input.room.enabled) {
      throw conflict("Company chat room is disabled");
    }

    const now = new Date();
    const created = await db
      .insert(companyChatMessages)
      .values({
        companyId: input.thread.companyId,
        roomId: input.thread.roomId,
        threadId: input.thread.id,
        authorType:
          input.actor.actorType === "agent"
            ? "agent"
            : input.actor.actorType === "user"
              ? "user"
              : "system",
        authorAgentId: input.actor.agentId ?? null,
        authorUserId: input.actor.userId ?? null,
        source:
          input.options?.authorSource ??
          (input.actor.actorType === "agent"
            ? "agent"
            : input.actor.actorType === "system"
              ? "system"
              : "api"),
        slackChannelId: input.options?.slackChannelId ?? null,
        slackMessageTs: input.options?.slackMessageTs ?? null,
        text: input.body.text,
        internetBacked: input.body.internetBacked ?? false,
      })
      .returning()
      .then((rows) => rows[0]);

    const followOnDueAt =
      input.actor.actorType === "agent"
        ? new Date(now.getTime() + FOLLOW_ON_DEBOUNCE_MS)
        : null;

    const updatedThread = await db
      .update(companyChatThreads)
      .set({
        status: "active",
        lastActivityAt: now,
        messageCount: sql`${companyChatThreads.messageCount} + 1`,
        followOnDueAt,
        followOnGeneration: sql`${companyChatThreads.followOnGeneration} + 1`,
        updatedAt: now,
      })
      .where(eq(companyChatThreads.id, input.thread.id))
      .returning()
      .then((rows) => rows[0] ?? input.thread);

    await touchRoomActivity(input.room.id, now);

    if (input.actor.agentId) {
      await bumpParticipation({
        companyId: input.thread.companyId,
        roomId: input.thread.roomId,
        agentId: input.actor.agentId,
        messageIncrement: 1,
        participatedAt: now,
      });
    }

    const threadMessages = await listThreadMessagesRaw(updatedThread.id);
    const thread = (await recomputeThreadAssessment(updatedThread.id)) ?? toThread(updatedThread);

    const wakeSelection = await maybeWakeForIncomingActivity({
      thread,
      authorType: created.authorType as "user" | "agent" | "system",
      authorAgentId: created.authorAgentId,
      requestedBy: input.actor,
      recentConversationText: formatConversationForSelection({
        topic: thread.topic,
        messages: threadMessages.map((message) => ({
          authorType: message.authorType as "user" | "agent" | "system",
          text: message.text,
        })),
      }),
      latestMessageText: created.text,
      recentSpeakerAgentIds: recentSpeakerAgentIdsFromMessages(threadMessages),
    });

    return {
      thread,
      message: toMessage(created),
      deduplicated: false,
      wakeSelection,
    };
  }

  async function clearFollowOnState(threadId: string, at: Date) {
    await db
      .update(companyChatThreads)
      .set({
        followOnDueAt: null,
        updatedAt: at,
      })
      .where(eq(companyChatThreads.id, threadId));
  }

  async function expireThreadIfStale(
    thread: typeof companyChatThreads.$inferSelect,
    now: Date,
  ) {
    if (
      !shouldAutoExpireSocialRoomThread({
        assessment: thread.completionAssessment as CompanyChatCompletionAssessment | null,
        lastActivityAt: thread.lastActivityAt,
        now,
        expiryMinutes: THREAD_AUTO_EXPIRE_MINUTES,
      })
    ) {
      return thread;
    }

    return db
      .update(companyChatThreads)
      .set({
        completionAssessment: "done",
        status: "closed",
        followOnDueAt: null,
        updatedAt: now,
      })
      .where(eq(companyChatThreads.id, thread.id))
      .returning()
      .then((rows) => rows[0] ?? thread);
  }

  async function tickFollowOnThreads(now = new Date()) {
    const dueThreads = await db
      .select()
      .from(companyChatThreads)
      .where(
        and(
          eq(companyChatThreads.status, "active"),
          lte(companyChatThreads.followOnDueAt, now),
        ),
      )
      .orderBy(asc(companyChatThreads.followOnDueAt), asc(companyChatThreads.lastActivityAt))
      .limit(FOLLOW_ON_POLL_LIMIT);

    let checked = 0;
    let woken = 0;
    let stopped = 0;
    let skipped = 0;

    for (const dueThread of dueThreads) {
      if (followOnInFlight.has(dueThread.id)) {
        skipped += 1;
        continue;
      }

      followOnInFlight.add(dueThread.id);
      checked += 1;

      try {
        const currentThread = await getThreadRow(dueThread.id);
        if (
          !currentThread ||
          !currentThread.followOnDueAt ||
          currentThread.followOnDueAt.getTime() > now.getTime() ||
          currentThread.followOnGeneration !== dueThread.followOnGeneration
        ) {
          skipped += 1;
          continue;
        }

        const room = await db
          .select()
          .from(companyChatRooms)
          .where(eq(companyChatRooms.id, currentThread.roomId))
          .then((rows) => rows[0] ?? null);
        if (!room?.enabled) {
          await clearFollowOnState(currentThread.id, now);
          stopped += 1;
          continue;
        }

        const messages = await listThreadMessagesRaw(currentThread.id);
        const latestMessage = messages.at(-1);
        if (!latestMessage || latestMessage.authorType !== "agent") {
          await clearFollowOnState(currentThread.id, now);
          stopped += 1;
          continue;
        }

        const consecutiveAgentMessages = countConsecutiveAgentMessages(
          messages.map((message) => ({
            authorType: message.authorType as "user" | "agent" | "system",
            text: message.text,
          })),
        );
        if (consecutiveAgentMessages >= MAX_CONSECUTIVE_AGENT_MESSAGES) {
          await clearFollowOnState(currentThread.id, now);
          stopped += 1;
          continue;
        }

        await clearFollowOnState(currentThread.id, now);

        const selection = await wakeAgentsForThread({
          thread: toThread(currentThread),
          reason: "company_chat_agent_follow_on",
          requestedBy: {
            actorType: "system",
            actorId: "social_room_follow_on",
          },
          mode: "follow_on",
          maxSelections: FOLLOW_ON_TARGET,
          recentConversationText: formatConversationForSelection({
            topic: currentThread.topic,
            messages: messages.map((message) => ({
              authorType: message.authorType as "user" | "agent" | "system",
              text: message.text,
            })),
          }),
          preferredMentionText: latestMessage.text,
          recentSpeakerAgentIds: recentSpeakerAgentIdsFromMessages(messages),
          immediatePreviousSpeakerAgentId: latestMessage.authorAgentId,
          excludeAgentIds: latestMessage.authorAgentId ? [latestMessage.authorAgentId] : [],
        });

        if (selection.decision.selectedAgentIds.length > 0) {
          woken += selection.decision.selectedAgentIds.length;
        } else {
          stopped += 1;
        }
      } finally {
        followOnInFlight.delete(dueThread.id);
      }
    }

    return { checked, woken, stopped, skipped };
  }

  async function getRoomByCompanyId(companyId: string) {
    const room = await getRoomRowByCompanyId(companyId);
    return room ? toRoom(room) : null;
  }

  async function getPromptPack(companyId: string) {
    const room = await getRoomOrThrow(companyId);
    const company = await getCompanyRow(companyId);
    if (!company) throw notFound("Company not found");
    const ensured = await ensurePromptPack(room, company.name);
    return readPromptPackFromPaths(ensured);
  }

  async function getThreadById(threadId: string) {
    const row = await getThreadRow(threadId);
    return row ? toThread(row) : null;
  }

  async function getMessageById(messageId: string) {
    const row = await db
      .select()
      .from(companyChatMessages)
      .where(eq(companyChatMessages.id, messageId))
      .then((rows) => rows[0] ?? null);
    return row ? toMessage(row) : null;
  }

  async function findReplayMessageForAgentRun(input: {
    threadId: string;
    agentId: string;
    runId: string;
    text: string;
  }) {
    const run = await db
      .select({
        startedAt: heartbeatRuns.startedAt,
        createdAt: heartbeatRuns.createdAt,
      })
      .from(heartbeatRuns)
      .where(eq(heartbeatRuns.id, input.runId))
      .then((rows) => rows[0] ?? null);
    const runStartedAt = run?.startedAt ?? run?.createdAt ?? null;
    if (!runStartedAt) return null;

    const replayCandidates = await db
      .select({
        id: companyChatMessages.id,
        authorAgentId: companyChatMessages.authorAgentId,
        text: companyChatMessages.text,
        createdAt: companyChatMessages.createdAt,
      })
      .from(companyChatMessages)
      .where(
        and(
          eq(companyChatMessages.threadId, input.threadId),
          eq(companyChatMessages.authorAgentId, input.agentId),
          eq(companyChatMessages.source, "agent"),
          eq(companyChatMessages.text, input.text),
          gte(companyChatMessages.createdAt, runStartedAt),
        ),
      )
      .orderBy(desc(companyChatMessages.createdAt))
      .limit(5);

    return findSocialRoomReplayMessageForAgentRun({
      messages: replayCandidates,
      agentId: input.agentId,
      text: input.text,
      runStartedAt,
    });
  }

  async function createMessage(
    threadId: string,
    body: CreateCompanyChatMessage,
    actor: SocialRoomActor,
    options?: CreateMessageOptions,
  ): Promise<CreateMessageResult> {
    const thread = await getThreadRow(threadId);
    if (!thread) throw notFound("Company chat thread not found");
    const room = await db
      .select()
      .from(companyChatRooms)
      .where(eq(companyChatRooms.id, thread.roomId))
      .then((rows) => rows[0] ?? null);
    if (!room) throw notFound("Company chat room not found");

    if (actor.actorType === "agent" && actor.agentId && actor.runId) {
      const replayMessage = await findReplayMessageForAgentRun({
        threadId,
        agentId: actor.agentId,
        runId: actor.runId,
        text: body.text,
      });
      if (replayMessage) {
        logger.info(
          {
            companyId: thread.companyId,
            threadId,
            agentId: actor.agentId,
            runId: actor.runId,
            messageId: replayMessage.id,
          },
          "deduplicated replayed social-room agent message",
        );
        const replayRow = await db
          .select()
          .from(companyChatMessages)
          .where(eq(companyChatMessages.id, replayMessage.id))
          .then((rows) => rows[0] ?? null);
        const currentThread = await getThreadRow(threadId);
        if (replayRow) {
          return {
            thread: toThread(currentThread ?? thread),
            message: toMessage(replayRow),
            deduplicated: true,
            wakeSelection: null,
          };
        }
      }
    }

    return createMessageRecord({
      thread,
      room,
      body,
      actor,
      options,
    });
  }

  async function createReaction(
    messageId: string,
    body: CreateCompanyChatReaction,
    actor: SocialRoomActor,
  ) {
    const message = await db
      .select()
      .from(companyChatMessages)
      .where(eq(companyChatMessages.id, messageId))
      .then((rows) => rows[0] ?? null);
    if (!message) throw notFound("Company chat message not found");

    const thread = await getThreadRow(message.threadId);
    if (!thread) throw notFound("Company chat thread not found");

    const room = await db
      .select()
      .from(companyChatRooms)
      .where(eq(companyChatRooms.id, thread.roomId))
      .then((rows) => rows[0] ?? null);
    if (!room) throw notFound("Company chat room not found");

    const existing = await db
      .select()
      .from(companyChatReactions)
      .where(
        and(
          eq(companyChatReactions.messageId, messageId),
          eq(companyChatReactions.emoji, body.emoji),
          actor.agentId
            ? eq(companyChatReactions.authorAgentId, actor.agentId)
            : eq(companyChatReactions.authorUserId, actor.userId ?? ""),
        ),
      )
      .then((rows) => rows[0] ?? null);
    if (existing) {
      return {
        reaction: toReaction(existing),
        message: toMessage(message),
        thread: toThread(thread),
      };
    }

    const now = new Date();
    const created = await db
      .insert(companyChatReactions)
      .values({
        companyId: thread.companyId,
        roomId: thread.roomId,
        threadId: thread.id,
        messageId,
        authorType:
          actor.actorType === "agent"
            ? "agent"
            : actor.actorType === "user"
              ? "user"
              : "system",
        authorAgentId: actor.agentId ?? null,
        authorUserId: actor.userId ?? null,
        source: actor.actorType === "agent" ? "agent" : actor.actorType === "system" ? "system" : "api",
        slackChannelId: message.slackChannelId,
        slackMessageTs: message.slackMessageTs,
        emoji: body.emoji,
      })
      .returning()
      .then((rows) => rows[0]);

    await db
      .update(companyChatThreads)
      .set({
        lastActivityAt: now,
        updatedAt: now,
      })
      .where(eq(companyChatThreads.id, thread.id));
    await touchRoomActivity(room.id, now);
    if (actor.agentId) {
      await bumpParticipation({
        companyId: thread.companyId,
        roomId: thread.roomId,
        agentId: actor.agentId,
        participatedAt: now,
      });
    }

    return {
      reaction: toReaction(created),
      message: toMessage(message),
      thread: toThread({ ...thread, lastActivityAt: now, updatedAt: now }),
    };
  }

  async function findRoomBySlackChannelId(channelId: string) {
    const row = await db
      .select()
      .from(companyChatRooms)
      .where(eq(companyChatRooms.slackChannelId, channelId))
      .then((rows) => rows[0] ?? null);
    return row ? toRoom(row) : null;
  }

  async function findThreadBySlackThread(roomId: string, threadTs: string) {
    const row = await db
      .select()
      .from(companyChatThreads)
      .where(
        and(
          eq(companyChatThreads.roomId, roomId),
          eq(companyChatThreads.slackThreadTs, threadTs),
        ),
      )
      .then((rows) => rows[0] ?? null);
    return row ? toThread(row) : null;
  }

  return {
    getRoomByCompanyId,

    async provisionRoom(companyId: string) {
      const company = await getCompanyRow(companyId);
      if (!company) throw notFound("Company not found");

      let room = await getRoomRowByCompanyId(companyId);
      if (!room) {
        room = await db
          .insert(companyChatRooms)
          .values({
            companyId,
            displayName: buildDefaultRoomDisplayName(company.name),
            slackChannelName: buildDefaultRoomChannelName(company.name),
            status: "pending",
            enabled: true,
          idleThresholdHours: 3,
          maxAutonomousThreads: 3,
          autonomousStartEnabled: true,
          allowedTopics: DEFAULT_SOCIAL_ROOM_TOPICS as unknown as Array<Record<string, unknown>>,
        })
          .returning()
          .then((rows) => rows[0] ?? null);
      } else if (!room.enabled) {
        room = await db
          .update(companyChatRooms)
          .set({
            enabled: true,
            updatedAt: new Date(),
          })
          .where(eq(companyChatRooms.id, room.id))
          .returning()
          .then((rows) => rows[0] ?? room);
      }

      if (!room) {
        throw conflict("Failed to provision company chat room");
      }

      const ensured = await ensurePromptPack(room, company.name);
      return toRoom(ensured.roomRow);
    },

    async updateRoom(companyId: string, patch: UpdateCompanyChatRoom) {
      const existing = await getRoomOrThrow(companyId);
      const updated = await db
        .update(companyChatRooms)
        .set({
          displayName: patch.displayName ?? existing.displayName,
          slackChannelName:
            patch.slackChannelName === undefined
              ? existing.slackChannelName
              : patch.slackChannelName,
          status: patch.status ?? existing.status,
          enabled: patch.enabled ?? existing.enabled,
          idleThresholdHours: patch.idleThresholdHours ?? existing.idleThresholdHours,
          maxAutonomousThreads: patch.maxAutonomousThreads ?? existing.maxAutonomousThreads,
          autonomousStartEnabled:
            patch.autonomousStartEnabled ?? existing.autonomousStartEnabled,
          allowedTopics:
            (patch.allowedTopics as unknown as Array<Record<string, unknown>> | undefined) ??
            existing.allowedTopics,
          chatBudgetMonthlyCents:
            patch.chatBudgetMonthlyCents ?? existing.chatBudgetMonthlyCents,
          chatSpentMonthlyCents:
            patch.chatSpentMonthlyCents ?? existing.chatSpentMonthlyCents,
          updatedAt: new Date(),
        })
        .where(eq(companyChatRooms.id, existing.id))
        .returning()
        .then((rows) => rows[0] ?? null);

      if (!updated) throw notFound("Company chat room not found");
      return toRoom(updated);
    },

    getPromptPack,

    async updatePromptPack(companyId: string, patch: UpdateCompanyChatPromptPack) {
      const promptPack = await getPromptPack(companyId);

      await Promise.all([
        patch.system !== undefined
          ? fs.writeFile(promptPack.systemPath, patch.system, "utf8")
          : Promise.resolve(),
        patch.agents !== undefined
          ? fs.writeFile(promptPack.agentsPath, patch.agents, "utf8")
          : Promise.resolve(),
        patch.soul !== undefined
          ? fs.writeFile(promptPack.soulPath, patch.soul, "utf8")
          : Promise.resolve(),
      ]);

      return getPromptPack(companyId);
    },

    async listThreads(companyId: string) {
      const room = await getRoomOrThrow(companyId);
      const rows = await db
        .select()
        .from(companyChatThreads)
        .where(eq(companyChatThreads.roomId, room.id))
        .orderBy(desc(companyChatThreads.lastActivityAt), desc(companyChatThreads.createdAt));
      return rows.map((row) => toThread(row));
    },

    getThreadById,

    getMessageById,

    async listMessages(threadId: string) {
      const thread = await getThreadRow(threadId);
      if (!thread) throw notFound("Company chat thread not found");
      const rows = await db
        .select()
        .from(companyChatMessages)
        .where(eq(companyChatMessages.threadId, threadId))
        .orderBy(asc(companyChatMessages.createdAt), asc(companyChatMessages.id));
      return rows.map((row) => toMessage(row));
    },

    async listReactions(messageId: string) {
      const message = await getMessageById(messageId);
      if (!message) throw notFound("Company chat message not found");
      const rows = await db
        .select()
        .from(companyChatReactions)
        .where(eq(companyChatReactions.messageId, messageId))
        .orderBy(asc(companyChatReactions.createdAt), asc(companyChatReactions.id));
      return rows.map((row) => toReaction(row));
    },

    async createThread(companyId: string, body: CreateCompanyChatThread, actor: SocialRoomActor, options?: CreateThreadOptions) {
      const room = await getRoomOrThrow(companyId);
      return createThreadRecord({
        companyId,
        room,
        topic: body.topic ?? null,
        text: body.text,
        autonomous: body.autonomous ?? false,
        actor,
        options,
      });
    },

    createMessage,

    createReaction,

    async attachThreadSlackMetadata(input: {
      threadId: string;
      threadTs: string;
      channelId: string;
      rootMessageId?: string | null;
      rootMessageTs?: string | null;
    }) {
      const now = new Date();
      await db
        .update(companyChatThreads)
        .set({
          slackChannelId: input.channelId,
          slackThreadTs: input.threadTs,
          updatedAt: now,
        })
        .where(eq(companyChatThreads.id, input.threadId));

      if (input.rootMessageId && input.rootMessageTs) {
        await db
          .update(companyChatMessages)
          .set({
            slackChannelId: input.channelId,
            slackMessageTs: input.rootMessageTs,
            updatedAt: now,
          })
          .where(eq(companyChatMessages.id, input.rootMessageId));
      }
    },

    async attachMessageSlackMetadata(input: {
      messageId: string;
      channelId: string;
      messageTs: string;
    }) {
      await db
        .update(companyChatMessages)
        .set({
          slackChannelId: input.channelId,
          slackMessageTs: input.messageTs,
          updatedAt: new Date(),
        })
        .where(eq(companyChatMessages.id, input.messageId));
    },

    findRoomBySlackChannelId,

    findThreadBySlackThread,

    async handleIncomingSlackRootMessage(input: {
      companyId: string;
      channelId: string;
      threadTs: string;
      messageTs: string;
      text: string;
    }) {
      const room = await getRoomOrThrow(input.companyId);
      const existing = await findThreadBySlackThread(room.id, input.threadTs);
      if (existing) {
        return {
          thread: existing,
          wakeSelection: null,
        };
      }

      const created = await createThreadRecord({
        companyId: input.companyId,
        room,
        topic: null,
        text: input.text,
        autonomous: false,
        actor: {
          actorType: "user",
          actorId: null,
          userId: null,
        },
        options: {
          slackChannelId: input.channelId,
          slackThreadTs: input.threadTs,
          slackMessageTs: input.messageTs,
          authorSource: "slack",
        },
      });

      return {
        thread: created.thread,
        wakeSelection: created.wakeSelection,
      };
    },

    async handleIncomingSlackReply(input: {
      companyId: string;
      channelId: string;
      threadTs: string;
      messageTs: string;
      text: string;
    }) {
      const room = await getRoomOrThrow(input.companyId);
      const thread = await findThreadBySlackThread(room.id, input.threadTs);
      if (!thread) {
        throw notFound("Company chat thread not found for Slack reply");
      }
      const created = await createMessage(
        thread.id,
        {
          text: input.text,
          internetBacked: false,
        },
        {
          actorType: "user",
          actorId: null,
          userId: null,
        },
        {
          slackChannelId: input.channelId,
          slackMessageTs: input.messageTs,
          authorSource: "slack",
        },
      );
      return {
        thread: created.thread,
        wakeSelection: created.wakeSelection,
      };
    },

    tickFollowOnThreads,

    async tickAutonomousRooms(now = new Date()) {
      const rooms = await db
        .select()
        .from(companyChatRooms)
        .where(
          and(
            eq(companyChatRooms.enabled, true),
            inArray(companyChatRooms.status, ["pending", "active"]),
          ),
        );

      let checked = 0;
      let initiated = 0;
      let skipped = 0;

      for (const room of rooms) {
        checked += 1;
        const topics = coerceTopics(room.allowedTopics).filter((topic) => topic.autonomousAllowed);
        if (topics.length === 0) {
          skipped += 1;
          continue;
        }

        const activeThreads = await db
          .select()
          .from(companyChatThreads)
          .where(
            and(
              eq(companyChatThreads.roomId, room.id),
              eq(companyChatThreads.status, "active"),
            ),
          );
        const normalizedActiveThreads = await Promise.all(
          activeThreads.map((thread) => expireThreadIfStale(thread, now)),
        );
        const activeAutonomousThreads = normalizedActiveThreads.filter(
          (thread) => thread.autonomous && thread.status === "active",
        );
        const lastThread = await db
          .select()
          .from(companyChatThreads)
          .where(eq(companyChatThreads.roomId, room.id))
          .orderBy(desc(companyChatThreads.lastActivityAt), desc(companyChatThreads.createdAt))
          .then((rows) => rows[0] ?? null);
        const normalizedLastThread = lastThread ? await expireThreadIfStale(lastThread, now) : null;

        const eligibility = evaluateAutonomousStartEligibility({
          autonomousStartEnabled: room.autonomousStartEnabled,
          activeAutonomousThreads: activeAutonomousThreads.length,
          maxAutonomousThreads: room.maxAutonomousThreads,
          idleThresholdHours: room.idleThresholdHours,
          lastRoomActivityAt: room.lastRoomActivityAt,
          now,
          lastThreadAssessment:
            (normalizedLastThread?.completionAssessment as CompanyChatCompletionAssessment | null) ?? null,
        });

        if (!eligibility.allowed) {
          skipped += 1;
          continue;
        }

        if (
          normalizedLastThread &&
          normalizedLastThread.completionAssessment === "done" &&
          normalizedLastThread.status !== "closed"
        ) {
          await db
            .update(companyChatThreads)
            .set({
              status: "closed",
              updatedAt: now,
            })
            .where(eq(companyChatThreads.id, normalizedLastThread.id));
        }

        const topic = topics[0];
        const lastThreadMessages = normalizedLastThread ? await listThreadMessagesRaw(normalizedLastThread.id) : [];
        const { selectedAgents } = await chooseAgentsForConversation({
          companyId: room.companyId,
          roomId: room.id,
          mode: "autonomous_start",
          maxSelections: 1,
          recentConversationText: formatConversationForSelection({
            topic: topic.slug,
            topicLabel: topic.label,
            topicDescription: topic.description,
            messages: lastThreadMessages.map((message) => ({
              authorType: message.authorType as "user" | "agent" | "system",
              text: message.text,
            })),
          }),
          recentSpeakerAgentIds: recentSpeakerAgentIdsFromMessages(lastThreadMessages),
        });
        const initiator = selectedAgents[0] ?? null;
        if (!initiator) {
          skipped += 1;
          continue;
        }

        await heartbeat
          .wakeup(initiator.id, {
            source: "on_demand",
            triggerDetail: "system",
            reason: "company_chat_idle_start",
            requestedByActorType: "system",
            requestedByActorId: "social_room_scheduler",
            contextSnapshot: {
              wakeReason: "company_chat_idle_start",
              chatRoomId: room.id,
              chatTopic: topic.slug,
              chatTopicLabel: topic.label,
              chatTopicDescription: topic.description,
              chatOrigin: "system",
              chatInternetAllowed: topic.internetAllowed,
              chatPersonaMode: "overlay",
              chatStartMode: "initiate_thread",
            },
          })
          .catch((error) => {
            logger.warn(
              { err: error, roomId: room.id, agentId: initiator.id },
              "failed to enqueue autonomous social-room starter",
            );
          });

        await touchRoomActivity(room.id, now);
        initiated += 1;
      }

      return { checked, initiated, skipped };
    },
  };
}
