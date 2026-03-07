import fs from "node:fs";
import SlackBolt from "@slack/bolt";
import { PairingStore } from "./pairing-store.js";
import { handleSlackNativeAction } from "./slack-actions.js";
import { PaperclipClient } from "./paperclip-client.js";
import { PaperclipThreadStore } from "./paperclip-thread-store.js";
import {
  detectPaperclipCommentRequest,
  buildIssueDescription,
  detectPaperclipSummaryRequest,
  detectTaskRequest,
  extractProjectSelectors,
  extractIssueIdentifiers,
  fingerprintIssueComment,
  formatActivityNotification,
  formatChildIssueParentNotice,
  formatChildIssueThreadRootMessage,
  formatRunNotification,
  getPrimaryReferenceAlias,
  hasPaperclipTrigger,
  resolveAssignee,
  resolveProject,
  stripBotMention,
} from "./paperclip-bridge.js";

const slackBoltModule = SlackBolt;
const slackBolt = (slackBoltModule.App ? slackBoltModule : slackBoltModule.default) ?? slackBoltModule;
const { App, HTTPReceiver } = slackBolt;

const MAX_ATTACHMENT_FILES = 5;
const MAX_ATTACHMENT_SNIPPET_CHARS = 6000;
const MAX_CONTEXT_HISTORY_LINES = 30;
const SLACK_TYPING_KEEPALIVE_MS = 3000;
const SLACK_TYPING_MAX_DURATION_MS = 60000;
const SLACK_TYPING_MAX_FAILURES = 2;
const PAPERCLIP_RUN_CACHE_TTL_MS = 15 * 60 * 1000;
const PAPERCLIP_LIVE_EVENT_TTL_MS = 10 * 60 * 1000;

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeId(value) {
  return String(value || "").trim().toLowerCase();
}

function formatAgentAliasLabel(agent) {
  const alias = getPrimaryReferenceAlias(agent);
  return alias ? `@${alias}` : agent?.name || "unknown";
}

function formatProjectAliasLabel(project) {
  const alias = getPrimaryReferenceAlias(project);
  return alias ? `project: ${alias}` : project?.name || "unknown";
}

function normalizeChannelType(channelType, channelId) {
  if (channelType === "app_home") {
    return "im";
  }
  if (channelType) {
    return channelType;
  }
  if (/^D/i.test(channelId || "")) {
    return "im";
  }
  if (/^G/i.test(channelId || "")) {
    return "group";
  }
  if (/^C/i.test(channelId || "")) {
    return "channel";
  }
  return "channel";
}

function buildMentionRegexes(patterns) {
  const out = [];
  for (const raw of patterns || []) {
    if (!raw || typeof raw !== "string") {
      continue;
    }
    try {
      out.push(new RegExp(raw, "i"));
    } catch {
      // ignore invalid regex entries
    }
  }
  return out;
}

function cleanSlackText(text) {
  return String(text || "")
    .replace(/<@[^>]+>/g, "")
    .trim();
}

function humanizeToken(value) {
  return String(value || "unknown")
    .replace(/_/g, " ")
    .trim();
}

function truncateTextValue(value, max = 140) {
  const normalized = String(value || "").replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "";
  }
  if (normalized.length <= max) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, max - 3)).trimEnd()}...`;
}

function finishSentence(value) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    return "";
  }
  return /[.!?]$/.test(normalized) ? normalized : `${normalized}.`;
}

function extractIssueBrief(description) {
  const lines = String(description || "")
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  for (const line of lines) {
    if (
      line.startsWith("```") ||
      /^#{1,6}\s/.test(line) ||
      /^[-*]\s/.test(line) ||
      /^\d+\.\s/.test(line) ||
      /^source\s*:/i.test(line)
    ) {
      continue;
    }
    const cleaned = truncateTextValue(line.replace(/`/g, ""), 180);
    if (cleaned) {
      return cleaned;
    }
  }
  return "";
}

function formatCommentBodyForSlack(body) {
  const lines = String(body || "")
    .replace(/\r/g, "")
    .replace(/`/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .split("\n");

  const out = [];
  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed) {
      if (out.length > 0 && out[out.length - 1] !== "") {
        out.push("");
      }
      continue;
    }
    if (/^#{1,6}\s*/.test(trimmed)) {
      continue;
    }
    out.push(trimmed.replace(/^[-*]\s+/, ""));
  }

  while (out.length > 0 && out[0] === "") {
    out.shift();
  }
  while (out.length > 0 && out[out.length - 1] === "") {
    out.pop();
  }

  return out.join("\n");
}

function sortIssuesByRecentUpdate(issues) {
  return [...(issues || [])].sort((left, right) => {
    const leftValue = new Date(left?.updatedAt || left?.createdAt || 0).getTime();
    const rightValue = new Date(right?.updatedAt || right?.createdAt || 0).getTime();
    return rightValue - leftValue;
  });
}

function formatOverviewIssueEntry(issue, agentsById) {
  const identifier = String(issue?.identifier || "").trim();
  const title = truncateTextValue(issue?.title || "Untitled issue", 90);
  const status = humanizeToken(issue?.status);
  const assigneeName = issue?.assigneeAgentId ? agentsById.get(String(issue.assigneeAgentId)) || "" : "";
  const details = [status];
  if (assigneeName) {
    details.push(assigneeName);
  }
  const label = identifier ? `${identifier} ${title}` : title;
  return `${label} (${details.join(", ")})`;
}

export function buildPaperclipIssueSummary({ issue, assigneeName = "", projectName = "", parentIdentifier = "" }) {
  const identifier = String(issue?.identifier || "Paperclip issue").trim();
  const title = truncateTextValue(issue?.title || "Untitled issue", 140);
  const statusParts = [
    `Status: ${humanizeToken(issue?.status)}`,
    `Priority: ${humanizeToken(issue?.priority)}`,
    `Assignee: ${assigneeName || "unassigned"}`,
  ];
  if (projectName) {
    statusParts.push(`Project: ${projectName}`);
  }

  const brief = extractIssueBrief(issue?.description);
  const contextParts = [];
  if (parentIdentifier) {
    contextParts.push(`Parent: ${parentIdentifier}`);
  }
  if (brief) {
    contextParts.push(`Brief: ${brief}`);
  }
  if (contextParts.length === 0) {
    contextParts.push(`Updated: ${humanizeToken(issue?.updatedAt || issue?.createdAt || "unknown")}`);
  }

  return [
    "*Summary*",
    `- ${identifier}: ${title}`,
    `- ${finishSentence(statusParts.join(". "))}`,
    `- ${finishSentence(contextParts.join(". "))}`,
  ].join("\n");
}

export function buildPaperclipOverviewSummary({
  issues,
  agentsById = new Map(),
  projectName = "",
  scopeLabel = "",
}) {
  const visibleIssues = (issues || []).filter((issue) => !issue?.hiddenAt);
  const scope = projectName
    ? `in ${projectName}`
    : scopeLabel
      ? `for ${scopeLabel}`
      : "in Paperclip";

  if (visibleIssues.length === 0) {
    return `*Summary*\n- No tickets found ${scope}.`;
  }

  const counts = new Map();
  for (const issue of visibleIssues) {
    const key = String(issue?.status || "unknown").trim() || "unknown";
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const orderedStatuses = ["todo", "in_progress", "in_review", "blocked", "done", "cancelled"];
  const countSummary = [
    ...orderedStatuses.filter((status) => counts.has(status)).map((status) => `${counts.get(status)} ${humanizeToken(status)}`),
    ...Array.from(counts.entries())
      .filter(([status]) => !orderedStatuses.includes(status))
      .map(([status, count]) => `${count} ${humanizeToken(status)}`),
  ].join(", ");

  const openIssues = sortIssuesByRecentUpdate(
    visibleIssues.filter((issue) => !["done", "cancelled"].includes(String(issue?.status || ""))),
  );
  const completedIssues = sortIssuesByRecentUpdate(
    visibleIssues.filter((issue) => String(issue?.status || "") === "done"),
  );

  const activeLine =
    openIssues.length > 0
      ? `- Active: ${openIssues.slice(0, 3).map((issue) => formatOverviewIssueEntry(issue, agentsById)).join("; ")}`
      : "- Active: none right now.";
  const completedLine =
    completedIssues.length > 0
      ? `- Recent completions: ${completedIssues
          .slice(0, 2)
          .map((issue) => formatOverviewIssueEntry(issue, agentsById))
          .join("; ")}`
      : "- Recent completions: none yet.";

  return [
    "*Summary*",
    `- ${visibleIssues.length} tickets ${scope}: ${countSummary}.`,
    activeLine,
    completedLine,
  ].join("\n");
}

export function buildPaperclipLatestCommentSummary({
  identifier,
  comment,
  authorName = "",
}) {
  const issueRef = String(identifier || "Paperclip issue").trim();
  if (!comment) {
    return `*Summary*\n- ${issueRef} has no comments yet.`;
  }

  const body = formatCommentBodyForSlack(comment.body);
  const prefix = authorName
    ? `Latest comment on ${issueRef} by ${authorName}`
    : `Latest comment on ${issueRef}`;
  return ["*Summary*", `${prefix}:`, body || "(empty comment)"].join("\n");
}

function parseReplyTag(text) {
  const raw = String(text || "");
  const currentMatch = /\[\[reply_to_current\]\]/i.exec(raw);
  const explicitMatch = /\[\[reply_to:([^\]]+)\]\]/i.exec(raw);
  const cleaned = raw
    .replace(/\[\[reply_to_current\]\]/gi, "")
    .replace(/\[\[reply_to:[^\]]+\]\]/gi, "")
    .trim();
  return {
    cleaned,
    replyToCurrent: Boolean(currentMatch),
    explicitReplyTs: explicitMatch?.[1]?.trim() || "",
  };
}

function chunkByLength(text, limit) {
  if (!text) {
    return [];
  }
  if (text.length <= limit) {
    return [text];
  }
  const chunks = [];
  let cursor = 0;
  while (cursor < text.length) {
    chunks.push(text.slice(cursor, cursor + limit));
    cursor += limit;
  }
  return chunks;
}

function chunkByNewline(text, limit) {
  if (!text) {
    return [];
  }
  const paragraphs = String(text)
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean);

  if (paragraphs.length === 0) {
    return [];
  }

  const out = [];
  let current = "";
  for (const paragraph of paragraphs) {
    if (!current) {
      if (paragraph.length <= limit) {
        current = paragraph;
      } else {
        out.push(...chunkByLength(paragraph, limit));
      }
      continue;
    }

    const next = `${current}\n\n${paragraph}`;
    if (next.length <= limit) {
      current = next;
      continue;
    }

    out.push(current);
    if (paragraph.length <= limit) {
      current = paragraph;
    } else {
      out.push(...chunkByLength(paragraph, limit));
      current = "";
    }
  }
  if (current) {
    out.push(current);
  }
  return out;
}

function chunkText(text, limit, mode) {
  const normalized = String(text || "").trim();
  if (!normalized) {
    return [];
  }
  if (mode === "newline") {
    const newlineChunks = chunkByNewline(normalized, limit);
    if (newlineChunks.length > 0) {
      return newlineChunks;
    }
  }
  return chunkByLength(normalized, limit);
}

function isTextMime(mime) {
  if (!mime) {
    return false;
  }
  const normalized = String(mime).toLowerCase();
  return (
    normalized.startsWith("text/") ||
    normalized.includes("json") ||
    normalized.includes("xml") ||
    normalized.includes("yaml") ||
    normalized.includes("csv") ||
    normalized.includes("javascript")
  );
}

function formatEventSummary(event) {
  const entries = [
    `type=${event?.type || "unknown"}`,
    `subtype=${event?.subtype || "none"}`,
    `channel=${event?.channel || "none"}`,
    `user=${event?.user || event?.bot_id || "none"}`,
    `thread=${event?.thread_ts || event?.ts || "none"}`,
  ];
  return entries.join(" ");
}

function isThreadReplyMessage(event) {
  return Boolean(
    event?.thread_ts && (event.thread_ts !== event.ts || Boolean(event.parent_user_id)),
  );
}

function pruneExpiringMap(map) {
  const now = Date.now();
  for (const [key, entry] of map.entries()) {
    if (!entry || Number(entry.expiresAt || 0) <= now) {
      map.delete(key);
    }
  }
}

function parseApiAppIdFromAppToken(raw) {
  if (!raw) {
    return "";
  }
  const match = /^xapp-\d-([a-z0-9]+)-/i.exec(String(raw).trim());
  return match?.[1]?.toUpperCase() || "";
}

function resolveReplyToMode(config, chatType) {
  const byType = config.slack.replyToModeByChatType?.[chatType];
  if (byType === "off" || byType === "first" || byType === "all") {
    return byType;
  }
  return config.slack.replyToMode;
}

function resolveSlackThreadTargets({ message, replyToMode }) {
  const incomingThreadTs = message.thread_ts;
  const messageTs = message.ts || message.event_ts;
  const hasThreadTs = typeof incomingThreadTs === "string" && incomingThreadTs.length > 0;
  const isThreadReply =
    hasThreadTs && (incomingThreadTs !== messageTs || Boolean(message.parent_user_id));

  const replyThreadTs = isThreadReply
    ? incomingThreadTs
    : replyToMode === "all"
      ? messageTs
      : undefined;

  return {
    replyThreadTs,
    statusThreadTs: replyThreadTs,
    isThreadReply,
  };
}

function resolveAllowListMatch({ allowList, id, name, allowNameMatching }) {
  const normalized = (allowList || []).map((entry) => String(entry).trim().toLowerCase());
  if (normalized.includes("*")) {
    return true;
  }
  const normalizedId = normalizeId(id);
  if (!normalizedId) {
    return false;
  }

  const candidates = [normalizedId, `slack:${normalizedId}`, `user:${normalizedId}`];
  if (allowNameMatching && name) {
    const lowerName = String(name).trim().toLowerCase();
    const slug = slugify(lowerName);
    candidates.push(lowerName, `slack:${lowerName}`, slug);
  }
  return candidates.some((candidate) => normalized.includes(candidate));
}

function isSkippableSubtype(event) {
  const subtype = event?.subtype;
  if (!subtype) {
    return false;
  }
  return !["file_share", "thread_broadcast", "bot_message", "message_replied"].includes(subtype);
}

async function safeAck(ack, payload) {
  try {
    if (payload === undefined) {
      await ack();
    } else {
      await ack(payload);
    }
  } catch {
    // ignore duplicate ack errors
  }
}

export class SlackRuntime {
  constructor(params) {
    this.config = params.config;
    this.configPath = params.configPath;
    this.codex = params.codex;

    this.channelCache = new Map();
    this.userCache = new Map();
    this.seen = new Map();
    this.threadParticipation = new Map();
    this.debounce = new Map();
    this.warnedTypingWithoutThread = false;

    this.botUserId = "";
    this.teamId = "";
    this.expectedAppId = this.config.slack.appId || parseApiAppIdFromAppToken(this.config.slack.appToken);

    this.mentionRegexes = buildMentionRegexes(this.config.slack.mentionPatterns);

    this.pairingStore = new PairingStore(this.config.runtime.dataDir);
    this.pairingStore.ensureLoaded();

    fs.mkdirSync(this.config.runtime.dataDir, { recursive: true });

    this.paperclipClient = this.config.paperclip.enabled
      ? new PaperclipClient({
          apiUrl: this.config.paperclip.apiUrl,
          companyId: this.config.paperclip.companyId,
          log: (level, message) => this.log(level, message),
        })
      : null;
    this.paperclipThreadStore = this.config.paperclip.enabled
      ? new PaperclipThreadStore(this.config.runtime.dataDir)
      : null;
    if (this.paperclipThreadStore) {
      this.paperclipThreadStore.ensureLoaded();
    }
    this.paperclipRunIssueCache = new Map();
    this.paperclipThreadProvisioning = new Map();
    this.paperclipSeenLiveEvents = new Map();
    this.paperclipStopLiveEvents = null;

    const appOptions =
      this.config.slack.mode === "http"
        ? {
            token: this.config.slack.botToken,
            receiver: new HTTPReceiver({
              signingSecret: this.config.slack.signingSecret,
              endpoints: this.config.slack.webhookPath,
            }),
          }
        : {
            token: this.config.slack.botToken,
            appToken: this.config.slack.appToken,
            socketMode: true,
          };

    this.app = new App(appOptions);
  }

  log(level, message, meta) {
    const order = { debug: 10, info: 20, warn: 30, error: 40 };
    const current = order[this.config.runtime.logLevel] || 20;
    const required = order[level] || 20;
    if (required < current) {
      return;
    }
    const prefix = `[${level}]`;
    if (meta) {
      console.log(prefix, message, meta);
    } else {
      console.log(prefix, message);
    }
  }

  isPaperclipEnabled() {
    return Boolean(this.paperclipClient && this.paperclipThreadStore && this.config.paperclip.enabled);
  }

  isDirectBotMention(event, options) {
    if (options?.forcedMention) {
      return true;
    }
    const text = String(event?.text || "");
    if (this.botUserId && text.includes(`<@${this.botUserId}>`)) {
      return true;
    }
    return this.mentionRegexes.some((regex) => regex.test(text));
  }

  getMappedPaperclipThread(event) {
    if (!this.paperclipThreadStore) {
      return null;
    }
    if (!isThreadReplyMessage(event)) {
      return null;
    }
    return this.paperclipThreadStore.getMapping(event.channel, event.thread_ts);
  }

  rememberPaperclipPreferredChannel({ channelId, channelType, event, options }) {
    if (!this.paperclipThreadStore || !this.config?.paperclip?.companyId || !channelId) {
      return;
    }

    if (channelType === "im") {
      this.paperclipThreadStore.setPreferredChannel(this.config.paperclip.companyId, channelId);
      return;
    }

    const text = String(event?.text || "");
    const explicitPaperclipTrigger = hasPaperclipTrigger({
      text,
      botUserId: this.botUserId,
      triggerMentions: this.config.paperclip.triggerMentions,
    });
    if (explicitPaperclipTrigger || this.isDirectBotMention(event, options)) {
      this.paperclipThreadStore.setPreferredChannel(this.config.paperclip.companyId, channelId);
    }
  }

  rememberPaperclipRunIssues(runId, issues) {
    if (!runId) {
      return;
    }
    const issueIds = Array.from(
      new Set(
        (issues || [])
          .map((issue) => String(issue?.issueId || issue?.id || "").trim())
          .filter(Boolean),
      ),
    );
    if (issueIds.length === 0) {
      this.paperclipRunIssueCache.delete(String(runId));
      return;
    }
    this.paperclipRunIssueCache.set(String(runId), {
      issueIds,
      expiresAt: Date.now() + PAPERCLIP_RUN_CACHE_TTL_MS,
    });
  }

  getCachedPaperclipRunIssues(runId) {
    pruneExpiringMap(this.paperclipRunIssueCache);
    const entry = this.paperclipRunIssueCache.get(String(runId || ""));
    return entry ? entry.issueIds : null;
  }

  markPaperclipEventSeen(event) {
    pruneExpiringMap(this.paperclipSeenLiveEvents);
    const idPart = String(event?.id || "").trim();
    const createdAtPart = String(event?.createdAt || "").trim();
    if (!idPart && !createdAtPart) {
      return false;
    }
    const key = `${idPart}:${createdAtPart}`;
    if (this.paperclipSeenLiveEvents.has(key)) {
      return true;
    }
    this.paperclipSeenLiveEvents.set(key, {
      expiresAt: Date.now() + PAPERCLIP_LIVE_EVENT_TTL_MS,
    });
    return false;
  }

  async postPaperclipThreadReply(channel, threadTs, text) {
    const message = String(text || "").trim();
    if (!channel || !threadTs || !message) {
      return;
    }
    await this.app.client.chat.postMessage({
      channel,
      thread_ts: threadTs,
      text: message,
    });
    this.threadParticipation.set(`${channel}:${threadTs}`, Date.now());
  }

  async postPaperclipRootMessage(channel, text) {
    const message = String(text || "").trim();
    if (!channel || !message) {
      return "";
    }
    const response = await this.app.client.chat.postMessage({
      channel,
      text: message,
    });
    const ts = String(response?.ts || "").trim();
    if (!ts) {
      throw new Error("Slack did not return a timestamp for the Paperclip thread root");
    }
    this.threadParticipation.set(`${channel}:${ts}`, Date.now());
    return ts;
  }

  async resolvePaperclipActorName(payload) {
    if (!payload || payload.actorType === "system") {
      return "system";
    }
    if (payload.actorType === "user") {
      return payload.actorId === "local-board" ? "board" : String(payload.actorId || "board");
    }
    const agentId = payload.agentId || payload.actorId;
    if (!agentId || !this.paperclipClient) {
      return "";
    }
    return await this.paperclipClient.getAgentName(agentId);
  }

  buildPaperclipAgentNameMap(agents) {
    return new Map(
      (agents || [])
        .map((agent) => [String(agent?.id || "").trim(), String(agent?.name || "").trim()])
        .filter(([id, name]) => id && name),
    );
  }

  resolveIssueParentIdentifier(issue) {
    if (!issue?.parentId || !Array.isArray(issue?.ancestors)) {
      return "";
    }
    const parent = issue.ancestors.find((entry) => String(entry?.id || "") === String(issue.parentId || ""));
    return String(parent?.identifier || "").trim();
  }

  async maybeHandlePaperclipSummaryRequest({ event, mappedThread }) {
    if (!this.paperclipClient) {
      return false;
    }

    const request = detectPaperclipSummaryRequest({
      text: event.text || "",
      mappedIssueIdentifier: mappedThread?.issueIdentifier || "",
    });
    if (!request) {
      return false;
    }

    const replyThreadTs = event.thread_ts || event.ts;

    try {
      const agents = await this.paperclipClient.listAgents();
      const agentsById = this.buildPaperclipAgentNameMap(agents);

      if (request.kind === "issue") {
        const identifiers = request.issueIdentifiers.length > 0
          ? request.issueIdentifiers
          : extractIssueIdentifiers(event.text || "");
        if (identifiers.length === 0) {
          return false;
        }

        if (identifiers.length === 1) {
          const issue = await this.paperclipClient.getIssue(identifiers[0]);
          const summary = buildPaperclipIssueSummary({
            issue,
            assigneeName: issue?.assigneeAgentId ? agentsById.get(String(issue.assigneeAgentId)) || "" : "",
            projectName: String(issue?.project?.name || "").trim(),
            parentIdentifier: this.resolveIssueParentIdentifier(issue),
          });
          await this.postPaperclipThreadReply(event.channel, replyThreadTs, summary);
          return true;
        }

        const matchedIssues = (
          await Promise.all(
            identifiers.map(async (identifier) => {
              try {
                return await this.paperclipClient.getIssue(identifier);
              } catch {
                return null;
              }
            }),
          )
        ).filter(Boolean);

        const summary = buildPaperclipOverviewSummary({
          issues: matchedIssues,
          agentsById,
          scopeLabel: "requested tickets",
        });
        await this.postPaperclipThreadReply(event.channel, replyThreadTs, summary);
        return true;
      }

      let issues = await this.paperclipClient.listIssues();
      let projectName = "";
      const projectSelectors = extractProjectSelectors(event.text || "");
      if (projectSelectors.length > 0) {
        const projects = await this.paperclipClient.listProjects();
        const project = resolveProject({
          text: event.text || "",
          projectMappings: this.config.paperclip.projectMappings,
          projects,
        });

        if (project.kind !== "match") {
          let message =
            "I could not resolve a Paperclip project. Use `project: <project alias>` or an exact Paperclip project name.";
          if (project.kind === "ambiguous" && Array.isArray(project.candidates) && project.candidates.length > 0) {
            const names = project.candidates
              .map((entry) => `${entry.name} (${formatProjectAliasLabel(entry)})`)
              .filter(Boolean)
              .join(", ");
            if (names) {
              message = `I found multiple possible projects: ${names}. Use one canonical project alias or one exact project name.`;
            }
          }
          await this.postPaperclipThreadReply(event.channel, replyThreadTs, message);
          return true;
        }

        projectName = String(project.project?.name || "").trim();
        issues = issues.filter((issue) => String(issue?.projectId || "") === String(project.project.id || ""));
      }

      const summary = buildPaperclipOverviewSummary({
        issues,
        agentsById,
        projectName,
      });
      await this.postPaperclipThreadReply(event.channel, replyThreadTs, summary);
      return true;
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      const missingIdentifier = request.kind === "issue" ? request.issueIdentifiers[0] || "" : "";
      const message = /issue not found/i.test(reason) && missingIdentifier
        ? `I could not find Paperclip issue ${missingIdentifier}.`
        : `Paperclip summary failed: ${reason}`;
      await this.postPaperclipThreadReply(event.channel, replyThreadTs, message);
      return true;
    }
  }

  async maybeHandlePaperclipCommentRequest({ event, mappedThread }) {
    if (!this.paperclipClient) {
      return false;
    }

    const request = detectPaperclipCommentRequest({
      text: event.text || "",
      mappedIssueIdentifier: mappedThread?.issueIdentifier || "",
    });
    if (!request) {
      return false;
    }

    const replyThreadTs = event.thread_ts || event.ts;

    try {
      const identifier = request.issueIdentifiers[0] || "";
      if (!identifier) {
        return false;
      }

      const [issue, comments, agents] = await Promise.all([
        this.paperclipClient.getIssue(identifier),
        this.paperclipClient.listIssueComments(identifier),
        this.paperclipClient.listAgents(),
      ]);

      const latestComment = Array.isArray(comments) && comments.length > 0 ? comments[0] : null;
      const agentsById = this.buildPaperclipAgentNameMap(agents);
      const authorName = latestComment?.authorAgentId
        ? agentsById.get(String(latestComment.authorAgentId)) || ""
        : latestComment?.authorUserId
          ? String(latestComment.authorUserId) === "local-board"
            ? "board"
            : String(latestComment.authorUserId)
          : "";

      const summary = buildPaperclipLatestCommentSummary({
        identifier: issue?.identifier || identifier,
        comment: latestComment,
        authorName,
      });
      await this.postPaperclipThreadReply(event.channel, replyThreadTs, summary);
      return true;
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      const missingIdentifier = request.issueIdentifiers[0] || "";
      const message = /issue not found/i.test(reason) && missingIdentifier
        ? `I could not find Paperclip issue ${missingIdentifier}.`
        : `Paperclip comment lookup failed: ${reason}`;
      await this.postPaperclipThreadReply(event.channel, replyThreadTs, message);
      return true;
    }
  }

  async ensurePaperclipThreadMappingForIssue(issueId, options = {}, visited = new Set()) {
    if (!issueId || !this.paperclipThreadStore || !this.paperclipClient) {
      return null;
    }

    const normalizedIssueId = String(issueId || "").trim();
    if (!normalizedIssueId) {
      return null;
    }

    const existing = this.paperclipThreadStore.getMappingByIssueId(normalizedIssueId);
    if (existing) {
      return existing;
    }

    if (visited.has(normalizedIssueId)) {
      return null;
    }

    const inFlight = this.paperclipThreadProvisioning.get(normalizedIssueId);
    if (inFlight) {
      return await inFlight;
    }

    visited.add(normalizedIssueId);

    const task = (async () => {
      const issue = await this.paperclipClient.getIssue(normalizedIssueId);
      if (!issue?.id) {
        return null;
      }

      if (!issue.parentId) {
        const fallbackChannelId = String(options.fallbackChannelId || "").trim();
        if (!options.allowTopLevelRoot || !fallbackChannelId) {
          return null;
        }

        const assigneeName =
          issue.assigneeAgentId && this.paperclipClient
            ? await this.paperclipClient.getAgentName(issue.assigneeAgentId)
            : "";
        const projectName = String(issue.project?.name || "").trim();
        const issueIdentifier = String(issue.identifier || issue.id).trim();
        const threadTs = await this.postPaperclipRootMessage(
          fallbackChannelId,
          formatChildIssueThreadRootMessage({
            childIdentifier: issueIdentifier,
            parentIdentifier: "",
            title: issue.title,
            assigneeName,
            projectName,
          }),
        );

        const mapping = this.paperclipThreadStore.putMapping({
          channelId: fallbackChannelId,
          threadTs,
          companyId: issue.companyId || this.config.paperclip.companyId,
          issueId: issue.id,
          issueIdentifier: issue.identifier,
          issueTitle: issue.title,
          assigneeAgentId: issue.assigneeAgentId,
          assigneeName,
          projectId: issue.projectId || null,
          projectName,
          rootIssueId: issue.id,
          rootIssueIdentifier: issue.identifier,
          sourceMessageTs: threadTs,
        });

        this.log(
          "info",
          `paperclip top-level issue thread created issue=${issue.id} thread=${fallbackChannelId}:${threadTs}`,
        );
        return mapping;
      }

      const parentMapping =
        this.paperclipThreadStore.getMappingByIssueId(issue.parentId) ||
        (await this.ensurePaperclipThreadMappingForIssue(issue.parentId, options, visited));
      if (!parentMapping) {
        return null;
      }

      const assigneeName =
        issue.assigneeAgentId && this.paperclipClient
          ? await this.paperclipClient.getAgentName(issue.assigneeAgentId)
          : "";
      const childIdentifier = String(issue.identifier || issue.id).trim();
      const parentIdentifier = String(parentMapping.issueIdentifier || "").trim();
      const projectName = String(issue.project?.name || parentMapping.projectName || "").trim();

      const threadTs = await this.postPaperclipRootMessage(
        parentMapping.channelId,
        formatChildIssueThreadRootMessage({
          childIdentifier,
          parentIdentifier,
          title: issue.title,
          assigneeName,
          projectName,
        }),
      );

      const mapping = this.paperclipThreadStore.putMapping({
        channelId: parentMapping.channelId,
        threadTs,
        companyId: issue.companyId || parentMapping.companyId || this.config.paperclip.companyId,
        issueId: issue.id,
        issueIdentifier: issue.identifier,
        issueTitle: issue.title,
        assigneeAgentId: issue.assigneeAgentId,
        assigneeName,
        projectId: issue.projectId || parentMapping.projectId || null,
        projectName,
        parentIssueId: issue.parentId,
        parentIssueIdentifier: parentIdentifier,
        rootIssueId: parentMapping.rootIssueId || parentMapping.issueId,
        rootIssueIdentifier: parentMapping.rootIssueIdentifier || parentMapping.issueIdentifier,
        sourceMessageTs: threadTs,
        inheritedFromThreadTs: parentMapping.threadTs,
      });

      if (options.notifyParentThread) {
        const parentNotice = formatChildIssueParentNotice({
          childIdentifier,
          parentIdentifier,
        });
        if (parentNotice) {
          await this.postPaperclipThreadReply(parentMapping.channelId, parentMapping.threadTs, parentNotice);
        }
      }

      this.log(
        "info",
        `paperclip child issue thread created issue=${issue.id} thread=${parentMapping.channelId}:${threadTs} parent=${parentMapping.issueId}`,
      );
      return mapping;
    })();

    this.paperclipThreadProvisioning.set(normalizedIssueId, task);
    try {
      return await task;
    } finally {
      if (this.paperclipThreadProvisioning.get(normalizedIssueId) === task) {
        this.paperclipThreadProvisioning.delete(normalizedIssueId);
      }
    }
  }

  async resolvePaperclipThreadMappingsForRun(runId) {
    if (!runId || !this.paperclipThreadStore || !this.paperclipClient) {
      return [];
    }

    let issueIds = this.getCachedPaperclipRunIssues(runId);
    if (!issueIds) {
      const issues = await this.paperclipClient.getRunIssues(runId);
      this.rememberPaperclipRunIssues(runId, issues);
      issueIds = this.getCachedPaperclipRunIssues(runId) || [];
    }

    const mappings = [];
    for (const issueId of issueIds) {
      const mapping =
        this.paperclipThreadStore.getMappingByIssueId(issueId) ||
        (await this.ensurePaperclipThreadMappingForIssue(issueId));
      if (mapping) {
        mappings.push(mapping);
      }
    }
    return mappings;
  }

  async handlePaperclipLiveEvent(event) {
    if (!this.isPaperclipEnabled()) {
      return;
    }
    if (!event || this.markPaperclipEventSeen(event)) {
      return;
    }

    const payload = event.payload && typeof event.payload === "object" ? event.payload : {};
    this.log(
      "debug",
      `paperclip event type=${event.type || "unknown"} id=${String(event.id || "")} entity=${String(payload.entityType || "")}:${String(payload.entityId || "")} action=${String(payload.action || "")} run=${String(payload.runId || "")}`,
    );

    if (event.type === "activity.logged") {
      if (payload.entityType !== "issue" || !payload.entityId) {
        return;
      }

      if (payload.action === "issue.created") {
        if (payload.runId) {
          this.rememberPaperclipRunIssues(payload.runId, [{ issueId: payload.entityId }]);
        }
        const fallbackChannelId = this.paperclipThreadStore.getPreferredChannel(this.config.paperclip.companyId);
        await this.ensurePaperclipThreadMappingForIssue(payload.entityId, {
          notifyParentThread: true,
          allowTopLevelRoot: payload.actorType === "user",
          fallbackChannelId,
        });
        return;
      }

      if (!["issue.updated", "issue.comment_added", "issue.checked_out", "issue.released"].includes(payload.action)) {
        return;
      }

      const mapping =
        this.paperclipThreadStore.getMappingByIssueId(payload.entityId) ||
        (await this.ensurePaperclipThreadMappingForIssue(payload.entityId));
      if (!mapping) {
        return;
      }

      if (payload.runId) {
        this.rememberPaperclipRunIssues(payload.runId, [{ issueId: payload.entityId }]);
      }

      if (payload.action === "issue.comment_added") {
        const fingerprint = fingerprintIssueComment(payload.details?.bodySnippet || "");
        if (fingerprint && this.paperclipThreadStore.hasRecentSlackFingerprint(payload.entityId, fingerprint)) {
          return;
        }
      }

      const actorName = await this.resolvePaperclipActorName(payload);
      const message = formatActivityNotification({
        action: payload.action,
        identifier: mapping.issueIdentifier,
        details: payload.details || {},
        actorName,
      });
      if (!message) {
        return;
      }
      await this.postPaperclipThreadReply(mapping.channelId, mapping.threadTs, message);
      return;
    }

    if (!["heartbeat.run.queued", "heartbeat.run.status"].includes(event.type)) {
      return;
    }

    const mappings = await this.resolvePaperclipThreadMappingsForRun(payload.runId);
    if (mappings.length === 0) {
      return;
    }

    const agentName =
      payload.agentId && this.paperclipClient ? await this.paperclipClient.getAgentName(payload.agentId) : "";
    for (const mapping of mappings) {
      const message = formatRunNotification({
        eventType: event.type,
        status: payload.status,
        identifier: mapping.issueIdentifier,
        agentName,
        error: payload.error,
      });
      if (!message) {
        continue;
      }
      await this.postPaperclipThreadReply(mapping.channelId, mapping.threadTs, message);
    }
  }

  async startPaperclipBridge() {
    if (!this.isPaperclipEnabled()) {
      return;
    }
    await this.paperclipClient.listAgents({ force: true });
    this.paperclipStopLiveEvents = this.paperclipClient.subscribeLiveEvents({
      onOpen: () => {
        this.log("info", "paperclip live events connected");
      },
      onClose: () => {
        this.log("warn", "paperclip live events disconnected");
      },
      onError: (err) => {
        this.log("warn", `paperclip live events error: ${String(err)}`);
      },
      onEvent: async (event) => {
        await this.handlePaperclipLiveEvent(event);
      },
    });
  }

  shouldDropMismatchedEvent(body) {
    if (!body || typeof body !== "object") {
      return false;
    }

    const apiAppId = String(body.api_app_id || "").trim().toUpperCase();
    if (this.expectedAppId && apiAppId && apiAppId !== this.expectedAppId) {
      this.log("warn", `drop event from mismatched app_id ${apiAppId}`);
      return true;
    }

    const teamId =
      String(body.team_id || "").trim() ||
      String(body.team?.id || "").trim() ||
      String(body.authorizations?.[0]?.team_id || "").trim();
    if (this.teamId && teamId && teamId !== this.teamId) {
      this.log("warn", `drop event from mismatched team ${teamId}`);
      return true;
    }

    return false;
  }

  markSeen(channelId, ts) {
    if (!channelId || !ts) {
      return false;
    }
    const key = `${channelId}:${ts}`;
    const now = Date.now();

    for (const [messageKey, expiry] of this.seen.entries()) {
      if (expiry <= now) {
        this.seen.delete(messageKey);
      }
    }

    if (this.seen.has(key)) {
      return true;
    }
    this.seen.set(key, now + 10 * 60 * 1000);
    return false;
  }

  async resolveUserInfo(userId) {
    if (!userId) {
      return { name: "unknown" };
    }
    const cached = this.userCache.get(userId);
    if (cached) {
      return cached;
    }
    try {
      const resp = await this.app.client.users.info({ user: userId });
      const info = {
        name:
          resp.user?.profile?.display_name || resp.user?.real_name || resp.user?.name || userId,
      };
      this.userCache.set(userId, info);
      return info;
    } catch {
      const fallback = { name: userId };
      this.userCache.set(userId, fallback);
      return fallback;
    }
  }

  async resolveChannelInfo(channelId) {
    if (!channelId) {
      return {};
    }
    const cached = this.channelCache.get(channelId);
    if (cached) {
      return cached;
    }

    try {
      const resp = await this.app.client.conversations.info({ channel: channelId });
      const info = {
        id: channelId,
        name: resp.channel?.name || "",
        type: resp.channel?.is_im
          ? "im"
          : resp.channel?.is_mpim
            ? "mpim"
            : resp.channel?.is_private
              ? "group"
              : "channel",
        topic: resp.channel?.topic?.value || "",
        purpose: resp.channel?.purpose?.value || "",
      };
      this.channelCache.set(channelId, info);
      return info;
    } catch {
      const fallback = { id: channelId };
      this.channelCache.set(channelId, fallback);
      return fallback;
    }
  }

  resolveChannelConfig(channelId, channelName) {
    const channels = this.config.slack.channels || {};
    if (channels[channelId]) {
      return channels[channelId];
    }
    if (channelName && channels[channelName]) {
      return channels[channelName];
    }
    if (channelName && channels[`#${channelName}`]) {
      return channels[`#${channelName}`];
    }
    return null;
  }

  isChannelAllowed(params) {
    const channelType = params.channelType;
    const channelId = params.channelId;
    const channelName = params.channelName;

    if (channelType === "im") {
      return this.config.slack.dm.enabled;
    }

    if (channelType === "mpim") {
      if (!this.config.slack.dm.groupEnabled) {
        return false;
      }
      const allowed = this.config.slack.dm.groupChannels || [];
      if (allowed.length === 0) {
        return true;
      }
      return allowed.some((entry) => {
        const v = String(entry || "").trim().toLowerCase();
        return v === normalizeId(channelId) || (channelName && v === channelName.toLowerCase());
      });
    }

    if (this.config.slack.groupPolicy === "disabled") {
      return false;
    }

    if (this.config.slack.groupPolicy === "open") {
      return true;
    }

    const allowlist = (this.config.slack.channelAllowlist || []).map((entry) =>
      String(entry || "")
        .trim()
        .toLowerCase(),
    );

    if (allowlist.length === 0) {
      return false;
    }

    const candidates = [normalizeId(channelId)];
    if (channelName) {
      candidates.push(channelName.toLowerCase(), `#${channelName.toLowerCase()}`);
    }

    return candidates.some((candidate) => allowlist.includes(candidate));
  }

  async authorizeDirectMessage(event, senderName) {
    const policy = this.config.slack.dm.policy;
    const senderId = event.user;

    if (!this.config.slack.dm.enabled || policy === "disabled") {
      return false;
    }

    if (!senderId) {
      return false;
    }

    const allowFrom = (this.config.slack.dm.allowFrom || []).map((entry) =>
      String(entry || "")
        .trim()
        .toLowerCase(),
    );

    const matchedAllowlist = resolveAllowListMatch({
      allowList: allowFrom,
      id: senderId,
      name: senderName,
      allowNameMatching: this.config.slack.dangerouslyAllowNameMatching,
    });

    if (policy === "open") {
      return true;
    }

    if (policy === "allowlist") {
      return matchedAllowlist;
    }

    if (policy !== "pairing") {
      return false;
    }

    if (matchedAllowlist || this.pairingStore.isApproved(senderId)) {
      return true;
    }

    const challenge = this.pairingStore.upsertChallenge(senderId, {
      name: senderName,
    });

    try {
      await this.app.client.chat.postMessage({
        channel: event.channel,
        text:
          "Slack DM pairing required.\n" +
          `Code: ${challenge.code}\n` +
          "Approve it locally with:\n" +
          "`npm run pairing:approve -- <code>`",
      });
    } catch (err) {
      this.log("warn", `failed to send pairing challenge: ${String(err)}`);
    }

    return false;
  }

  shouldRequireMention(channelType, channelConfig) {
    if (channelType !== "channel" && channelType !== "group") {
      return false;
    }
    if (channelConfig && typeof channelConfig.requireMention === "boolean") {
      return channelConfig.requireMention;
    }
    return this.config.slack.defaultRequireMention;
  }

  wasMentioned(event, options) {
    if (options?.forcedMention) {
      return true;
    }
    const text = String(event.text || "");
    const explicit = this.botUserId ? text.includes(`<@${this.botUserId}>`) : false;
    if (explicit) {
      return true;
    }
    if (this.mentionRegexes.some((regex) => regex.test(text))) {
      return true;
    }

    if (event.thread_ts) {
      const threadKey = `${event.channel}:${event.thread_ts}`;
      if (event.parent_user_id && event.parent_user_id === this.botUserId) {
        return true;
      }
      if (this.threadParticipation.has(threadKey)) {
        return true;
      }
    }

    return false;
  }

  resolveChatType(channelType) {
    if (channelType === "im") {
      return "direct";
    }
    if (channelType === "mpim") {
      return "group";
    }
    return "channel";
  }

  resolveSessionQueueKey(event, channelType) {
    const chatType = this.resolveChatType(channelType);
    if (chatType === "direct") {
      return `dm:${event.user || event.channel}`;
    }

    let key = `channel:${event.channel}`;
    const replyMode = resolveReplyToMode(this.config, chatType);
    const isThreadReply = Boolean(
      event.thread_ts && (event.thread_ts !== event.ts || Boolean(event.parent_user_id)),
    );

    let threadId = "";
    if (channelType === "channel" || channelType === "group" || channelType === "mpim") {
      threadId = isThreadReply ? event.thread_ts : replyMode === "all" ? event.ts : "";
    }

    if (threadId) {
      key += `:thread:${threadId}`;
    }

    return key;
  }

  async resolveAttachmentContext(event) {
    const files = Array.isArray(event.files) ? event.files.slice(0, MAX_ATTACHMENT_FILES) : [];
    if (files.length === 0) {
      return {
        summary: "",
        snippets: [],
      };
    }

    const maxBytes = this.config.slack.mediaMaxMb * 1024 * 1024;
    const snippets = [];
    const summaryLines = [];

    for (const file of files) {
      const name = file?.name || file?.id || "file";
      const mime = file?.mimetype || "unknown";
      const size = Number(file?.size || 0);
      summaryLines.push(`- ${name} (${mime}, ${size || "unknown"} bytes)`);

      if (!isTextMime(mime)) {
        continue;
      }
      if (size > 0 && size > maxBytes) {
        continue;
      }

      const downloadUrl = file?.url_private_download || file?.url_private;
      if (!downloadUrl) {
        continue;
      }

      try {
        const resp = await fetch(downloadUrl, {
          headers: {
            Authorization: `Bearer ${this.config.slack.botToken}`,
          },
        });
        if (!resp.ok) {
          continue;
        }

        const body = await resp.text();
        const trimmed = body.trim();
        if (!trimmed) {
          continue;
        }
        snippets.push({
          name,
          mime,
          text:
            trimmed.length <= MAX_ATTACHMENT_SNIPPET_CHARS
              ? trimmed
              : `${trimmed.slice(0, MAX_ATTACHMENT_SNIPPET_CHARS)}...`,
        });
      } catch {
        // ignore attachment download errors
      }
    }

    return {
      summary: summaryLines.join("\n"),
      snippets,
    };
  }

  async fetchHistory(event, channelType) {
    const limit = this.config.slack.thread.initialHistoryLimit;
    if (!limit || limit <= 0) {
      return [];
    }

    const historyScope = this.config.slack.thread.historyScope;

    try {
      let messages = [];
      if (historyScope === "thread" && event.thread_ts) {
        const replies = await this.app.client.conversations.replies({
          channel: event.channel,
          ts: event.thread_ts,
          limit: Math.min(limit + 1, 100),
        });
        messages = replies.messages || [];
      } else if (historyScope === "thread" && event.ts && (channelType === "channel" || channelType === "group")) {
        const replies = await this.app.client.conversations.replies({
          channel: event.channel,
          ts: event.ts,
          limit: Math.min(limit + 1, 100),
        });
        messages = replies.messages || [];
      } else {
        const history = await this.app.client.conversations.history({
          channel: event.channel,
          limit: Math.min(limit + 1, 100),
        });
        messages = history.messages || [];
      }

      const filtered = messages
        .filter((msg) => msg.ts !== event.ts)
        .slice(-MAX_CONTEXT_HISTORY_LINES)
        .map((msg) => ({
          ts: msg.ts,
          user: msg.user || msg.bot_id || "unknown",
          text: String(msg.text || "").trim(),
        }))
        .filter((msg) => msg.text);

      const resolved = [];
      for (const msg of filtered) {
        const info = await this.resolveUserInfo(msg.user);
        resolved.push(`[${msg.ts}] ${info.name || msg.user}: ${msg.text}`);
      }
      return resolved;
    } catch (err) {
      this.log("debug", `history fetch skipped: ${String(err)}`);
      return [];
    }
  }

  buildPromptContext(params) {
    const parts = [];

    parts.push(`chat_type=${params.chatType}`);
    parts.push(`channel_id=${params.event.channel}`);
    parts.push(`sender_id=${params.senderId}`);
    parts.push(`sender_name=${params.senderName}`);

    if (params.channelName) {
      parts.push(`channel_name=${params.channelName}`);
    }
    if (params.event.thread_ts) {
      parts.push(`incoming_thread_ts=${params.event.thread_ts}`);
    }
    if (params.event.ts) {
      parts.push(`message_ts=${params.event.ts}`);
    }

    if (params.channelTopic) {
      parts.push(`channel_topic_untrusted=${params.channelTopic}`);
    }
    if (params.channelPurpose) {
      parts.push(`channel_purpose_untrusted=${params.channelPurpose}`);
    }

    if (params.historyLines.length > 0) {
      parts.push("recent_history:");
      parts.push(params.historyLines.join("\n"));
    }

    if (params.attachments.summary) {
      parts.push("attachments:");
      parts.push(params.attachments.summary);
    }

    if (params.attachments.snippets.length > 0) {
      for (const snippet of params.attachments.snippets) {
        parts.push(`attachment_text:${snippet.name} (${snippet.mime})`);
        parts.push(snippet.text);
      }
    }

    return parts.join("\n");
  }

  async addAckReaction(event) {
    const reaction = String(this.config.slack.ackReaction || "").trim().replace(/^:+|:+$/g, "");
    if (!reaction || !event?.ts) {
      return null;
    }
    try {
      await this.app.client.reactions.add({
        channel: event.channel,
        timestamp: event.ts,
        name: reaction,
      });
      return reaction;
    } catch {
      return null;
    }
  }

  async removeAckReaction(event, reactionName) {
    if (!reactionName || !event?.ts) {
      return;
    }
    try {
      await this.app.client.reactions.remove({
        channel: event.channel,
        timestamp: event.ts,
        name: reactionName,
      });
    } catch {
      // ignore
    }
  }

  async setSlackThreadStatus({ channelId, threadTs, status }) {
    if (!threadTs) {
      return;
    }
    const payload = {
      token: this.config.slack.botToken,
      channel_id: channelId,
      thread_ts: threadTs,
      status,
    };

    const client = this.app.client;
    try {
      if (client?.assistant?.threads?.setStatus) {
        await client.assistant.threads.setStatus(payload);
        return;
      }
      if (typeof client?.apiCall === "function") {
        await client.apiCall("assistant.threads.setStatus", payload);
      }
    } catch (err) {
      this.log("debug", `slack status update failed for channel ${channelId}: ${String(err)}`);
    }
  }

  createTypingController({ channelId, threadTs, chatType }) {
    if (!threadTs) {
      if (!this.warnedTypingWithoutThread && (chatType === "channel" || chatType === "group")) {
        this.warnedTypingWithoutThread = true;
        this.log(
          "warn",
          "typing status skipped for channel message: no thread target. Set SLACK_REPLY_TO_MODE_CHANNEL=all (or first).",
        );
      }
      return {
        start: async () => {},
        stop: async () => {},
      };
    }

    let intervalId;
    let ttlId;
    let stopped = false;
    let statusSent = false;
    let consecutiveFailures = 0;

    const setTypingStatus = async () => {
      await this.setSlackThreadStatus({
        channelId,
        threadTs,
        status: "is typing...",
      });
      statusSent = true;
    };

    const clearTimers = () => {
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = undefined;
      }
      if (ttlId) {
        clearTimeout(ttlId);
        ttlId = undefined;
      }
    };

    const start = async () => {
      if (stopped) {
        return;
      }
      try {
        await setTypingStatus();
        consecutiveFailures = 0;
      } catch (err) {
        this.log("debug", `typing start failed: ${String(err)}`);
      }

      intervalId = setInterval(async () => {
        if (stopped) {
          return;
        }
        try {
          await setTypingStatus();
          consecutiveFailures = 0;
        } catch (err) {
          consecutiveFailures += 1;
          this.log("debug", `typing keepalive failed: ${String(err)}`);
          if (consecutiveFailures >= SLACK_TYPING_MAX_FAILURES) {
            clearTimers();
          }
        }
      }, SLACK_TYPING_KEEPALIVE_MS);

      ttlId = setTimeout(() => {
        if (stopped) {
          return;
        }
        this.log(
          "debug",
          `typing indicator TTL exceeded for ${channelId}/${threadTs}; stopping keepalive`,
        );
        clearTimers();
      }, SLACK_TYPING_MAX_DURATION_MS);
    };

    const stop = async () => {
      if (stopped) {
        return;
      }
      stopped = true;
      clearTimers();
      if (!statusSent) {
        return;
      }
      await this.setSlackThreadStatus({
        channelId,
        threadTs,
        status: "",
      });
    };

    return { start, stop };
  }

  resolveReplyThreadTs(event, chatType, tags) {
    const mode = resolveReplyToMode(this.config, chatType);
    const isThreadReply = Boolean(
      event.thread_ts && (event.thread_ts !== event.ts || Boolean(event.parent_user_id)),
    );

    if (mode !== "off" && tags.explicitReplyTs) {
      return tags.explicitReplyTs;
    }

    if (isThreadReply) {
      return event.thread_ts;
    }

    if (mode === "all") {
      return event.ts;
    }

    if (mode === "first") {
      return event.ts;
    }

    if (mode !== "off" && tags.replyToCurrent) {
      return event.thread_ts || event.ts;
    }

    return undefined;
  }

  async sendWithStreaming({ channel, threadTs, text }) {
    const chunks = chunkText(
      text,
      Math.max(200, this.config.slack.textChunkLimit),
      this.config.slack.chunkMode,
    );

    if (chunks.length === 0) {
      return null;
    }

    const mode = this.config.slack.streaming;
    const useNative =
      this.config.slack.nativeStreaming &&
      mode === "partial" &&
      threadTs &&
      typeof this.app.client.chatStream === "function";

    if (useNative) {
      try {
        const stream = this.app.client.chatStream({
          channel,
          thread_ts: threadTs,
          ...(this.teamId ? { recipient_team_id: this.teamId } : {}),
        });

        for (const chunk of chunks) {
          await stream.append({ markdown_text: chunk });
        }
        await stream.stop();
        return { mode: "native-stream" };
      } catch (err) {
        this.log("warn", `native stream failed, falling back: ${String(err)}`);
      }
    }

    if (mode === "progress") {
      const status = await this.app.client.chat.postMessage({
        channel,
        thread_ts: threadTs,
        text: "Status: thinking...",
      });

      const [first, ...rest] = chunks;
      await this.app.client.chat.update({
        channel,
        ts: status.ts,
        text: first,
      });

      for (const chunk of rest) {
        await this.app.client.chat.postMessage({
          channel,
          thread_ts: threadTs,
          text: chunk,
        });
      }
      return { mode: "progress", ts: status.ts };
    }

    if (mode === "block") {
      let rendered = "";
      let ts = "";
      for (const chunk of chunks) {
        rendered = rendered ? `${rendered}\n${chunk}` : chunk;
        if (!ts) {
          const posted = await this.app.client.chat.postMessage({
            channel,
            thread_ts: threadTs,
            text: rendered,
          });
          ts = posted.ts;
        } else {
          await this.app.client.chat.update({
            channel,
            ts,
            text: rendered,
          });
        }
      }
      return { mode: "block", ts };
    }

    for (const chunk of chunks) {
      await this.app.client.chat.postMessage({
        channel,
        thread_ts: threadTs,
        text: chunk,
      });
    }
    return { mode: "post" };
  }

  async normalizeInboundMessageEvent(event) {
    if (!event || event.type !== "message") {
      return event;
    }

    if (event.subtype !== "message_replied") {
      return event;
    }

    const channel = String(event.channel || "").trim();
    const parent = event.message && typeof event.message === "object" ? event.message : null;
    const threadTs = String(parent?.thread_ts || parent?.ts || "").trim();
    const latestReplyTs = String(
      parent?.latest_reply ||
        parent?.replies?.[parent?.replies?.length - 1]?.ts ||
        "",
    ).trim();

    if (!channel || !threadTs || !latestReplyTs) {
      this.log("debug", "drop: message_replied payload missing channel/thread/latest_reply");
      return null;
    }

    try {
      const replies = await this.app.client.conversations.replies({
        channel,
        ts: threadTs,
        oldest: latestReplyTs,
        latest: latestReplyTs,
        inclusive: true,
        limit: 3,
      });
      const all = Array.isArray(replies.messages) ? replies.messages : [];
      const resolved =
        all.find((msg) => msg?.ts === latestReplyTs && msg?.ts !== threadTs) ||
        all.find((msg) => msg?.ts && msg.ts !== threadTs);

      if (!resolved) {
        this.log("debug", `drop: message_replied could not resolve latest reply ts=${latestReplyTs}`);
        return null;
      }

      return {
        ...resolved,
        type: "message",
        channel,
        channel_type: event.channel_type,
        parent_user_id:
          resolved.parent_user_id || parent?.user || parent?.parent_user_id || "",
      };
    } catch (err) {
      this.log("debug", `drop: failed to resolve message_replied payload: ${String(err)}`);
      return null;
    }
  }

  async maybeHandlePaperclipMessage(params) {
    const { event, options, channelType, senderId, senderName, channelInfo } = params;
    if (!this.isPaperclipEnabled()) {
      return false;
    }
    const mappedThread = this.getMappedPaperclipThread(event);
    const creationThreadTs = event.thread_ts || event.ts;
    const replyThreadTs = mappedThread?.threadTs || event.thread_ts || event.ts;

    try {
      const handledCommentLookup = await this.maybeHandlePaperclipCommentRequest({
        event,
        mappedThread,
      });
      if (handledCommentLookup) {
        return true;
      }

      const handledSummary = await this.maybeHandlePaperclipSummaryRequest({
        event,
        mappedThread,
      });
      if (handledSummary) {
        return true;
      }

      if (mappedThread) {
        const hasTrigger = hasPaperclipTrigger({
          text: event.text || "",
          botUserId: this.botUserId,
          triggerMentions: this.config.paperclip.triggerMentions,
        });
        if (!hasTrigger) {
          this.log("debug", `paperclip bypass: mapped thread without trigger ${event.channel}:${event.thread_ts}`);
          return false;
        }

        const nestedTaskRequest = detectTaskRequest({
          text: event.text || "",
          taskPrefix: this.config.paperclip.taskPrefix,
          triggerMentions: this.config.paperclip.triggerMentions,
        });
        if (nestedTaskRequest?.title) {
          await this.postPaperclipThreadReply(
            mappedThread.channelId,
            mappedThread.threadTs,
            `This Slack thread is already linked to ${mappedThread.issueIdentifier}. Start a new Slack thread to create another Paperclip issue.`,
          );
          return true;
        }

        const commentBody = stripBotMention(
          event.text || "",
          this.botUserId,
          this.config.paperclip.triggerMentions,
        );
        if (!commentBody) {
          if (!Array.isArray(event.files) || event.files.length === 0) {
            await this.postPaperclipThreadReply(
              mappedThread.channelId,
              mappedThread.threadTs,
              `Mention me with text to sync a comment to ${mappedThread.issueIdentifier}.`,
            );
          }
          return true;
        }

        await this.paperclipClient.addIssueComment(mappedThread.issueId, commentBody);
        const fingerprint = fingerprintIssueComment(commentBody);
        if (fingerprint) {
          this.paperclipThreadStore.rememberSlackFingerprint(mappedThread.issueId, fingerprint);
        }
        this.log("debug", `paperclip comment synced issue=${mappedThread.issueId} thread=${mappedThread.threadTs}`);
        return true;
      }

      if (channelType !== "channel" && channelType !== "group" && channelType !== "im") {
        return false;
      }
      if (isThreadReplyMessage(event) && channelType !== "im") {
        return false;
      }

      const hasCreationTrigger = hasPaperclipTrigger({
        text: event.text || "",
        botUserId: this.botUserId,
        triggerMentions: this.config.paperclip.triggerMentions,
      });
      if (!hasCreationTrigger) {
        return false;
      }

      const taskRequest = detectTaskRequest({
        text: event.text || "",
        taskPrefix: this.config.paperclip.taskPrefix,
        triggerMentions: this.config.paperclip.triggerMentions,
      });
      if (!taskRequest) {
        return false;
      }

      if (!taskRequest.title) {
        await this.postPaperclipThreadReply(
          event.channel,
          creationThreadTs,
          `Task creation needs text after \`${this.config.paperclip.taskPrefix}\`.`,
        );
        return true;
      }

      const agents = await this.paperclipClient.listAgents();
      const assignee = resolveAssignee({
        text: event.text || "",
        agentMappings: this.config.paperclip.agentMappings,
        agents,
      });

      if (assignee.kind !== "match") {
        let message = "I could not resolve a Paperclip assignee. Mention the agent's Slack alias such as `@qa`, or use the agent's exact Paperclip name.";
        if (assignee.kind === "ambiguous" && Array.isArray(assignee.candidates) && assignee.candidates.length > 0) {
          const names = assignee.candidates
            .map((agent) => `${agent.name} (${formatAgentAliasLabel(agent)})`)
            .filter(Boolean)
            .join(", ");
          if (names) {
            message = `I found multiple possible assignees: ${names}. Mention exactly one canonical alias or one exact Paperclip agent name.`;
          }
        }
        await this.postPaperclipThreadReply(event.channel, creationThreadTs, message);
        return true;
      }

      const projectSelectors = extractProjectSelectors(event.text || "");
      let project = {
        kind: "none",
        reason: "no_project_selector",
      };
      if (projectSelectors.length > 0) {
        const projects = await this.paperclipClient.listProjects();
        project = resolveProject({
          text: event.text || "",
          projectMappings: this.config.paperclip.projectMappings,
          projects,
        });

        if (project.kind !== "match") {
          let message =
            "I could not resolve a Paperclip project. Use `project: <project alias>` or an exact Paperclip project name.";
          if (
            project.kind === "ambiguous" &&
            Array.isArray(project.candidates) &&
            project.candidates.length > 0
          ) {
            const names = project.candidates
              .map((entry) => `${entry.name} (${formatProjectAliasLabel(entry)})`)
              .filter(Boolean)
              .join(", ");
            if (names) {
              message = `I found multiple possible projects: ${names}. Use one canonical project alias or one exact project name.`;
            }
          }
          await this.postPaperclipThreadReply(event.channel, creationThreadTs, message);
          return true;
        }
      }

      const issue = await this.paperclipClient.createIssue({
        title: taskRequest.title,
        description: buildIssueDescription({
          text: event.text || "",
          senderName,
          senderId,
          channelId: event.channel,
          channelName: channelInfo.name,
          threadTs: creationThreadTs,
          messageTs: event.ts,
        }),
        status: "todo",
        priority: "medium",
        assigneeAgentId: assignee.agent.id,
        ...(project.kind === "match" ? { projectId: project.project.id } : {}),
      });

      this.paperclipThreadStore.putMapping({
        channelId: event.channel,
        threadTs: creationThreadTs,
        companyId: this.config.paperclip.companyId,
        issueId: issue.id,
        issueIdentifier: issue.identifier,
        issueTitle: issue.title,
        assigneeAgentId: assignee.agent.id,
        assigneeName: assignee.agent.name,
        projectId: project.kind === "match" ? project.project.id : null,
        projectName: project.kind === "match" ? project.project.name : "",
        sourceMessageTs: event.ts,
      });

      const projectSuffix = project.kind === "match" ? ` in ${project.project.name}` : "";
      await this.postPaperclipThreadReply(
        event.channel,
        creationThreadTs,
        `Created Paperclip issue ${issue.identifier}${projectSuffix} and assigned it to ${assignee.agent.name}.`,
      );
      this.log("info", `paperclip issue created issue=${issue.id} thread=${event.channel}:${creationThreadTs}`);
      return true;
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      this.log("error", `paperclip bridge failed: ${reason}`);
      await this.postPaperclipThreadReply(event.channel, replyThreadTs, `Paperclip action failed: ${reason}`);
      return true;
    }
  }

  async handleCodexMessage(event, options = {}) {
    const normalized = await this.normalizeInboundMessageEvent(event);
    if (!normalized) {
      return;
    }
    event = normalized;

    this.log("debug", `[event] ${formatEventSummary(event)}`);

    if (!event || event.type !== "message") {
      this.log("debug", "drop: not a message event");
      return;
    }
    if (!event.channel || (!event.user && !event.bot_id)) {
      this.log("debug", "drop: missing channel or sender id");
      return;
    }
    if (isSkippableSubtype(event)) {
      this.log("debug", `drop: skippable subtype=${event.subtype || "unknown"}`);
      return;
    }
    if (this.markSeen(event.channel, event.ts)) {
      this.log("debug", `drop: duplicate event ${event.channel}:${event.ts}`);
      return;
    }

    if (event.user && this.botUserId && event.user === this.botUserId) {
      this.log("debug", "drop: self message");
      return;
    }

    const channelInfo = await this.resolveChannelInfo(event.channel);
    const channelType = normalizeChannelType(event.channel_type || channelInfo.type, event.channel);
    const chatType = this.resolveChatType(channelType);
    const senderId = event.user || event.bot_id || "unknown";
    const senderInfo = await this.resolveUserInfo(senderId);
    const senderName = senderInfo.name || senderId;

    const channelConfig = this.resolveChannelConfig(event.channel, channelInfo.name);
    const allowBots =
      channelConfig?.allowBots ?? this.config.slack.allowBots ?? false;
    if (event.bot_id && !allowBots) {
      this.log("debug", "drop: bot message and allowBots=false");
      return;
    }

    if (!this.isChannelAllowed({
      channelId: event.channel,
      channelName: channelInfo.name,
      channelType,
    })) {
      this.log(
        "debug",
        `drop: channel blocked by policy type=${channelType} id=${event.channel} name=${channelInfo.name || ""}`,
      );
      return;
    }

    if (channelType === "im") {
      const authorized = await this.authorizeDirectMessage(event, senderName);
      if (!authorized) {
        this.log("debug", `drop: DM authorization failed policy=${this.config.slack.dm.policy}`);
        return;
      }
    }

    if (channelType === "channel" || channelType === "group") {
      const usersAllowlist = Array.isArray(channelConfig?.users)
        ? channelConfig.users
        : [];
      if (usersAllowlist.length > 0) {
        const allowed = resolveAllowListMatch({
          allowList: usersAllowlist,
          id: senderId,
          name: senderName,
          allowNameMatching: this.config.slack.dangerouslyAllowNameMatching,
        });
        if (!allowed) {
          this.log("debug", "drop: sender not in channel users allowlist");
          return;
        }
      }
    }

    if (channelType === "channel" || channelType === "group" || channelType === "im") {
      this.rememberPaperclipPreferredChannel({
        channelId: event.channel,
        channelType,
        event,
        options,
      });
      const handledByPaperclip = await this.maybeHandlePaperclipMessage({
        event,
        options,
        channelType,
        senderId,
        senderName,
        channelInfo,
      });
      if (handledByPaperclip) {
        return;
      }
    }

    if (channelType === "channel" || channelType === "group") {
      const requireMention = this.shouldRequireMention(channelType, channelConfig);
      if (requireMention && !this.wasMentioned(event, options)) {
        this.log("debug", "drop: mention required but message has no matching mention");
        return;
      }
    }

    const cleanedText = cleanSlackText(event.text || "");
    const hasFiles = Array.isArray(event.files) && event.files.length > 0;
    if (!cleanedText && !hasFiles) {
      this.log("debug", "drop: empty message body and no files");
      return;
    }

    const replyToMode = resolveReplyToMode(this.config, chatType);
    const threadTargets = resolveSlackThreadTargets({
      message: event,
      replyToMode,
    });
    const typing = this.createTypingController({
      channelId: event.channel,
      threadTs: threadTargets.statusThreadTs,
      chatType,
    });

    const ack = await this.addAckReaction(event);
    await typing.start();

    try {
      const attachments = await this.resolveAttachmentContext(event);
      const historyLines = await this.fetchHistory(event, channelType);
      const promptContext = this.buildPromptContext({
        event,
        chatType,
        senderId,
        senderName,
        channelName: channelInfo.name,
        channelTopic: channelInfo.topic,
        channelPurpose: channelInfo.purpose,
        historyLines,
        attachments,
      });

      const queueKey = this.resolveSessionQueueKey(event, channelType);
      this.log("debug", `processing: queueKey=${queueKey} sender=${senderId} chatType=${chatType}`);
      const codexReply = await this.codex.request(
        {
          userText: cleanedText || "[Message contains attachments only]",
          context: promptContext,
        },
        queueKey,
      );

      const tags = parseReplyTag(codexReply);
      const replyText = tags.cleaned || codexReply;
      const replyThreadTs = this.resolveReplyThreadTs(event, chatType, tags);

      await this.sendWithStreaming({
        channel: event.channel,
        threadTs: replyThreadTs,
        text: replyText,
      });
      this.log(
        "debug",
        `reply sent: channel=${event.channel} thread=${replyThreadTs || "none"} mode=${this.config.slack.streaming}`,
      );

      if (replyThreadTs) {
        this.threadParticipation.set(`${event.channel}:${replyThreadTs}`, Date.now());
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      this.log("error", `message handling failed: ${reason}`);
      await this.app.client.chat.postMessage({
        channel: event.channel,
        thread_ts: event.thread_ts || event.ts,
        text: `Codex request failed: ${reason}`,
      });
    } finally {
      await typing.stop();
      if (ack && this.config.slack.removeAckAfterReply) {
        await this.removeAckReaction(event, ack);
      }
    }
  }

  enqueueDebounced(event, options = {}) {
    const debounceMs = this.config.slack.inboundDebounceMs;
    const canDebounce =
      debounceMs > 0 &&
      !event.files?.length &&
      Boolean(event.text?.trim()) &&
      !String(event.text || "").trim().startsWith("/");

    if (!canDebounce) {
      void this.handleCodexMessage(event, options);
      return;
    }

    const sender = event.user || event.bot_id || "unknown";
    const threadPart = event.thread_ts || event.ts || "root";
    const key = `${event.channel}:${threadPart}:${sender}`;
    const existing = this.debounce.get(key);

    if (existing) {
      clearTimeout(existing.timer);
      existing.items.push({ event, options });
      existing.timer = setTimeout(() => this.flushDebounced(key), debounceMs);
      return;
    }

    const timer = setTimeout(() => this.flushDebounced(key), debounceMs);
    this.debounce.set(key, {
      items: [{ event, options }],
      timer,
    });
  }

  async flushDebounced(key) {
    const entry = this.debounce.get(key);
    if (!entry) {
      return;
    }
    this.debounce.delete(key);

    const last = entry.items[entry.items.length - 1];
    if (!last) {
      return;
    }

    if (entry.items.length === 1) {
      await this.handleCodexMessage(last.event, last.options);
      return;
    }

    const combined = {
      ...last.event,
      text: entry.items
        .map((item) => String(item.event.text || "").trim())
        .filter(Boolean)
        .join("\n"),
    };

    const forcedMention = entry.items.some((item) => Boolean(item.options?.forcedMention));
    await this.handleCodexMessage(combined, {
      ...last.options,
      forcedMention,
    });
  }

  registerMessageEvents() {
    const handle = async ({ event, body }, opts = {}) => {
      if (this.shouldDropMismatchedEvent(body)) {
        return;
      }
      this.enqueueDebounced(event, opts);
    };

    this.app.event("message", async (args) => {
      await handle(args);
    });
    this.app.event("app_mention", async ({ event, body }) => {
      if (this.shouldDropMismatchedEvent(body)) {
        return;
      }
      await this.handleCodexMessage(event, { forcedMention: true });
    });
  }

  registerSystemEvents() {
    this.app.event("reaction_added", async ({ event, body }) => {
      if (this.shouldDropMismatchedEvent(body)) {
        return;
      }
      this.log("info", "reaction_added", {
        channel: event.item?.channel,
        ts: event.item?.ts,
        reaction: event.reaction,
        user: event.user,
      });
    });

    this.app.event("reaction_removed", async ({ event, body }) => {
      if (this.shouldDropMismatchedEvent(body)) {
        return;
      }
      this.log("info", "reaction_removed", {
        channel: event.item?.channel,
        ts: event.item?.ts,
        reaction: event.reaction,
        user: event.user,
      });
    });

    this.app.event("member_joined_channel", async ({ event, body }) => {
      if (this.shouldDropMismatchedEvent(body)) {
        return;
      }
      this.log("info", "member_joined_channel", {
        channel: event.channel,
        user: event.user,
      });
    });

    this.app.event("member_left_channel", async ({ event, body }) => {
      if (this.shouldDropMismatchedEvent(body)) {
        return;
      }
      this.log("info", "member_left_channel", {
        channel: event.channel,
        user: event.user,
      });
    });

    this.app.event("channel_created", async ({ event, body }) => {
      if (this.shouldDropMismatchedEvent(body)) {
        return;
      }
      this.log("info", "channel_created", {
        channel: event.channel?.id,
        name: event.channel?.name,
      });
    });

    this.app.event("channel_rename", async ({ event, body }) => {
      if (this.shouldDropMismatchedEvent(body)) {
        return;
      }
      this.log("info", "channel_rename", {
        channel: event.channel?.id,
        name: event.channel?.name,
      });
    });

    this.app.event("channel_id_changed", async ({ event, body }) => {
      if (this.shouldDropMismatchedEvent(body)) {
        return;
      }

      this.log("info", "channel_id_changed", {
        oldChannelId: event.old_channel_id,
        newChannelId: event.new_channel_id,
      });

      if (!this.config.slack.configWrites) {
        return;
      }

      const channels = this.config.slack.channels || {};
      const oldKey = event.old_channel_id;
      const newKey = event.new_channel_id;
      if (!oldKey || !newKey || !channels[oldKey] || channels[newKey]) {
        return;
      }

      channels[newKey] = channels[oldKey];
      delete channels[oldKey];

      const currentConfig = JSON.parse(JSON.stringify(this.config));
      currentConfig.slack.channels = channels;
      const payload = JSON.stringify(currentConfig, null, 2) + "\n";
      fs.writeFileSync(this.configPath, payload, "utf8");
      this.log("warn", `migrated channel config ${oldKey} -> ${newKey}`);
    });

    this.app.event("pin_added", async ({ event, body }) => {
      if (this.shouldDropMismatchedEvent(body)) {
        return;
      }
      this.log("info", "pin_added", {
        channel: event.channel_id,
        user: event.user,
      });
    });

    this.app.event("pin_removed", async ({ event, body }) => {
      if (this.shouldDropMismatchedEvent(body)) {
        return;
      }
      this.log("info", "pin_removed", {
        channel: event.channel_id,
        user: event.user,
      });
    });

    this.app.action(/.*/, async ({ ack, action, body }) => {
      await safeAck(ack);
      if (this.shouldDropMismatchedEvent(body)) {
        return;
      }

      const summary = {
        type: action?.type,
        actionId: action?.action_id,
        user: body?.user?.id,
        channel: body?.channel?.id,
        messageTs: body?.message?.ts,
      };
      this.log("info", "block_action", summary);
    });

    this.app.view(/.*/, async ({ ack, view, body }) => {
      await safeAck(ack);
      if (this.shouldDropMismatchedEvent(body)) {
        return;
      }

      this.log("info", "modal_interaction", {
        callbackId: view?.callback_id,
        user: body?.user?.id,
        team: body?.team?.id,
      });
    });
  }

  registerSlashCommands() {
    const slashEnabled = this.config.slack.slashCommand.enabled || this.config.slack.commands.native;
    if (!slashEnabled) {
      return;
    }

    const slashName = this.config.slack.slashCommand.name.replace(/^\//, "");
    const slashCommand = `/${slashName}`;

    this.app.command(slashCommand, async ({ command, ack, respond, body }) => {
      if (this.shouldDropMismatchedEvent(body)) {
        await safeAck(ack);
        return;
      }

      await safeAck(ack);

      try {
        const rawText = String(command.text || "").trim();
        if (!rawText) {
          await respond({
            response_type: "ephemeral",
            text: `Usage: ${slashCommand} <message or native command>. Try \`${slashCommand} help\``,
          });
          return;
        }

        if (this.config.slack.commands.native) {
          const native = await handleSlackNativeAction({
            text: rawText,
            client: this.app.client,
            channelId: command.channel_id,
            threadTs: undefined,
            userId: command.user_id,
            config: this.config,
            botToken: this.config.slack.botToken,
            dataDir: this.config.runtime.dataDir,
          });
          if (native.handled) {
            await respond({
              response_type: this.config.slack.slashCommand.ephemeral ? "ephemeral" : "in_channel",
              text: native.text,
            });
            return;
          }
        }

        const sender = await this.resolveUserInfo(command.user_id);
        const channelInfo = await this.resolveChannelInfo(command.channel_id);
        const chatType = normalizeChannelType(channelInfo.type, command.channel_id) === "im" ? "direct" : "channel";

        const context = [
          `slash_command=${slashCommand}`,
          `slash_user=${command.user_id}`,
          `slash_user_name=${sender.name || command.user_id}`,
          `slash_channel=${command.channel_id}`,
          `slash_channel_name=${channelInfo.name || ""}`,
          `chat_type=${chatType}`,
        ].join("\n");

        const queueKey = `slash:${command.user_id}:${command.channel_id}`;
        const reply = await this.codex.request(
          {
            userText: rawText,
            context,
          },
          queueKey,
        );

        const chunks = chunkText(
          reply,
          Math.max(200, this.config.slack.textChunkLimit),
          this.config.slack.chunkMode,
        );

        for (const chunk of chunks) {
          await respond({
            response_type: this.config.slack.slashCommand.ephemeral ? "ephemeral" : "in_channel",
            text: chunk,
          });
        }
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        await respond({
          response_type: "ephemeral",
          text: `Slash command failed: ${reason}`,
        });
      }
    });

    if (this.config.slack.commands.native) {
      this.app.command("/agentstatus", async ({ ack, respond }) => {
        await safeAck(ack);
        await respond({
          response_type: "ephemeral",
          text:
            `Slack runtime is online.\n` +
            `- mode: ${this.config.slack.mode}\n` +
            `- botUserId: ${this.botUserId || "unknown"}\n` +
            `- teamId: ${this.teamId || "unknown"}\n` +
            `- appId: ${this.expectedAppId || "unknown"}`,
        });
      });
    }
  }

  async start() {
    await this.codex.ensureReady();

    let auth;
    try {
      auth = await this.app.client.auth.test({ token: this.config.slack.botToken });
    } catch (err) {
      const code = err?.data?.error;
      if (code === "invalid_auth") {
        throw new Error(
          "Slack authentication failed: invalid_auth. Verify SLACK_BOT_TOKEN and reinstall the app in Slack.",
        );
      }
      throw err;
    }

    this.botUserId = auth.user_id || "";
    this.teamId = auth.team_id || "";

    this.app.use(async ({ body, next }) => {
      if (this.config.runtime.logLevel === "debug") {
        const bodyType = String(body?.type || "unknown");
        const eventType = String(body?.event?.type || "none");
        const eventSubtype = String(body?.event?.subtype || "none");
        const channel = String(body?.event?.channel || body?.channel?.id || "none");
        const user = String(body?.event?.user || body?.user?.id || "none");
        this.log(
          "debug",
          `[inbound] bodyType=${bodyType} eventType=${eventType} subtype=${eventSubtype} channel=${channel} user=${user}`,
        );
      }
      await next();
    });

    this.registerMessageEvents();
    this.registerSystemEvents();
    this.registerSlashCommands();

    if (
      this.config.slack.groupPolicy === "allowlist" &&
      (!Array.isArray(this.config.slack.channelAllowlist) ||
        this.config.slack.channelAllowlist.length === 0)
    ) {
      this.log(
        "warn",
        "SLACK_GROUP_POLICY=allowlist with empty SLACK_ALLOWED_CHANNELS blocks all channel messages. Set SLACK_GROUP_POLICY=open or configure channel IDs.",
      );
    }

    this.app.error((err) => {
      const reason = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
      this.log("error", `[bolt] ${reason}`);
    });

    await this.app.start(this.config.slack.port);
    await this.startPaperclipBridge();

    this.log(
      "info",
      `slack-codex-bot started mode=${this.config.slack.mode} port=${this.config.slack.port} botUserId=${this.botUserId || "unknown"} teamId=${this.teamId || "unknown"} appId=${this.expectedAppId || "unknown"} paperclip=${this.isPaperclipEnabled() ? "enabled" : "disabled"}`,
    );
  }
}
