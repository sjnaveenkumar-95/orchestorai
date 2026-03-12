import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

test("slack-agent-core exposes publishable package metadata", () => {
  const packageJsonPath = path.resolve("packages/slack-agent-core/package.json");
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));

  assert.equal(packageJson.name, "slack-agent-core");
  assert.equal(packageJson.type, "module");
  assert.ok(packageJson.exports?.["."]);
  assert.ok(packageJson.files?.includes("src"));
  assert.equal(packageJson.publishConfig?.access, "public");
});
