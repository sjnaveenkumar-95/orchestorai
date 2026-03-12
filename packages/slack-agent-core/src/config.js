import fs from "node:fs";
import path from "node:path";

const DEFAULT_CONFIG_FILE = "slack-agent.config.json";

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
  model: {
    provider: "codex_cli",
    timeoutMs: 1800000,
    systemPrompt:
      "You are Codex. Reply concisely, accurately, and with practical software-engineering guidance.",
    workdir: process.cwd(),
    codexCli: {
      command: "codex",
      model: "",
      profile: "",
      reasoningEffort: "",
      sandbox: "workspace-write",
      additionalWritableDirs: [],
    },
  },
  runtime: {
    logLevel: "info",
    dataDir: "data",
  },
};

export function findNearestDotenvPath(cwd = process.cwd(), env = process.env) {
  const explicitEnvPath = String(env.SLACK_AGENT_ENV_FILE || "").trim();
  if (explicitEnvPath) {
    return path.resolve(cwd, explicitEnvPath);
  }
  const candidate = path.join(path.resolve(cwd), ".env");
  return fs.existsSync(candidate) ? candidate : "";
}

export function loadDotenvForCwd(cwd = process.cwd(), processEnv = process.env) {
  const envPath = findNearestDotenvPath(cwd, processEnv);
  if (!envPath) {
    return "";
  }
  const raw = fs.readFileSync(envPath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const separator = trimmed.indexOf("=");
    if (separator <= 0) {
      continue;
    }
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim();
    processEnv[key] = value;
  }
  return envPath;
}

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
  if (["1", "true", "yes", "y", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "n", "off"].includes(normalized)) return false;
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

function applyEnvOverrides(config, cwd, env = process.env) {
  const slack = config.slack;
  const model = config.model;
  const runtime = config.runtime;

  slack.mode = normalizePolicy(env.SLACK_MODE || slack.mode, ["socket", "http"], slack.mode);
  slack.botToken = (env.SLACK_BOT_TOKEN || slack.botToken || "").trim();
  slack.appToken = (env.SLACK_APP_TOKEN || slack.appToken || "").trim();
  slack.signingSecret = (env.SLACK_SIGNING_SECRET || slack.signingSecret || "").trim();
  slack.appId = (env.SLACK_APP_ID || slack.appId || "").trim();
  slack.webhookPath = (env.SLACK_WEBHOOK_PATH || slack.webhookPath || "/slack/events").trim();
  slack.port = parseIntEnv(env.SLACK_PORT, slack.port, 1);

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

  model.provider = normalizePolicy(env.MODEL_PROVIDER || model.provider, ["codex_cli"], model.provider);
  model.timeoutMs = parseIntEnv(env.MODEL_TIMEOUT_MS, model.timeoutMs, 1000);
  model.systemPrompt = (env.MODEL_SYSTEM_PROMPT || model.systemPrompt || "").trim();
  model.workdir = path.resolve(cwd, (env.MODEL_WORKDIR || model.workdir || ".").trim());
  model.codexCli.command = (env.MODEL_CODEX_COMMAND || model.codexCli.command || "codex").trim();
  model.codexCli.model = (env.MODEL_CODEX_MODEL || model.codexCli.model || "").trim();
  model.codexCli.profile = (env.MODEL_CODEX_PROFILE || model.codexCli.profile || "").trim();
  model.codexCli.reasoningEffort = normalizePolicy(
    env.MODEL_CODEX_REASONING_EFFORT || env.MODEL_CODEX_THINKING || model.codexCli.reasoningEffort,
    ["minimal", "low", "medium", "high"],
    "",
  );
  model.codexCli.sandbox = normalizePolicy(
    env.MODEL_CODEX_SANDBOX || model.codexCli.sandbox,
    ["read-only", "workspace-write", "danger-full-access"],
    model.codexCli.sandbox,
  );
  if (env.MODEL_CODEX_ADDITIONAL_WRITABLE_DIRS) {
    model.codexCli.additionalWritableDirs = parseList(env.MODEL_CODEX_ADDITIONAL_WRITABLE_DIRS).map((entry) =>
      path.resolve(cwd, entry),
    );
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
    if (!normalized.slack.botToken) throw new Error("SLACK_BOT_TOKEN is required for socket mode");
    if (!normalized.slack.appToken) throw new Error("SLACK_APP_TOKEN is required for socket mode");
  }

  if (normalized.slack.mode === "http") {
    if (!normalized.slack.botToken) throw new Error("SLACK_BOT_TOKEN is required for HTTP mode");
    if (!normalized.slack.signingSecret) throw new Error("SLACK_SIGNING_SECRET is required for HTTP mode");
  }

  validateSlackToken("SLACK_BOT_TOKEN", normalized.slack.botToken, "xoxb-");
  if (normalized.slack.appToken) {
    validateSlackToken("SLACK_APP_TOKEN", normalized.slack.appToken, "xapp-");
  }

  normalized.model.workdir = path.resolve(cwd, normalized.model.workdir);
  normalized.model.codexCli.reasoningEffort = normalizePolicy(
    normalized.model.codexCli.reasoningEffort,
    ["minimal", "low", "medium", "high"],
    "",
  );
  normalized.model.codexCli.additionalWritableDirs = Array.from(
    new Set((normalized.model.codexCli.additionalWritableDirs || []).map((entry) => path.resolve(cwd, entry))),
  );
  normalized.runtime.dataDir = path.resolve(cwd, normalized.runtime.dataDir);

  return normalized;
}

export function translateLegacyCodexToModel(codexConfig = {}) {
  return {
    provider: "codex_cli",
    timeoutMs: codexConfig.timeoutMs ?? DEFAULTS.model.timeoutMs,
    systemPrompt: codexConfig.systemPrompt ?? DEFAULTS.model.systemPrompt,
    workdir: codexConfig.workdir ?? DEFAULTS.model.workdir,
    codexCli: {
      command: codexConfig.command ?? "codex",
      model: codexConfig.model ?? "",
      profile: codexConfig.profile ?? "",
      reasoningEffort: codexConfig.reasoningEffort ?? "",
      sandbox: codexConfig.sandbox ?? DEFAULTS.model.codexCli.sandbox,
      additionalWritableDirs: codexConfig.additionalWritableDirs ?? [],
    },
  };
}

export function loadConfig(cwd = process.cwd()) {
  loadDotenvForCwd(cwd);
  const configPath = path.resolve(cwd, process.env.SLACK_AGENT_CONFIG || DEFAULT_CONFIG_FILE);

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
