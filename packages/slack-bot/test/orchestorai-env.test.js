import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { loadOrchestorAIEnvIntoProcess, resolveOrchestorAIEnvPath } from "../src/orchestorai-env.js";

test("resolveOrchestorAIEnvPath prefers ORCHESTORAI_CONFIG when present", () => {
  const resolved = resolveOrchestorAIEnvPath({
    env: {
      ORCHESTORAI_CONFIG: "/tmp/orchestorai/instances/default/config.json",
    },
  });

  assert.equal(resolved, "/tmp/orchestorai/instances/default/.env");
});

test("loadOrchestorAIEnvIntoProcess overrides Slack tokens from the OrchestorAI env file", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "orchestorai-slack-env-"));
  const configPath = path.join(tmpDir, "instances", "default", "config.json");
  const envPath = path.join(tmpDir, "instances", "default", ".env");

  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, "{}\n", "utf8");
  fs.writeFileSync(
    envPath,
    [
      "SLACK_BOT_TOKEN=xoxb-from-orchestorai",
      "SLACK_APP_TOKEN=xapp-from-orchestorai",
      "",
    ].join("\n"),
    "utf8",
  );

  const env = {
    ORCHESTORAI_CONFIG: configPath,
    SLACK_BOT_TOKEN: "xoxb-from-project-env",
    SLACK_APP_TOKEN: "xapp-from-project-env",
  };

  const result = loadOrchestorAIEnvIntoProcess({
    env,
    keys: ["SLACK_BOT_TOKEN", "SLACK_APP_TOKEN"],
  });

  assert.equal(result.envPath, envPath);
  assert.deepEqual(result.loadedKeys, ["SLACK_BOT_TOKEN", "SLACK_APP_TOKEN"]);
  assert.equal(env.SLACK_BOT_TOKEN, "xoxb-from-orchestorai");
  assert.equal(env.SLACK_APP_TOKEN, "xapp-from-orchestorai");
});
