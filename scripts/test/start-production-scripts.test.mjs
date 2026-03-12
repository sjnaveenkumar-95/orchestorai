import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..", "..");
const startProductionServiceScript = path.join(rootDir, "scripts", "start-production-service.sh");
const startProductionTerminalsScript = path.join(rootDir, "scripts", "start-production-terminals.sh");

function createTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeExecutable(filePath, contents) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents, { encoding: "utf8", mode: 0o755 });
}

function createStubBin(commands) {
  const binDir = createTempDir("orchestorai-script-bin-");
  for (const [name, contents] of Object.entries(commands)) {
    writeExecutable(path.join(binDir, name), contents);
  }
  return binDir;
}

function runScript(scriptPath, args, env) {
  return spawnSync("bash", [scriptPath, ...args], {
    cwd: rootDir,
    env,
    encoding: "utf8",
  });
}

async function waitForMatch(filePath, pattern, timeoutMs = 5000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (fs.existsSync(filePath)) {
      const contents = fs.readFileSync(filePath, "utf8");
      if (pattern.test(contents)) {
        return contents;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  const contents = fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : "";
  throw new Error(`Timed out waiting for ${pattern} in log file.\nCurrent contents:\n${contents}`);
}

function waitForExit(child) {
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
}

test("start-production-service skips the build when ORCHESTORAI_SKIP_BUILD is enabled", () => {
  const logFile = path.join(createTempDir("orchestorai-script-log-"), "pnpm.log");
  const binDir = createStubBin({
    pnpm: `#!/usr/bin/env bash
set -euo pipefail
printf 'pnpm %s\\n' "$*" >>"$TEST_LOG"
`,
  });

  const result = runScript(startProductionServiceScript, ["backend"], {
    ...process.env,
    PATH: `${binDir}:${process.env.PATH || ""}`,
    TEST_LOG: logFile,
    ORCHESTORAI_SKIP_BUILD: "true",
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /skipping workspace build/i);

  const lines = fs.readFileSync(logFile, "utf8").trim().split("\n");
  assert.deepEqual(lines, ["pnpm --filter @orchestorai/server exec tsx dist/index.js"]);
});

test("start-production-service maps slack-channel env into DM model env when starting slack-dm", () => {
  const tempRoot = createTempDir("orchestorai-slack-dm-env-");
  const logFile = path.join(tempRoot, "pnpm.log");
  const slackEnvPath = path.join(tempRoot, "slack-channel.env");
  fs.writeFileSync(
    slackEnvPath,
    [
      "SLACK_BOT_TOKEN=xoxb-test-token",
      "SLACK_APP_TOKEN=xapp-1-A0TESTAPP-abc",
      "CODEX_MODEL=gpt-5.3-codex",
      "CODEX_THINKING=medium",
      "CODEX_WORKDIR=../workspace",
      "CODEX_SANDBOX=danger-full-access",
      "CODEX_TIMEOUT_MS=1234",
      "CODEX_SYSTEM_PROMPT=You are Codex. Reply concisely and helpfully.",
      "DATA_DIR=./channel-data",
    ].join("\n") + "\n",
    "utf8",
  );

  const binDir = createStubBin({
    pnpm: `#!/usr/bin/env bash
set -euo pipefail
printf 'ARGS:%s\\n' "$*" >>"$TEST_LOG"
for key in SLACK_BOT_TOKEN SLACK_APP_TOKEN MODEL_PROVIDER MODEL_CODEX_MODEL MODEL_CODEX_THINKING MODEL_CODEX_SANDBOX MODEL_TIMEOUT_MS MODEL_WORKDIR MODEL_SYSTEM_PROMPT DATA_DIR; do
  eval "value=\\${"${"}$key-}"
  printf '%s=%s\\n' "$key" "$value" >>"$TEST_LOG"
done
`,
  });

  const result = runScript(startProductionServiceScript, ["slack-dm"], {
    ...process.env,
    PATH: `${binDir}:${process.env.PATH || ""}`,
    TEST_LOG: logFile,
    ORCHESTORAI_SKIP_BUILD: "true",
    SLACK_CHANNEL_BOT_ENV_FILE: slackEnvPath,
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const output = fs.readFileSync(logFile, "utf8");

  assert.match(output, /ARGS:--filter slack-agent-dm start/);
  assert.match(output, /^SLACK_BOT_TOKEN=xoxb-test-token$/m);
  assert.match(output, /^SLACK_APP_TOKEN=xapp-1-A0TESTAPP-abc$/m);
  assert.match(output, /^MODEL_PROVIDER=codex_cli$/m);
  assert.match(output, /^MODEL_CODEX_MODEL=gpt-5\.3-codex$/m);
  assert.match(output, /^MODEL_CODEX_THINKING=medium$/m);
  assert.match(output, /^MODEL_CODEX_SANDBOX=danger-full-access$/m);
  assert.match(output, /^MODEL_TIMEOUT_MS=1234$/m);
  assert.match(output, /^MODEL_SYSTEM_PROMPT=You are Codex\. Reply concisely and helpfully\.$/m);
  assert.match(output, new RegExp(`^MODEL_WORKDIR=${path.resolve(tempRoot, "..", "workspace").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "m"));
  assert.match(
    output,
    new RegExp(
      `^DATA_DIR=${path.resolve(rootDir, "packages", "slack-agent-dm", "data").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,
      "m",
    ),
  );
});

test("start-production-service launches the combined OrchestorAI Slack bot", () => {
  const logFile = path.join(createTempDir("orchestorai-script-log-"), "pnpm.log");
  const binDir = createStubBin({
    pnpm: `#!/usr/bin/env bash
set -euo pipefail
printf 'pnpm %s\\n' "$*" >>"$TEST_LOG"
`,
  });

  const result = runScript(startProductionServiceScript, ["slack-bot"], {
    ...process.env,
    PATH: `${binDir}:${process.env.PATH || ""}`,
    TEST_LOG: logFile,
    ORCHESTORAI_SKIP_BUILD: "true",
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);

  const lines = fs.readFileSync(logFile, "utf8").trim().split("\n");
  assert.deepEqual(lines, ["pnpm --filter @orchestorai/slack-bot start"]);
});

test("start-production-service exports the OrchestorAI API URL to the frontend preview proxy", () => {
  const tempRoot = createTempDir("orchestorai-frontend-env-");
  const logFile = path.join(tempRoot, "pnpm.log");
  const orchestoraiEnvPath = path.join(tempRoot, "orchestorai.env");
  fs.writeFileSync(orchestoraiEnvPath, "ORCHESTORAI_API_URL=http://127.0.0.1:3101\n", "utf8");

  const binDir = createStubBin({
    pnpm: `#!/usr/bin/env bash
set -euo pipefail
printf 'ARGS:%s\\n' "$*" >>"$TEST_LOG"
printf 'VITE_API_PROXY_TARGET=%s\\n' "\${VITE_API_PROXY_TARGET-}" >>"$TEST_LOG"
printf 'ORCHESTORAI_API_URL=%s\\n' "\${ORCHESTORAI_API_URL-}" >>"$TEST_LOG"
`,
  });

  const result = runScript(startProductionServiceScript, ["frontend"], {
    ...process.env,
    PATH: `${binDir}:${process.env.PATH || ""}`,
    TEST_LOG: logFile,
    ORCHESTORAI_SKIP_BUILD: "true",
    ORCHESTORAI_ENV_FILE: orchestoraiEnvPath,
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const output = fs.readFileSync(logFile, "utf8");

  assert.match(output, /ARGS:--filter @orchestorai\/ui preview --host 0\.0\.0\.0 --port 4173/);
  assert.match(output, /^ORCHESTORAI_API_URL=http:\/\/127\.0\.0\.1:3101$/m);
  assert.match(output, /^VITE_API_PROXY_TARGET=http:\/\/127\.0\.0\.1:3101$/m);
});

test("start-production-terminals builds once and opens one Terminal session per production service", () => {
  const tempRoot = createTempDir("orchestorai-start-terminals-");
  const logFile = path.join(tempRoot, "commands.log");
  const binDir = createStubBin({
    pnpm: `#!/usr/bin/env bash
set -euo pipefail
printf 'PNPM:%s\\n' "$*" >>"$TEST_LOG"
`,
    osascript: `#!/usr/bin/env bash
set -euo pipefail
printf 'OSA:%s\\n' "$*" >>"$TEST_LOG"
cat >/dev/null
`,
    uname: `#!/usr/bin/env bash
echo Darwin
`,
    sleep: `#!/usr/bin/env bash
exit 0
`,
  });

  const result = runScript(startProductionTerminalsScript, [], {
    ...process.env,
    PATH: `${binDir}:${process.env.PATH || ""}`,
    TEST_LOG: logFile,
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);

  const lines = fs.readFileSync(logFile, "utf8").trim().split("\n");
  assert.equal(lines[0], "PNPM:build");
  assert.equal(lines.length, 4);

  for (const target of ["backend", "frontend", "slack-bot"]) {
    const line = lines.find((entry) => entry.includes(`start-production-service.sh ${target}`));
    assert.ok(line, `missing terminal launch for ${target}`);
    assert.match(line, /ORCHESTORAI_SKIP_BUILD=true/);
  }
});

test("run-stack starts the combined OrchestorAI Slack bot when Slack is enabled", async (t) => {
  const tempRoot = createTempDir("orchestorai-run-stack-");
  const logFile = path.join(tempRoot, "pnpm.log");
  const slackEnvPath = path.join(tempRoot, "missing-slack.env");
  const orchestoraiEnvPath = path.join(tempRoot, "missing-orchestorai.env");
  const binDir = createStubBin({
    pnpm: `#!/usr/bin/env bash
set -euo pipefail
printf 'PNPM:%s\\n' "$*" >>"$TEST_LOG"
trap 'exit 0' TERM INT
while true; do
  sleep 1
done
`,
  });

  const server = http.createServer((req, res) => {
    if (req.url === "/api/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end('{"ok":true}');
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const apiUrl = `http://127.0.0.1:${address.port}`;

  const child = spawn("node", [path.join(rootDir, "scripts", "run-stack.mjs")], {
    cwd: rootDir,
    env: {
      ...process.env,
      PATH: `${binDir}:${process.env.PATH || ""}`,
      TEST_LOG: logFile,
      ORCHESTORAI_SLACK_ENABLED: "true",
      ORCHESTORAI_API_URL: apiUrl,
      SLACK_CHANNEL_BOT_ENV_FILE: slackEnvPath,
      ORCHESTORAI_ENV_FILE: orchestoraiEnvPath,
    },
    stdio: "ignore",
  });
  const childExit = waitForExit(child);

  t.after(async () => {
    server.close();
    if (!child.killed) {
      child.kill("SIGTERM");
    }
    await childExit.catch(() => {});
  });

  await waitForMatch(logFile, /PNPM:--filter @orchestorai\/server dev/);
  await waitForMatch(logFile, /PNPM:--filter @orchestorai\/slack-bot start/);

  child.kill("SIGTERM");
  const exit = await childExit;
  assert.equal(exit.code, 0);
});
