import test from "node:test";
import assert from "node:assert/strict";

import { CodexCliModelAdapter, createModelAdapter } from "../src/index.js";
import { buildCodexExecArgs } from "../src/model-adapters/codex-cli.js";

test("createModelAdapter returns the codex cli adapter for codex_cli provider", () => {
  const adapter = createModelAdapter({
    provider: "codex_cli",
    timeoutMs: 1000,
    systemPrompt: "System prompt",
    workdir: process.cwd(),
    codexCli: {
      model: "gpt-5.3-codex",
      profile: "",
      reasoningEffort: "",
      sandbox: "workspace-write",
      additionalWritableDirs: [],
    },
  });

  assert.ok(adapter instanceof CodexCliModelAdapter);
});

test("CodexCliModelAdapter builds a prompt from system prompt, context, and user text", () => {
  const adapter = new CodexCliModelAdapter({
    timeoutMs: 1000,
    systemPrompt: "System prompt",
    workdir: process.cwd(),
    codexCli: {
      model: "gpt-5.3-codex",
      profile: "",
      reasoningEffort: "",
      sandbox: "workspace-write",
      additionalWritableDirs: [],
    },
  });

  const prompt = adapter.buildPrompt({
    instructions: "Follow the instructions",
    context: "Slack history",
    userText: "Do the thing",
  });

  assert.match(prompt, /System prompt/);
  assert.match(prompt, /Follow the instructions/);
  assert.match(prompt, /Slack history/);
  assert.match(prompt, /Do the thing/);
});

test("buildCodexExecArgs includes model reasoning effort when configured", () => {
  const args = buildCodexExecArgs({
    workdir: "/tmp/workspace",
    codexCli: {
      command: "codex",
      model: "gpt-5.3-codex",
      profile: "",
      reasoningEffort: "high",
      sandbox: "workspace-write",
      additionalWritableDirs: [],
    },
    prompt: "Do the thing",
    outputFile: "/tmp/out.txt",
  });

  assert.deepEqual(args, [
    "exec",
    "--skip-git-repo-check",
    "-C",
    "/tmp/workspace",
    "-o",
    "/tmp/out.txt",
    "-s",
    "workspace-write",
    "-m",
    "gpt-5.3-codex",
    "-c",
    'model_reasoning_effort="high"',
    "Do the thing",
  ]);
});

test("buildCodexExecArgs includes the explicit bypass flag when configured", () => {
  const args = buildCodexExecArgs({
    workdir: "/tmp/workspace",
    codexCli: {
      command: "codex",
      model: "gpt-5.3-codex",
      profile: "",
      reasoningEffort: "",
      sandbox: "danger-full-access",
      bypassApprovalsAndSandbox: true,
      additionalWritableDirs: [],
    },
    prompt: "Do the thing",
    outputFile: "/tmp/out.txt",
  });

  assert.deepEqual(args, [
    "exec",
    "--skip-git-repo-check",
    "-C",
    "/tmp/workspace",
    "-o",
    "/tmp/out.txt",
    "-s",
    "danger-full-access",
    "--dangerously-bypass-approvals-and-sandbox",
    "-m",
    "gpt-5.3-codex",
    "Do the thing",
  ]);
});
