import fs from "node:fs";
import {
  PairingStore,
  buildHistoryContext,
  chunkText,
  cleanSlackText,
  handleSlackNativeAction,
  normalizeChannelType,
  resolveReplyThreadTs,
} from "slack-agent-core";

export function dmOwnsChannelType(channelType) {
  return channelType === "im";
}

function isLoggedLevelEnabled(current, target) {
  const order = { debug: 10, info: 20, warn: 30, error: 40 };
  return (order[target] || 20) >= (order[current] || 20);
}

function isSkippableEvent(event, allowBots) {
  if (!event || !event.channel) {
    return true;
  }
  if (event.subtype && event.subtype !== "file_share") {
    return true;
  }
  if (!allowBots && (event.bot_id || event.subtype === "bot_message")) {
    return true;
  }
  return false;
}

export class SlackDmRuntime {
  constructor(params) {
    this.config = params.config;
    this.configPath = params.configPath;
    this.modelAdapter = params.modelAdapter;

    this.app = null;
    this.botUserId = "";
    this.teamId = "";
    this.userCache = new Map();
    this.pairingStore = new PairingStore(this.config.runtime.dataDir);
    this.pairingStore.ensureLoaded();
    fs.mkdirSync(this.config.runtime.dataDir, { recursive: true });
  }

  log(level, message, meta) {
    if (!isLoggedLevelEnabled(this.config.runtime.logLevel, level)) {
      return;
    }
    if (meta !== undefined) {
      console.log(`[${level}]`, message, meta);
      return;
    }
    console.log(`[${level}]`, message);
  }

  async ensureApp() {
    if (this.app) {
      return this.app;
    }

    const slackBoltModule = await import("@slack/bolt");
    const slackBolt = (slackBoltModule.App ? slackBoltModule : slackBoltModule.default) ?? slackBoltModule;
    const { App, HTTPReceiver } = slackBolt;

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
    return this.app;
  }

  async resolveUserInfo(userId) {
    if (!userId) {
      return { id: "", name: "" };
    }
    const cached = this.userCache.get(userId);
    if (cached) {
      return cached;
    }
    const resp = await this.app.client.users.info({ user: userId });
    const user = resp.user || {};
    const resolved = {
      id: user.id || userId,
      name: user.real_name || user.name || userId,
    };
    this.userCache.set(userId, resolved);
    return resolved;
  }

  async authorizeDirectMessage(event) {
    const policy = this.config.slack.dm.policy;
    if (!this.config.slack.dm.enabled || policy === "disabled") {
      return {
        allowed: false,
        message: "Direct messages are disabled for this bot.",
      };
    }

    const senderId = String(event.user || "").trim();
    const allowFrom = new Set((this.config.slack.dm.allowFrom || []).map((entry) => String(entry || "").trim()));

    if (policy === "open") {
      return { allowed: true };
    }
    if (policy === "allowlist") {
      return allowFrom.has(senderId)
        ? { allowed: true }
        : {
            allowed: false,
            message: "You are not allowlisted for direct messages with this bot.",
          };
    }

    if (allowFrom.has(senderId) || this.pairingStore.isApproved(senderId)) {
      return { allowed: true };
    }

    const sender = await this.resolveUserInfo(senderId);
    const challenge = this.pairingStore.upsertChallenge(senderId, { name: sender.name });
    return {
      allowed: false,
      message:
        `This DM requires pairing approval.\n` +
        `Share pairing code \`${challenge.code}\` with an operator, then try again.`,
    };
  }

  async fetchHistory(event) {
    const threadTs = event.thread_ts || event.ts;
    if (!threadTs) {
      return [];
    }
    const resp = await this.app.client.conversations.replies({
      channel: event.channel,
      ts: threadTs,
      limit: this.config.slack.thread.initialHistoryLimit,
    });
    return (resp.messages || []).slice(-this.config.slack.thread.initialHistoryLimit);
  }

  buildPromptContext(params) {
    const lines = [
      `chat_type=direct`,
      `channel=${params.event.channel}`,
      `sender_id=${params.sender.id}`,
      `sender_name=${params.sender.name}`,
    ];

    if (params.history.length > 0) {
      lines.push("history:");
      lines.push(buildHistoryContext(params.history));
    }

    return lines.join("\n");
  }

  async replyInChunks(channel, threadTs, text) {
    const chunks = chunkText(
      text,
      Math.max(200, this.config.slack.textChunkLimit),
      this.config.slack.chunkMode,
    );

    for (const chunk of chunks) {
      await this.app.client.chat.postMessage({
        channel,
        thread_ts: threadTs,
        text: chunk,
      });
    }
  }

  async handleMessage(event) {
    if (isSkippableEvent(event, this.config.slack.allowBots)) {
      return;
    }

    const channelType = normalizeChannelType(event.channel_type, event.channel);
    if (!dmOwnsChannelType(channelType)) {
      return;
    }

    const authorized = await this.authorizeDirectMessage(event);
    const threadTs = resolveReplyThreadTs(event);
    if (!authorized.allowed) {
      await this.app.client.chat.postMessage({
        channel: event.channel,
        thread_ts: threadTs,
        text: authorized.message,
      });
      return;
    }

    const rawText = String(event.text || "").trim();
    if (this.config.slack.commands.native && rawText.startsWith("/slack ")) {
      const native = await handleSlackNativeAction({
        text: rawText.slice("/slack ".length),
        client: this.app.client,
        channelId: event.channel,
        threadTs,
        userId: event.user,
        config: this.config,
        botToken: this.config.slack.botToken,
        dataDir: this.config.runtime.dataDir,
      });
      if (native.handled) {
        await this.replyInChunks(event.channel, threadTs, native.text);
        return;
      }
    }

    const cleanedText = cleanSlackText(rawText);
    if (!cleanedText) {
      return;
    }

    const sender = await this.resolveUserInfo(event.user);
    const history = await this.fetchHistory(event);
    const queueKey = `dm:${event.channel}`;
    const reply = await this.modelAdapter.request(
      {
        userText: cleanedText,
        context: this.buildPromptContext({
          event,
          sender,
          history,
        }),
      },
      queueKey,
    );

    await this.replyInChunks(event.channel, threadTs, reply);
  }

  registerEvents() {
    this.app.event("message", async ({ event }) => {
      try {
        await this.handleMessage(event);
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        this.log("error", "dm message handling failed", { reason, channel: event?.channel, user: event?.user });
        if (event?.channel) {
          await this.app.client.chat.postMessage({
            channel: event.channel,
            thread_ts: resolveReplyThreadTs(event),
            text: `I hit an error while handling that DM: ${reason}`,
          });
        }
      }
    });
  }

  async start() {
    await this.modelAdapter.ensureReady();
    await this.ensureApp();

    const auth = await this.app.client.auth.test({ token: this.config.slack.botToken });
    this.botUserId = auth.user_id || "";
    this.teamId = auth.team_id || "";

    this.registerEvents();

    if (this.config.slack.mode === "http") {
      await this.app.start(this.config.slack.port);
      this.log("info", `Slack DM runtime listening on port ${this.config.slack.port}`);
      return;
    }

    await this.app.start();
    this.log("info", "Slack DM runtime started in socket mode");
  }
}
