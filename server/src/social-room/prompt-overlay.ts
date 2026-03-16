import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { and, asc, eq } from "drizzle-orm";
import type { Db } from "@orchestorai/db";
import {
  companies,
  companyChatMessages,
  companyChatRooms,
  companyChatThreads,
} from "@orchestorai/db";
import { normalizeAgentUrlKey } from "@orchestorai/shared";
import {
  buildDefaultSocialRoomPromptPack,
  composeSocialRoomInstructions,
} from "@orchestorai/social-room-runtime";
import { resolveOrchestorAIInstanceRoot } from "../home-paths.js";

interface SocialRoomOverlayResult {
  instructionsFilePath: string;
  cleanup: () => Promise<void>;
}

function readNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

async function safeReadFile(filePath: string | null) {
  if (!filePath) return null;
  try {
    return await fs.readFile(filePath, "utf8");
  } catch {
    return null;
  }
}

function resolveFallbackAgentHome(agentName: string) {
  const slug = normalizeAgentUrlKey(agentName) ?? "agent";
  return path.resolve(resolveOrchestorAIInstanceRoot(), "agents", slug);
}

function resolvePromptPackPaths(companyId: string) {
  const directory = path.resolve(
    resolveOrchestorAIInstanceRoot(),
    "data",
    "social-rooms",
    companyId,
  );
  return {
    directory,
    systemPath: path.resolve(directory, "SYSTEM.md"),
    agentsPath: path.resolve(directory, "AGENTS.md"),
    soulPath: path.resolve(directory, "SOUL.md"),
  };
}

export async function resolveSocialRoomOverlayForRun(input: {
  db: Db;
  agent: { companyId: string; name: string };
  baseConfig: Record<string, unknown>;
  context: Record<string, unknown>;
}): Promise<SocialRoomOverlayResult | null> {
  const personaMode = readNonEmptyString(input.context.chatPersonaMode);
  const roomId = readNonEmptyString(input.context.chatRoomId);
  if (personaMode !== "overlay" || !roomId) {
    return null;
  }

  const roomRow = await input.db
    .select()
    .from(companyChatRooms)
    .where(
      and(
        eq(companyChatRooms.id, roomId),
        eq(companyChatRooms.companyId, input.agent.companyId),
      ),
    )
    .then((rows) => rows[0] ?? null);
  if (!roomRow) {
    return null;
  }

  const company = await input.db
    .select({ name: companies.name })
    .from(companies)
    .where(eq(companies.id, input.agent.companyId))
    .then((rows) => rows[0] ?? null);

  const promptPackPaths = resolvePromptPackPaths(input.agent.companyId);
  await fs.mkdir(promptPackPaths.directory, { recursive: true });
  const defaultPromptPack = buildDefaultSocialRoomPromptPack(company?.name ?? null);

  const roomSystem =
    (await safeReadFile(roomRow.promptSystemPath ?? promptPackPaths.systemPath)) ??
    defaultPromptPack.system;
  const roomAgents =
    (await safeReadFile(roomRow.promptAgentsPath ?? promptPackPaths.agentsPath)) ??
    defaultPromptPack.agents;
  const roomSoul =
    (await safeReadFile(roomRow.promptSoulPath ?? promptPackPaths.soulPath)) ??
    defaultPromptPack.soul;

  const configuredInstructionsPath = readNonEmptyString(input.baseConfig.instructionsFilePath);
  const configuredAgentHome = configuredInstructionsPath
    ? path.dirname(configuredInstructionsPath)
    : resolveFallbackAgentHome(input.agent.name);

  const baseAgentsPath = path.resolve(configuredAgentHome, "AGENTS.md");
  const baseSoulPath = path.resolve(configuredAgentHome, "SOUL.md");
  const baseHeartbeatPath = path.resolve(configuredAgentHome, "HEARTBEAT.md");
  const baseToolsPath = path.resolve(configuredAgentHome, "TOOLS.md");

  const [baseAgents, baseSoul, baseHeartbeat, baseTools] = await Promise.all([
    safeReadFile(baseAgentsPath),
    safeReadFile(baseSoulPath),
    safeReadFile(baseHeartbeatPath),
    safeReadFile(baseToolsPath),
  ]);

  const threadId = readNonEmptyString(input.context.chatThreadId);
  const startMode = readNonEmptyString(input.context.chatStartMode);
  const topic = readNonEmptyString(input.context.chatTopic);
  const topicLabel = readNonEmptyString(input.context.chatTopicLabel);
  const topicDescription = readNonEmptyString(input.context.chatTopicDescription);
  const internetAllowed = readNonEmptyString(input.context.chatInternetAllowed) ?? String(input.context.chatInternetAllowed ?? "");

  let historyLines: string[] = [];
  if (threadId) {
    const thread = await input.db
      .select()
      .from(companyChatThreads)
      .where(
        and(
          eq(companyChatThreads.id, threadId),
          eq(companyChatThreads.companyId, input.agent.companyId),
        ),
      )
      .then((rows) => rows[0] ?? null);

    const history = thread
      ? await input.db
          .select()
          .from(companyChatMessages)
          .where(eq(companyChatMessages.threadId, thread.id))
          .orderBy(asc(companyChatMessages.createdAt), asc(companyChatMessages.id))
      : [];

    historyLines = history.slice(-12).map((message) => {
      const speaker =
        message.authorType === "agent"
          ? "Agent"
          : message.authorType === "user"
            ? "Human"
            : "System";
      return `- [message:${message.id}] ${speaker}: ${message.text}`;
    });
  }

  const responseInstruction = threadId
    ? `Reply to the conversation by POSTing JSON to /api/chat-threads/${threadId}/messages with { "text": "...", "internetBacked": true|false } and include X-OrchestorAI-Run-Id: $ORCHESTORAI_RUN_ID on the request.`
    : `Start a new discussion thread by POSTing JSON to /api/companies/${input.agent.companyId}/chat-room/threads with { "topic": "${topic ?? ""}", "text": "...", "autonomous": true, "internetBacked": true|false } and include X-OrchestorAI-Run-Id: $ORCHESTORAI_RUN_ID on the request.`;
  const reactionInstruction = threadId
    ? 'You may also react to a recent message by POSTing JSON to /api/chat-messages/<messageId>/reactions with { "emoji": "joy" }. Use a reaction when that feels more natural than forcing another full reply.'
    : null;

  const contextBrief = [
    `Company chat room ID: ${roomRow.id}`,
    `Room display name: ${roomRow.displayName}`,
    readNonEmptyString(input.context.wakeReason)
      ? `Wake reason: ${readNonEmptyString(input.context.wakeReason)}`
      : null,
    topic ? `Topic slug: ${topic}` : null,
    topicLabel ? `Topic label: ${topicLabel}` : null,
    topicDescription ? `Topic description: ${topicDescription}` : null,
    `Internet allowed: ${internetAllowed || "true"}`,
    threadId ? `Existing thread ID: ${threadId}` : "No thread exists yet for this wake.",
    startMode === "initiate_thread"
      ? "You are responsible for opening the next thread before chatting."
      : null,
    "This is general social chat only. Do not create tasks, approvals, or backlog work from this run.",
    "Do not write durable memory for casual banter, gossip, or venting unless a fact clearly becomes operationally durable.",
    "If you are replying to a colleague directly, mention them by name.",
    "Keep your reply short. Usually 1 to 3 short sentences is enough.",
    "Add a distinct angle instead of repeating what another agent already said. If you have nothing new, react instead of posting filler.",
    "Post at most one full thread reply per run unless the first request clearly failed. Do not retry the same reply after a successful API response.",
    responseInstruction,
    reactionInstruction,
    historyLines.length > 0 ? "Recent thread history:" : null,
    ...historyLines,
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");

  const combinedInstructions = composeSocialRoomInstructions({
    baseFiles: {
      agents: {
        label: "Base Agent AGENTS",
        path: baseAgentsPath,
        content: baseAgents,
      },
      soul: {
        label: "Base Agent SOUL",
        path: baseSoulPath,
        content: baseSoul,
      },
      heartbeat: {
        label: "Base Agent HEARTBEAT",
        path: baseHeartbeatPath,
        content: baseHeartbeat,
      },
      tools: {
        label: "Base Agent TOOLS",
        path: baseToolsPath,
        content: baseTools,
      },
    },
    roomFiles: {
      system: {
        label: "Social Room SYSTEM",
        path: roomRow.promptSystemPath ?? promptPackPaths.systemPath,
        content: roomSystem,
      },
      agents: {
        label: "Social Room AGENTS",
        path: roomRow.promptAgentsPath ?? promptPackPaths.agentsPath,
        content: roomAgents,
      },
      soul: {
        label: "Social Room SOUL",
        path: roomRow.promptSoulPath ?? promptPackPaths.soulPath,
        content: roomSoul,
      },
    },
    contextBrief,
  });

  const overlayDir = await fs.mkdtemp(path.join(os.tmpdir(), "orchestorai-social-room-"));
  const overlayAgentsPath = path.resolve(overlayDir, "AGENTS.md");
  await fs.writeFile(overlayAgentsPath, combinedInstructions, "utf8");

  if (baseHeartbeat) {
    await fs.writeFile(path.resolve(overlayDir, "HEARTBEAT.md"), baseHeartbeat, "utf8");
  }
  if (baseSoul) {
    await fs.writeFile(path.resolve(overlayDir, "SOUL.md"), baseSoul, "utf8");
  }
  if (baseTools) {
    await fs.writeFile(path.resolve(overlayDir, "TOOLS.md"), baseTools, "utf8");
  }

  return {
    instructionsFilePath: overlayAgentsPath,
    cleanup: async () => {
      await fs.rm(overlayDir, { recursive: true, force: true });
    },
  };
}
