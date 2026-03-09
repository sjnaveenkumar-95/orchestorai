#!/usr/bin/env node
import path from "node:path";
import { spawn } from "node:child_process";

function parseBool(value, fallback = false) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "y", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "n", "off"].includes(normalized)) {
    return false;
  }
  return fallback;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForOrchestorAI(baseUrl, timeoutMs) {
  const startedAt = Date.now();
  const healthUrl = new URL("/api/health", String(baseUrl));

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(healthUrl, {
        headers: {
          Accept: "application/json",
        },
      });
      if (response.ok) {
        return;
      }
    } catch {
      // Server is still starting.
    }
    await sleep(1000);
  }

  throw new Error(`OrchestorAI did not become ready within ${timeoutMs}ms (${healthUrl.toString()})`);
}

const mode = process.argv[2] === "production" ? "production" : "development";
const cwd = process.cwd();
const env = {
  ...process.env,
};

if (!env.CODEX_WORKDIR) {
  env.CODEX_WORKDIR = cwd;
}
if (!env.SLACK_PORT) {
  env.SLACK_PORT = "3000";
}
if (!env.ORCHESTORAI_API_URL) {
  env.ORCHESTORAI_API_URL = `http://127.0.0.1:${env.PORT || "3100"}`;
}
if (!env.DATA_DIR) {
  env.DATA_DIR = env.ORCHESTORAI_HOME
    ? path.join(env.ORCHESTORAI_HOME, "slack-bot", "data")
    : path.join(cwd, "packages", "slack-bot", "data");
}
if (!env.ORCHESTORAI_ENABLED && env.ORCHESTORAI_COMPANY_ID) {
  env.ORCHESTORAI_ENABLED = "true";
}

const pnpmBin = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const children = [];
let stopping = false;

function stopOthers(exceptPid = null) {
  for (const child of children) {
    if (!child || child.pid === exceptPid) {
      continue;
    }
    try {
      child.kill("SIGTERM");
    } catch {
      // Ignore already-exited children.
    }
  }
}

function scheduleExit(code = 0) {
  setTimeout(() => process.exit(code), 1500).unref();
}

function spawnManaged(name, command, args, childEnv = env) {
  const child = spawn(command, args, {
    cwd,
    env: childEnv,
    stdio: "inherit",
  });
  children.push(child);

  child.on("exit", (code, signal) => {
    if (stopping) {
      process.exit(code ?? 0);
      return;
    }
    stopping = true;
    stopOthers(child.pid);
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 0);
  });

  child.on("error", (error) => {
    if (stopping) {
      return;
    }
    stopping = true;
    stopOthers(child.pid);
    console.error(`[stack] ${name} failed to start: ${error.message}`);
    process.exit(1);
  });

  return child;
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    if (stopping) {
      return;
    }
    stopping = true;
    stopOthers();
    scheduleExit(0);
  });
}

async function main() {
  const server =
    mode === "production"
      ? {
          command: process.execPath,
          args: ["cli/node_modules/tsx/dist/cli.mjs", "cli/src/index.ts", "run", "--yes"],
        }
      : {
          command: pnpmBin,
          args: ["--filter", "@orchestorai/server", "dev"],
        };

  spawnManaged("orchestorai-server", server.command, server.args);

  const slackEnabled = parseBool(env.ORCHESTORAI_SLACK_ENABLED, false);
  if (!slackEnabled) {
    console.log("[stack] ORCHESTORAI_SLACK_ENABLED is false; running OrchestorAI only.");
    await new Promise(() => {});
  }

  console.log(`[stack] waiting for OrchestorAI at ${env.ORCHESTORAI_API_URL} before starting Slack bot`);
  await waitForOrchestorAI(env.ORCHESTORAI_API_URL, 120000);
  console.log("[stack] OrchestorAI is ready; starting Slack bot");
  spawnManaged("orchestorai-slack-bot", pnpmBin, ["--filter", "@orchestorai/slack-bot", "start"]);

  await new Promise(() => {});
}

main().catch((error) => {
  if (!stopping) {
    stopping = true;
    stopOthers();
  }
  console.error(`[stack] ${error instanceof Error ? error.message : String(error)}`);
  scheduleExit(1);
});
