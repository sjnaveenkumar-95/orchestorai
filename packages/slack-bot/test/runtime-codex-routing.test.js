import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { buildSlackBotCodexAdapters } from "../src/codex-routing.js";
import { resolveSlackBotCodexAdapter } from "../src/runtime-codex.js";

test("buildSlackBotCodexAdapters keeps the default adapter sandboxed and enables a dangerous DM override", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "slack-bot-codex-"));
  const adapters = buildSlackBotCodexAdapters({
    codex: {
      directMessageSystemPrompt: "DM system prompt",
    },
    model: {
      provider: "codex_cli",
      timeoutMs: 1000,
      systemPrompt: "Channel system prompt",
      workdir: tempRoot,
      codexCli: {
        command: "codex",
        model: "gpt-5.3-codex",
        profile: "",
        reasoningEffort: "",
        sandbox: "workspace-write",
        additionalWritableDirs: [],
      },
    },
  });

  assert.equal(adapters.defaultAdapter.config.codexCli.sandbox, "workspace-write");
  assert.equal(adapters.defaultAdapter.config.systemPrompt, "Channel system prompt");
  assert.equal(adapters.directMessageAdapter.config.codexCli.sandbox, "danger-full-access");
  assert.equal(adapters.directMessageAdapter.config.codexCli.bypassApprovalsAndSandbox, true);
  assert.equal(adapters.directMessageAdapter.config.systemPrompt, "DM system prompt");
});

test("resolveSlackBotCodexAdapter routes direct messages to the DM-specific Codex adapter when one is provided", () => {
  const defaultAdapter = { ensureReady() {}, request() {} };
  const directMessageAdapter = { ensureReady() {}, request() {} };

  assert.equal(resolveSlackBotCodexAdapter({ channelType: "channel", defaultAdapter, directMessageAdapter }), defaultAdapter);
  assert.equal(resolveSlackBotCodexAdapter({ channelType: "group", defaultAdapter, directMessageAdapter }), defaultAdapter);
  assert.equal(resolveSlackBotCodexAdapter({ channelType: "im", defaultAdapter, directMessageAdapter }), directMessageAdapter);
});
