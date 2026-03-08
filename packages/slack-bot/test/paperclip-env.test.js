import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { loadPaperclipEnvIntoProcess, resolvePaperclipEnvPath } from "../src/paperclip-env.js";

test("resolvePaperclipEnvPath prefers PAPERCLIP_CONFIG when present", () => {
  const resolved = resolvePaperclipEnvPath({
    env: {
      PAPERCLIP_CONFIG: "/tmp/paperclip/instances/default/config.json",
    },
  });

  assert.equal(resolved, "/tmp/paperclip/instances/default/.env");
});

test("loadPaperclipEnvIntoProcess overrides Slack tokens from the Paperclip env file", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "paperclip-slack-env-"));
  const configPath = path.join(tmpDir, "instances", "default", "config.json");
  const envPath = path.join(tmpDir, "instances", "default", ".env");

  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, "{}\n", "utf8");
  fs.writeFileSync(
    envPath,
    [
      "SLACK_BOT_TOKEN=xoxb-from-paperclip",
      "SLACK_APP_TOKEN=xapp-from-paperclip",
      "",
    ].join("\n"),
    "utf8",
  );

  const env = {
    PAPERCLIP_CONFIG: configPath,
    SLACK_BOT_TOKEN: "xoxb-from-project-env",
    SLACK_APP_TOKEN: "xapp-from-project-env",
  };

  const result = loadPaperclipEnvIntoProcess({
    env,
    keys: ["SLACK_BOT_TOKEN", "SLACK_APP_TOKEN"],
  });

  assert.equal(result.envPath, envPath);
  assert.deepEqual(result.loadedKeys, ["SLACK_BOT_TOKEN", "SLACK_APP_TOKEN"]);
  assert.equal(env.SLACK_BOT_TOKEN, "xoxb-from-paperclip");
  assert.equal(env.SLACK_APP_TOKEN, "xapp-from-paperclip");
});
