import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { findNearestDotenvPath, loadConfig, loadDotenvForCwd } from "../src/config.js";

test("findNearestDotenvPath prefers the channel-bot package env file through the wrapper", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "slack-bot-config-"));
  const nested = path.join(tempRoot, "packages", "slack-channel-bot");
  fs.mkdirSync(nested, { recursive: true });
  fs.writeFileSync(path.join(nested, ".env"), "SLACK_DM_POLICY=open\n", "utf8");

  const found = findNearestDotenvPath(nested);

  assert.equal(found, path.join(nested, ".env"));
});

test("loadDotenvForCwd loads package-local channel-bot env values through the wrapper", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "slack-bot-config-"));
  const nested = path.join(tempRoot, "packages", "slack-channel-bot");
  fs.mkdirSync(nested, { recursive: true });
  fs.writeFileSync(path.join(nested, ".env"), "SLACK_DM_POLICY=open\n", "utf8");

  const targetEnv = {};
  const loadedPath = loadDotenvForCwd(nested, targetEnv);

  assert.equal(loadedPath, path.join(nested, ".env"));
  assert.equal(targetEnv.SLACK_DM_POLICY, "open");
});

test("loadDotenvForCwd does not climb to ancestor env files through the wrapper", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "slack-bot-config-"));
  const nested = path.join(tempRoot, "packages", "slack-channel-bot");
  fs.mkdirSync(nested, { recursive: true });
  fs.writeFileSync(path.join(tempRoot, ".env"), "SLACK_DM_POLICY=open\n", "utf8");

  const targetEnv = {};
  const loadedPath = loadDotenvForCwd(nested, targetEnv);

  assert.equal(loadedPath, "");
  assert.equal(targetEnv.SLACK_DM_POLICY, undefined);
});

test("loadConfig applies channel-bot env overrides when used through the wrapper", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "slack-bot-config-"));
  const nested = path.join(tempRoot, "packages", "slack-channel-bot");
  fs.mkdirSync(nested, { recursive: true });
  fs.writeFileSync(
    path.join(nested, ".env"),
    [
      "SLACK_DM_POLICY=open",
      "SLACK_BOT_TOKEN=xoxb-test-token",
      "SLACK_APP_TOKEN=xapp-1-A0TESTAPP-abc",
    ].join("\n") + "\n",
    "utf8",
  );

  const saved = {
    SLACK_DM_POLICY: process.env.SLACK_DM_POLICY,
    SLACK_BOT_TOKEN: process.env.SLACK_BOT_TOKEN,
    SLACK_APP_TOKEN: process.env.SLACK_APP_TOKEN,
    SLACK_CODEX_CONFIG: process.env.SLACK_CODEX_CONFIG,
  };

  delete process.env.SLACK_DM_POLICY;
  delete process.env.SLACK_BOT_TOKEN;
  delete process.env.SLACK_APP_TOKEN;
  delete process.env.SLACK_CODEX_CONFIG;

  try {
    const { config } = loadConfig(nested);
    assert.equal(config.slack.dm.policy, "open");
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

test("loadConfig translates legacy CODEX_* settings into the neutral model block through the wrapper", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "slack-bot-config-"));
  const nested = path.join(tempRoot, "packages", "slack-channel-bot");
  fs.mkdirSync(nested, { recursive: true });
  fs.writeFileSync(
    path.join(nested, ".env"),
    [
      "SLACK_BOT_TOKEN=xoxb-test-token",
      "SLACK_APP_TOKEN=xapp-1-A0TESTAPP-abc",
      "CODEX_MODEL=gpt-5.3-codex",
      "CODEX_THINKING=medium",
      "CODEX_WORKDIR=../workspace",
      "CODEX_SANDBOX=danger-full-access",
    ].join("\n") + "\n",
    "utf8",
  );

  const saved = {
    SLACK_BOT_TOKEN: process.env.SLACK_BOT_TOKEN,
    SLACK_APP_TOKEN: process.env.SLACK_APP_TOKEN,
    CODEX_MODEL: process.env.CODEX_MODEL,
    CODEX_THINKING: process.env.CODEX_THINKING,
    CODEX_WORKDIR: process.env.CODEX_WORKDIR,
    CODEX_SANDBOX: process.env.CODEX_SANDBOX,
    SLACK_CODEX_CONFIG: process.env.SLACK_CODEX_CONFIG,
  };

  delete process.env.SLACK_BOT_TOKEN;
  delete process.env.SLACK_APP_TOKEN;
  delete process.env.CODEX_MODEL;
  delete process.env.CODEX_THINKING;
  delete process.env.CODEX_WORKDIR;
  delete process.env.CODEX_SANDBOX;
  delete process.env.SLACK_CODEX_CONFIG;

  try {
    const { config } = loadConfig(nested);
    assert.equal(config.model.provider, "codex_cli");
    assert.equal(config.model.codexCli.model, "gpt-5.3-codex");
    assert.equal(config.model.codexCli.reasoningEffort, "medium");
    assert.equal(config.model.codexCli.sandbox, "danger-full-access");
    assert.equal(config.model.workdir, path.resolve(nested, "../workspace"));
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
