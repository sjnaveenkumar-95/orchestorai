import { pathToFileURL } from "node:url";
import { loadConfig } from "@orchestorai/slack-channel-bot";
import { buildSlackBotCodexAdapters, buildSlackBotDirectMessageModel } from "./codex-routing.js";
import { SlackRuntime } from "./slack-runtime.js";

export { buildSlackBotCodexAdapters, buildSlackBotDirectMessageModel } from "./codex-routing.js";

export async function startSlackBot(options = {}) {
  const cwd = options.cwd || process.cwd();
  const { config, configPath } = loadConfig(cwd, {
    ...options,
    allowDirectMessages: true,
  });
  const { defaultAdapter, directMessageAdapter } = buildSlackBotCodexAdapters(config, options);
  const runtime = new SlackRuntime({
    config,
    configPath,
    codex: defaultAdapter,
    directMessageCodex: directMessageAdapter,
  });
  await runtime.start();
  return runtime;
}

async function main() {
  await startSlackBot({
    cwd: process.cwd(),
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    const reason = err instanceof Error ? err.message : String(err);
    console.error(`startup failed: ${reason}`);
    process.exit(1);
  });
}
