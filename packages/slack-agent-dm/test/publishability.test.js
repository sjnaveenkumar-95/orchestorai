import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

test("slack-agent-dm exposes package exports and cli bins for standalone installation", () => {
  const packageJsonPath = path.resolve("packages/slack-agent-dm/package.json");
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));

  assert.equal(packageJson.name, "slack-agent-dm");
  assert.ok(packageJson.exports?.["."]);
  assert.ok(packageJson.bin?.["slack-agent-dm"]);
  assert.ok(packageJson.bin?.["slack-agent-dm-pairing"]);
  assert.ok(packageJson.files?.includes("src"));
  assert.equal(packageJson.publishConfig?.access, "public");
});

test("slack-agent-dm imports shared primitives via package boundaries", () => {
  const files = [
    path.resolve("packages/slack-agent-dm/src/index.js"),
    path.resolve("packages/slack-agent-dm/src/config.js"),
    path.resolve("packages/slack-agent-dm/src/runtime.js"),
    path.resolve("packages/slack-agent-dm/src/pairing-cli.js"),
  ];

  for (const filePath of files) {
    const source = fs.readFileSync(filePath, "utf8");
    assert.doesNotMatch(source, /\.\.\/\.\.\/slack-agent-core/);
    assert.match(source, /slack-agent-core/);
  }
});
