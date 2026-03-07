import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import { loadPaperclipEnvIntoProcess } from "./paperclip-env.js";

dotenv.config();
loadPaperclipEnvIntoProcess({
  keys: [
    "SLACK_BOT_TOKEN",
    "SLACK_APP_TOKEN",
    "SLACK_SIGNING_SECRET",
    "SLACK_APP_ID",
  ],
});

const DEFAULT_CONFIG_FILE = "slack-codex.config.json";

const DEFAULTS = {
  slack: {
    mode: "socket",
    botToken: "",
    appToken: "",
    signingSecret: "",
    appId: "",
    webhookPath: "/slack/events",
    port: 3000,
    dm: {
      enabled: true,
      policy: "pairing",
      allowFrom: [],
      groupEnabled: false,
      groupChannels: [],
    },
    groupPolicy: "allowlist",
    channelAllowlist: [],
    channels: {},
    defaultRequireMention: true,
    mentionPatterns: [],
    dangerouslyAllowNameMatching: false,
    allowBots: false,
    replyToMode: "off",
    replyToModeByChatType: {},
    thread: {
      historyScope: "thread",
      inheritParent: false,
      initialHistoryLimit: 20,
    },
    textChunkLimit: 4000,
    chunkMode: "length",
    mediaMaxMb: 20,
    streaming: "partial",
    nativeStreaming: true,
    ackReaction: "",
    removeAckAfterReply: false,
    commands: {
      native: false,
    },
    slashCommand: {
      enabled: false,
      name: "openclaw",
      ephemeral: true,
    },
    actions: {
      messages: true,
      reactions: true,
      pins: true,
      memberInfo: true,
      emojiList: true,
    },
    configWrites: false,
    inboundDebounceMs: 800,
  },
  codex: {
    model: "",
    profile: "",
    workdir: process.cwd(),
    sandbox: "workspace-write",
    additionalWritableDirs: [],
    timeoutMs: 1800000,
    systemPrompt:
      "You are Codex. Reply concisely, accurately, and with practical software-engineering guidance.",
  },
  paperclip: {
    enabled: false,
    apiUrl: "",
    companyId: "",
    taskPrefix: "task:",
    triggerMentions: ["@paperclip"],
    agentMappings: {},
    projectMappings: {},
    syncReplies: "mention_only",
    notificationMode: "high_signal",
  },
  runtime: {
    logLevel: "info",
    dataDir: "data",
  },
};

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function deepMerge(base, override) {
  if (!override || typeof override !== "object" || Array.isArray(override)) {
    return base;
  }
  const out = Array.isArray(base) ? [...base] : { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (Array.isArray(value)) {
      out[key] = [...value];
      continue;
    }
    if (value && typeof value === "object") {
      const current = out[key];
      if (current && typeof current === "object" && !Array.isArray(current)) {
        out[key] = deepMerge(current, value);
      } else {
        out[key] = deepMerge({}, value);
      }
      continue;
    }
    out[key] = value;
  }
  return out;
}

function parseBool(raw, fallback) {
  if (raw === undefined || raw === null || raw === "") {
    return fallback;
  }
  const normalized = String(raw).trim().toLowerCase();
  if (["1", "true", "yes", "y", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "n", "off"].includes(normalized)) {
    return false;
  }
  return fallback;
}

function parseIntEnv(raw, fallback, min = 0) {
  if (raw === undefined || raw === null || raw === "") {
    return fallback;
  }
  const parsed = Number.parseInt(String(raw).trim(), 10);
  if (!Number.isFinite(parsed) || parsed < min) {
    return fallback;
  }
  return parsed;
}

function parseList(raw) {
  if (raw === undefined || raw === null || raw === "") {
    return [];
  }
  return String(raw)
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function parseJsonMaybe(raw, fallback) {
  if (!raw || !String(raw).trim()) {
    return fallback;
  }
  try {
    return JSON.parse(String(raw));
  } catch {
    return fallback;
  }
}

function readJsonFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  const raw = fs.readFileSync(filePath, "utf8");
  if (!raw.trim()) {
    return null;
  }
  return JSON.parse(raw);
}

function validateSlackToken(name, value, expectedPrefix) {
  if (!value) {
    return;
  }
  const placeholderPattern = /(your-bot-token|your-app-level-token|xoxb-your|xapp-your)/i;
  if (placeholderPattern.test(value)) {
    throw new Error(`${name} is set to example placeholder text`);
  }
  if (expectedPrefix && !value.startsWith(expectedPrefix)) {
    throw new Error(`${name} must start with ${expectedPrefix}`);
  }
}

function parseApiAppIdFromAppToken(raw) {
  if (!raw) {
    return "";
  }
  const token = String(raw).trim();
  const match = /^xapp-\d-([a-z0-9]+)-/i.exec(token);
  return match?.[1]?.toUpperCase() || "";
}

function normalizePolicy(value, allowed, fallback) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (allowed.includes(normalized)) {
    return normalized;
  }
  return fallback;
}

function applyEnvOverrides(config, cwd) {
  const env = process.env;

  const slack = config.slack;
  const codex = config.codex;
  const paperclip = config.paperclip;
  const runtime = config.runtime;

  slack.mode = normalizePolicy(env.SLACK_MODE || slack.mode, ["socket", "http"], slack.mode);
  slack.botToken = (env.SLACK_BOT_TOKEN || slack.botToken || "").trim();
  slack.appToken = (env.SLACK_APP_TOKEN || slack.appToken || "").trim();
  slack.signingSecret = (env.SLACK_SIGNING_SECRET || slack.signingSecret || "").trim();
  slack.appId = (env.SLACK_APP_ID || slack.appId || "").trim().toUpperCase();
  slack.webhookPath = (env.SLACK_WEBHOOK_PATH || slack.webhookPath || "/slack/events").trim();
  slack.port = parseIntEnv(env.SLACK_PORT || env.PORT, slack.port, 1);

  slack.dm.enabled = parseBool(env.SLACK_DM_ENABLED, slack.dm.enabled);
  slack.dm.policy = normalizePolicy(
    env.SLACK_DM_POLICY || slack.dm.policy,
    ["pairing", "allowlist", "open", "disabled"],
    slack.dm.policy,
  );
  if (env.SLACK_ALLOW_FROM) {
    slack.dm.allowFrom = parseList(env.SLACK_ALLOW_FROM);
  }
  slack.dm.groupEnabled = parseBool(env.SLACK_DM_GROUP_ENABLED, slack.dm.groupEnabled);
  if (env.SLACK_DM_GROUP_CHANNELS) {
    slack.dm.groupChannels = parseList(env.SLACK_DM_GROUP_CHANNELS);
  }

  slack.groupPolicy = normalizePolicy(
    env.SLACK_GROUP_POLICY || slack.groupPolicy,
    ["open", "allowlist", "disabled"],
    slack.groupPolicy,
  );

  if (env.SLACK_ALLOWED_CHANNELS) {
    slack.channelAllowlist = parseList(env.SLACK_ALLOWED_CHANNELS);
  }

  slack.defaultRequireMention = parseBool(
    env.SLACK_REQUIRE_MENTION_DEFAULT,
    slack.defaultRequireMention,
  );
  if (env.SLACK_MENTION_PATTERNS) {
    slack.mentionPatterns = parseList(env.SLACK_MENTION_PATTERNS);
  }
  slack.dangerouslyAllowNameMatching = parseBool(
    env.SLACK_DANGEROUS_NAME_MATCHING,
    slack.dangerouslyAllowNameMatching,
  );
  slack.allowBots = parseBool(env.SLACK_ALLOW_BOTS, slack.allowBots);

  slack.replyToMode = normalizePolicy(
    env.SLACK_REPLY_TO_MODE || slack.replyToMode,
    ["off", "first", "all"],
    slack.replyToMode,
  );
  if (env.SLACK_REPLY_TO_MODE_DIRECT) {
    slack.replyToModeByChatType.direct = normalizePolicy(
      env.SLACK_REPLY_TO_MODE_DIRECT,
      ["off", "first", "all"],
      slack.replyToModeByChatType.direct || slack.replyToMode,
    );
  }
  if (env.SLACK_REPLY_TO_MODE_GROUP) {
    slack.replyToModeByChatType.group = normalizePolicy(
      env.SLACK_REPLY_TO_MODE_GROUP,
      ["off", "first", "all"],
      slack.replyToModeByChatType.group || slack.replyToMode,
    );
  }
  if (env.SLACK_REPLY_TO_MODE_CHANNEL) {
    slack.replyToModeByChatType.channel = normalizePolicy(
      env.SLACK_REPLY_TO_MODE_CHANNEL,
      ["off", "first", "all"],
      slack.replyToModeByChatType.channel || slack.replyToMode,
    );
  }

  slack.thread.historyScope = normalizePolicy(
    env.SLACK_THREAD_HISTORY_SCOPE || slack.thread.historyScope,
    ["thread", "channel"],
    slack.thread.historyScope,
  );
  slack.thread.inheritParent = parseBool(
    env.SLACK_THREAD_INHERIT_PARENT,
    slack.thread.inheritParent,
  );
  slack.thread.initialHistoryLimit = parseIntEnv(
    env.SLACK_THREAD_INITIAL_HISTORY_LIMIT,
    slack.thread.initialHistoryLimit,
    0,
  );

  slack.textChunkLimit = parseIntEnv(env.SLACK_TEXT_CHUNK_LIMIT, slack.textChunkLimit, 200);
  slack.chunkMode = normalizePolicy(
    env.SLACK_CHUNK_MODE || slack.chunkMode,
    ["length", "newline"],
    slack.chunkMode,
  );
  slack.mediaMaxMb = parseIntEnv(env.SLACK_MEDIA_MAX_MB, slack.mediaMaxMb, 1);

  slack.streaming = normalizePolicy(
    env.SLACK_STREAMING || slack.streaming,
    ["off", "partial", "block", "progress"],
    slack.streaming,
  );
  slack.nativeStreaming = parseBool(env.SLACK_NATIVE_STREAMING, slack.nativeStreaming);

  slack.ackReaction = (env.SLACK_ACK_REACTION ?? slack.ackReaction ?? "").trim();
  slack.removeAckAfterReply = parseBool(
    env.SLACK_REMOVE_ACK_AFTER_REPLY,
    slack.removeAckAfterReply,
  );

  slack.commands.native = parseBool(env.SLACK_COMMANDS_NATIVE, slack.commands.native);
  slack.slashCommand.enabled = parseBool(
    env.SLACK_SLASH_COMMAND_ENABLED,
    slack.slashCommand.enabled,
  );
  if (env.SLACK_SLASH_COMMAND_NAME) {
    slack.slashCommand.name = env.SLACK_SLASH_COMMAND_NAME.trim().replace(/^\//, "");
  }
  slack.slashCommand.ephemeral = parseBool(
    env.SLACK_SLASH_COMMAND_EPHEMERAL,
    slack.slashCommand.ephemeral,
  );

  slack.actions.messages = parseBool(env.SLACK_ACTIONS_MESSAGES, slack.actions.messages);
  slack.actions.reactions = parseBool(env.SLACK_ACTIONS_REACTIONS, slack.actions.reactions);
  slack.actions.pins = parseBool(env.SLACK_ACTIONS_PINS, slack.actions.pins);
  slack.actions.memberInfo = parseBool(env.SLACK_ACTIONS_MEMBER_INFO, slack.actions.memberInfo);
  slack.actions.emojiList = parseBool(env.SLACK_ACTIONS_EMOJI_LIST, slack.actions.emojiList);

  slack.configWrites = parseBool(env.SLACK_CONFIG_WRITES, slack.configWrites);
  slack.inboundDebounceMs = parseIntEnv(env.SLACK_INBOUND_DEBOUNCE_MS, slack.inboundDebounceMs, 0);

  codex.model = (env.CODEX_MODEL || codex.model || "").trim();
  codex.profile = (env.CODEX_PROFILE || codex.profile || "").trim();
  codex.workdir = path.resolve(cwd, (env.CODEX_WORKDIR || codex.workdir || ".").trim());
  codex.sandbox = normalizePolicy(
    env.CODEX_SANDBOX || codex.sandbox,
    ["read-only", "workspace-write", "danger-full-access"],
    codex.sandbox,
  );
  if (env.CODEX_ADDITIONAL_WRITABLE_DIRS) {
    codex.additionalWritableDirs = parseList(env.CODEX_ADDITIONAL_WRITABLE_DIRS).map((entry) =>
      path.resolve(cwd, entry),
    );
  }
  codex.timeoutMs = parseIntEnv(env.CODEX_TIMEOUT_MS, codex.timeoutMs, 1000);
  codex.systemPrompt = (env.CODEX_SYSTEM_PROMPT || codex.systemPrompt || "").trim();

  paperclip.enabled = parseBool(env.PAPERCLIP_ENABLED, paperclip.enabled);
  paperclip.apiUrl = (env.PAPERCLIP_API_URL || paperclip.apiUrl || "").trim();
  paperclip.companyId = (env.PAPERCLIP_COMPANY_ID || paperclip.companyId || "").trim();
  paperclip.taskPrefix = (env.PAPERCLIP_TASK_PREFIX || paperclip.taskPrefix || "task:").trim();
  if (env.PAPERCLIP_TRIGGER_MENTIONS) {
    paperclip.triggerMentions = parseList(env.PAPERCLIP_TRIGGER_MENTIONS);
  }
  paperclip.syncReplies = normalizePolicy(
    env.PAPERCLIP_SYNC_REPLIES || paperclip.syncReplies,
    ["mention_only"],
    paperclip.syncReplies,
  );
  paperclip.notificationMode = normalizePolicy(
    env.PAPERCLIP_NOTIFICATION_MODE || paperclip.notificationMode,
    ["high_signal"],
    paperclip.notificationMode,
  );
  const paperclipMappings = parseJsonMaybe(
    env.PAPERCLIP_AGENT_MAPPINGS_JSON,
    paperclip.agentMappings,
  );
  if (paperclipMappings && typeof paperclipMappings === "object" && !Array.isArray(paperclipMappings)) {
    paperclip.agentMappings = paperclipMappings;
  }
  const paperclipProjectMappings = parseJsonMaybe(
    env.PAPERCLIP_PROJECT_MAPPINGS_JSON,
    paperclip.projectMappings,
  );
  if (
    paperclipProjectMappings &&
    typeof paperclipProjectMappings === "object" &&
    !Array.isArray(paperclipProjectMappings)
  ) {
    paperclip.projectMappings = paperclipProjectMappings;
  }

  runtime.logLevel = (env.LOG_LEVEL || runtime.logLevel || "info").trim().toLowerCase();
  runtime.dataDir = path.resolve(cwd, (env.DATA_DIR || runtime.dataDir || "data").trim());

  const channelOverrides = parseJsonMaybe(env.SLACK_CHANNELS_JSON, null);
  if (channelOverrides && typeof channelOverrides === "object" && !Array.isArray(channelOverrides)) {
    slack.channels = deepMerge(slack.channels, channelOverrides);
  }
}

function normalizeConfig(config, cwd) {
  const normalized = deepClone(config);

  if (!normalized.slack.webhookPath.startsWith("/")) {
    normalized.slack.webhookPath = `/${normalized.slack.webhookPath}`;
  }

  normalized.slack.channelAllowlist = Array.from(new Set(normalized.slack.channelAllowlist || []));
  normalized.slack.dm.allowFrom = Array.from(new Set(normalized.slack.dm.allowFrom || []));
  normalized.slack.dm.groupChannels = Array.from(new Set(normalized.slack.dm.groupChannels || []));

  if (!normalized.slack.appId) {
    normalized.slack.appId = parseApiAppIdFromAppToken(normalized.slack.appToken);
  }

  if (normalized.slack.mode === "socket") {
    if (!normalized.slack.botToken) {
      throw new Error("SLACK_BOT_TOKEN is required for socket mode");
    }
    if (!normalized.slack.appToken) {
      throw new Error("SLACK_APP_TOKEN is required for socket mode");
    }
  }

  if (normalized.slack.mode === "http") {
    if (!normalized.slack.botToken) {
      throw new Error("SLACK_BOT_TOKEN is required for HTTP mode");
    }
    if (!normalized.slack.signingSecret) {
      throw new Error("SLACK_SIGNING_SECRET is required for HTTP mode");
    }
  }

  validateSlackToken("SLACK_BOT_TOKEN", normalized.slack.botToken, "xoxb-");
  if (normalized.slack.appToken) {
    validateSlackToken("SLACK_APP_TOKEN", normalized.slack.appToken, "xapp-");
  }

  normalized.runtime.dataDir = path.resolve(cwd, normalized.runtime.dataDir);
  normalized.codex.workdir = path.resolve(cwd, normalized.codex.workdir);
  normalized.codex.additionalWritableDirs = Array.from(
    new Set((normalized.codex.additionalWritableDirs || []).map((entry) => path.resolve(cwd, entry))),
  );
  normalized.paperclip.apiUrl = String(normalized.paperclip.apiUrl || "").replace(/\/+$/, "");
  normalized.paperclip.companyId = String(normalized.paperclip.companyId || "").trim();
  normalized.paperclip.taskPrefix = String(normalized.paperclip.taskPrefix || "task:").trim() || "task:";
  normalized.paperclip.triggerMentions = Array.from(
    new Set(
      (Array.isArray(normalized.paperclip.triggerMentions)
        ? normalized.paperclip.triggerMentions
        : ["@paperclip"]
      )
        .map((entry) => String(entry || "").trim())
        .filter(Boolean),
    ),
  );
  normalized.paperclip.agentMappings =
    normalized.paperclip.agentMappings &&
    typeof normalized.paperclip.agentMappings === "object" &&
    !Array.isArray(normalized.paperclip.agentMappings)
      ? normalized.paperclip.agentMappings
      : {};
  normalized.paperclip.projectMappings =
    normalized.paperclip.projectMappings &&
    typeof normalized.paperclip.projectMappings === "object" &&
    !Array.isArray(normalized.paperclip.projectMappings)
      ? normalized.paperclip.projectMappings
      : {};

  if (normalized.paperclip.enabled) {
    if (!normalized.paperclip.apiUrl) {
      throw new Error("PAPERCLIP_API_URL is required when PAPERCLIP_ENABLED=true");
    }
    if (!normalized.paperclip.companyId) {
      throw new Error("PAPERCLIP_COMPANY_ID is required when PAPERCLIP_ENABLED=true");
    }
  }

  return normalized;
}

export function loadConfig(cwd = process.cwd()) {
  const configPath = path.resolve(cwd, process.env.SLACK_CODEX_CONFIG || DEFAULT_CONFIG_FILE);

  let fileConfig = {};
  try {
    const loaded = readJsonFile(configPath);
    fileConfig = loaded && typeof loaded === "object" ? loaded : {};
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to read config file ${configPath}: ${reason}`);
  }

  const merged = deepMerge(deepClone(DEFAULTS), fileConfig);
  applyEnvOverrides(merged, cwd);
  const normalized = normalizeConfig(merged, cwd);

  return {
    configPath,
    config: normalized,
  };
}

export function writeConfigFile(configPath, config) {
  const out = JSON.stringify(config, null, 2) + "\n";
  fs.writeFileSync(configPath, out, "utf8");
}
