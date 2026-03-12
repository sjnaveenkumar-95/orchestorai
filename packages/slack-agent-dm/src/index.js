#!/usr/bin/env node

import { pathToFileURL } from "node:url";
import { createModelAdapter } from "slack-agent-core";
import { loadConfig } from "./config.js";
import { SlackDmRuntime } from "./runtime.js";

export { loadConfig } from "./config.js";
export { SlackDmRuntime, dmOwnsChannelType } from "./runtime.js";

export async function startSlackDmBot(options = {}) {
  const cwd = options.cwd || process.cwd();
  const { config, configPath } = loadConfig(cwd);
  const modelAdapter = options.modelAdapter || createModelAdapter(config.model);
  const runtime = new SlackDmRuntime({
    config,
    configPath,
    modelAdapter,
  });
  await runtime.start();
  return runtime;
}

async function main() {
  await startSlackDmBot();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    const reason = err instanceof Error ? err.message : String(err);
    console.error(`startup failed: ${reason}`);
    process.exit(1);
  });
}
