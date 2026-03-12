import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { loadConfig } from "../src/config.js";

test("dm package uses the neutral slack agent config surface", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "slack-agent-dm-config-"));
  const nested = path.join(tempRoot, "packages", "slack-agent-dm");
  fs.mkdirSync(nested, { recursive: true });
  fs.writeFileSync(
    path.join(tempRoot, ".env"),
    [
      "SLACK_BOT_TOKEN=xoxb-test-token",
      "SLACK_APP_TOKEN=xapp-1-A0TESTAPP-abc",
      "MODEL_PROVIDER=codex_cli",
      "MODEL_CODEX_MODEL=gpt-5.3-codex",
    ].join("\n") + "\n",
    "utf8",
  );

  const saved = {
    SLACK_BOT_TOKEN: process.env.SLACK_BOT_TOKEN,
    SLACK_APP_TOKEN: process.env.SLACK_APP_TOKEN,
    MODEL_PROVIDER: process.env.MODEL_PROVIDER,
    MODEL_CODEX_MODEL: process.env.MODEL_CODEX_MODEL,
    SLACK_AGENT_CONFIG: process.env.SLACK_AGENT_CONFIG,
  };

  delete process.env.SLACK_BOT_TOKEN;
  delete process.env.SLACK_APP_TOKEN;
  delete process.env.MODEL_PROVIDER;
  delete process.env.MODEL_CODEX_MODEL;
  delete process.env.SLACK_AGENT_CONFIG;

  try {
    const { config } = loadConfig(nested);
    assert.equal(config.model.provider, "codex_cli");
    assert.equal(config.model.codexCli.model, "gpt-5.3-codex");
    assert.equal("orchestorai" in config, false);
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
