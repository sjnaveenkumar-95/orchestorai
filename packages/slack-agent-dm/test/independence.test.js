import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

test("dm runtime does not import orchestorai-specific modules", () => {
  const runtimePath = path.resolve("packages/slack-agent-dm/src/runtime.js");
  const indexPath = path.resolve("packages/slack-agent-dm/src/index.js");

  const runtimeSource = fs.readFileSync(runtimePath, "utf8");
  const indexSource = fs.readFileSync(indexPath, "utf8");

  assert.doesNotMatch(runtimeSource, /orchestorai/i);
  assert.doesNotMatch(indexSource, /orchestorai/i);
});
