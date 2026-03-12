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

test("resolveOrchestorAIEnvPath falls back to the home instance env path", () => {
  const resolved = resolveOrchestorAIEnvPath({
    env: {
      HOME: "/tmp/test-home",
    },
  });

  assert.equal(resolved, "/tmp/test-home/.orchestorai/instances/default/.env");
});

test("loadOrchestorAIEnvIntoProcess loads OrchestorAI bridge settings from the home env file", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "orchestorai-slack-env-"));
  const envPath = path.join(tmpDir, ".orchestorai", "instances", "default", ".env");

  fs.mkdirSync(path.dirname(envPath), { recursive: true });
  fs.writeFileSync(
    envPath,
    [
      "ORCHESTORAI_ENABLED=true",
      "ORCHESTORAI_API_URL=http://127.0.0.1:3100",
      "ORCHESTORAI_COMPANY_ID=company-from-home-env",
      "",
    ].join("\n"),
    "utf8",
  );

  const env = {
    HOME: tmpDir,
    ORCHESTORAI_ENABLED: "false",
    ORCHESTORAI_API_URL: "http://127.0.0.1:9999",
    ORCHESTORAI_COMPANY_ID: "company-from-process-env",
  };

  const result = loadOrchestorAIEnvIntoProcess({
    env,
    keys: ["ORCHESTORAI_ENABLED", "ORCHESTORAI_API_URL", "ORCHESTORAI_COMPANY_ID"],
  });

  assert.equal(result.envPath, envPath);
  assert.deepEqual(result.loadedKeys, ["ORCHESTORAI_ENABLED", "ORCHESTORAI_API_URL", "ORCHESTORAI_COMPANY_ID"]);
  assert.equal(env.ORCHESTORAI_ENABLED, "true");
  assert.equal(env.ORCHESTORAI_API_URL, "http://127.0.0.1:3100");
  assert.equal(env.ORCHESTORAI_COMPANY_ID, "company-from-home-env");
});
