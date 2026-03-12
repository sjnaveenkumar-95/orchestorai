import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

test("loadConfig prefers the channel-bot env file over the legacy wrapper env file", async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "slack-channel-bot-config-"));
  const slackBotDir = path.join(tempRoot, "packages", "slack-bot");
  const channelBotDir = path.join(tempRoot, "packages", "slack-channel-bot");
  fs.mkdirSync(slackBotDir, { recursive: true });
  fs.mkdirSync(channelBotDir, { recursive: true });

  fs.writeFileSync(
    path.join(slackBotDir, ".env"),
    [
      "SLACK_DM_POLICY=open",
      "SLACK_BOT_TOKEN=xoxb-wrapper-token",
      "SLACK_APP_TOKEN=xapp-1-A0WRAPPER-abc",
    ].join("\n") + "\n",
    "utf8",
  );
  fs.writeFileSync(
    path.join(channelBotDir, ".env"),
    [
      "SLACK_DM_POLICY=allowlist",
      "SLACK_BOT_TOKEN=xoxb-channel-token",
      "SLACK_APP_TOKEN=xapp-1-A0CHANNEL-abc",
    ].join("\n") + "\n",
    "utf8",
  );

  const saved = {
    SLACK_CHANNEL_BOT_ENV_FILE: process.env.SLACK_CHANNEL_BOT_ENV_FILE,
    SLACK_BOT_ENV_FILE: process.env.SLACK_BOT_ENV_FILE,
    SLACK_AGENT_ENV_FILE: process.env.SLACK_AGENT_ENV_FILE,
    SLACK_DM_POLICY: process.env.SLACK_DM_POLICY,
    SLACK_BOT_TOKEN: process.env.SLACK_BOT_TOKEN,
    SLACK_APP_TOKEN: process.env.SLACK_APP_TOKEN,
    SLACK_CODEX_CONFIG: process.env.SLACK_CODEX_CONFIG,
  };

  process.env.SLACK_CHANNEL_BOT_ENV_FILE = path.join(channelBotDir, ".env");
  process.env.SLACK_BOT_ENV_FILE = path.join(slackBotDir, ".env");
  delete process.env.SLACK_AGENT_ENV_FILE;
  delete process.env.SLACK_DM_POLICY;
  delete process.env.SLACK_BOT_TOKEN;
  delete process.env.SLACK_APP_TOKEN;
  delete process.env.SLACK_CODEX_CONFIG;

  try {
    const configModuleUrl = new URL(`../src/config.js?test=${Date.now()}`, import.meta.url);
    const { loadConfig } = await import(configModuleUrl.href);
    const { config } = loadConfig(channelBotDir);

    assert.equal(config.slack.dm.policy, "allowlist");
    assert.equal(config.slack.dm.enabled, false);
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
});

test("loadConfig supports separate channel and DM Codex system prompts", async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "slack-channel-bot-config-"));
  const channelBotDir = path.join(tempRoot, "packages", "slack-channel-bot");
  fs.mkdirSync(channelBotDir, { recursive: true });

  fs.writeFileSync(
    path.join(channelBotDir, ".env"),
    [
      "SLACK_BOT_TOKEN=xoxb-channel-token",
      "SLACK_APP_TOKEN=xapp-1-A0CHANNEL-abc",
      "CODEX_SYSTEM_PROMPT_CHANNEL=Channel prompt",
      "CODEX_SYSTEM_PROMPT_DM=DM prompt",
    ].join("\n") + "\n",
    "utf8",
  );

  const saved = {
    SLACK_CHANNEL_BOT_ENV_FILE: process.env.SLACK_CHANNEL_BOT_ENV_FILE,
    SLACK_BOT_TOKEN: process.env.SLACK_BOT_TOKEN,
    SLACK_APP_TOKEN: process.env.SLACK_APP_TOKEN,
    CODEX_SYSTEM_PROMPT: process.env.CODEX_SYSTEM_PROMPT,
    CODEX_SYSTEM_PROMPT_CHANNEL: process.env.CODEX_SYSTEM_PROMPT_CHANNEL,
    CODEX_SYSTEM_PROMPT_DM: process.env.CODEX_SYSTEM_PROMPT_DM,
    SLACK_CODEX_CONFIG: process.env.SLACK_CODEX_CONFIG,
  };

  process.env.SLACK_CHANNEL_BOT_ENV_FILE = path.join(channelBotDir, ".env");
  delete process.env.SLACK_BOT_TOKEN;
  delete process.env.SLACK_APP_TOKEN;
  delete process.env.CODEX_SYSTEM_PROMPT;
  delete process.env.CODEX_SYSTEM_PROMPT_CHANNEL;
  delete process.env.CODEX_SYSTEM_PROMPT_DM;
  delete process.env.SLACK_CODEX_CONFIG;

  try {
    const configModuleUrl = new URL(`../src/config.js?test=${Date.now()}`, import.meta.url);
    const { loadConfig } = await import(configModuleUrl.href);
    const { config } = loadConfig(channelBotDir);

    assert.equal(config.codex.systemPrompt, "Channel prompt");
    assert.equal(config.codex.directMessageSystemPrompt, "DM prompt");
    assert.equal(config.model.systemPrompt, "Channel prompt");
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
});
