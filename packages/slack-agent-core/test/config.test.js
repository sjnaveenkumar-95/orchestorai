import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { findNearestDotenvPath, loadConfig, loadDotenvForCwd } from "../src/config.js";

test("findNearestDotenvPath prefers the package-local env file", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "slack-agent-core-config-"));
  const nested = path.join(tempRoot, "packages", "slack-agent-dm");
  fs.mkdirSync(nested, { recursive: true });
  fs.writeFileSync(path.join(nested, ".env"), "MODEL_PROVIDER=codex_cli\n", "utf8");

  const found = findNearestDotenvPath(nested);

  assert.equal(found, path.join(nested, ".env"));
});

test("loadDotenvForCwd loads package-local env values", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "slack-agent-core-config-"));
  const nested = path.join(tempRoot, "packages", "slack-agent-dm");
  fs.mkdirSync(nested, { recursive: true });
  fs.writeFileSync(path.join(nested, ".env"), "MODEL_PROVIDER=codex_cli\n", "utf8");

  const targetEnv = {};
  const loadedPath = loadDotenvForCwd(nested, targetEnv);

  assert.equal(loadedPath, path.join(nested, ".env"));
  assert.equal(targetEnv.MODEL_PROVIDER, "codex_cli");
});

test("loadDotenvForCwd does not climb to ancestor env files", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "slack-agent-core-config-"));
  const nested = path.join(tempRoot, "packages", "slack-agent-dm");
  fs.mkdirSync(nested, { recursive: true });
  fs.writeFileSync(path.join(tempRoot, ".env"), "MODEL_PROVIDER=codex_cli\n", "utf8");

  const targetEnv = {};
  const loadedPath = loadDotenvForCwd(nested, targetEnv);

  assert.equal(loadedPath, "");
  assert.equal(targetEnv.MODEL_PROVIDER, undefined);
});

test("loadConfig applies neutral model settings from the package-local env file", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "slack-agent-core-config-"));
  const nested = path.join(tempRoot, "packages", "slack-agent-dm");
  fs.mkdirSync(nested, { recursive: true });
  fs.writeFileSync(
    path.join(nested, ".env"),
    [
      "SLACK_BOT_TOKEN=xoxb-test-token",
      "SLACK_APP_TOKEN=xapp-1-A0TESTAPP-abc",
      "MODEL_PROVIDER=codex_cli",
      "MODEL_CODEX_MODEL=gpt-5.3-codex",
      "MODEL_CODEX_THINKING=high",
      "MODEL_WORKDIR=../workspace",
      "MODEL_CODEX_SANDBOX=danger-full-access",
    ].join("\n") + "\n",
    "utf8",
  );

  const saved = {
    SLACK_BOT_TOKEN: process.env.SLACK_BOT_TOKEN,
    SLACK_APP_TOKEN: process.env.SLACK_APP_TOKEN,
    MODEL_PROVIDER: process.env.MODEL_PROVIDER,
    MODEL_CODEX_MODEL: process.env.MODEL_CODEX_MODEL,
    MODEL_CODEX_THINKING: process.env.MODEL_CODEX_THINKING,
    MODEL_WORKDIR: process.env.MODEL_WORKDIR,
    MODEL_CODEX_SANDBOX: process.env.MODEL_CODEX_SANDBOX,
    SLACK_AGENT_CONFIG: process.env.SLACK_AGENT_CONFIG,
  };

  delete process.env.SLACK_BOT_TOKEN;
  delete process.env.SLACK_APP_TOKEN;
  delete process.env.MODEL_PROVIDER;
  delete process.env.MODEL_CODEX_MODEL;
  delete process.env.MODEL_CODEX_THINKING;
  delete process.env.MODEL_WORKDIR;
  delete process.env.MODEL_CODEX_SANDBOX;
  delete process.env.SLACK_AGENT_CONFIG;

  try {
    const { config } = loadConfig(nested);
    assert.equal(config.model.provider, "codex_cli");
    assert.equal(config.model.codexCli.model, "gpt-5.3-codex");
    assert.equal(config.model.codexCli.reasoningEffort, "high");
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
