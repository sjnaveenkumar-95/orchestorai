import { pathToFileURL } from "node:url";
import { createModelAdapter } from "../../slack-agent-core/src/index.js";
import { SlackRuntime } from "../../slack-bot/src/slack-runtime.js";
import { loadConfig } from "./config.js";

export { channelBotOwnsChannelType } from "./slack-runtime.js";
export { loadConfig } from "./config.js";

export async function startSlackChannelBot(options = {}) {
  const cwd = options.cwd || process.cwd();
  const { config, configPath } = loadConfig(cwd, options);
  const modelAdapter = options.modelAdapter || createModelAdapter(config.model);
  const runtime = new SlackRuntime({
    config,
    configPath,
    codex: modelAdapter,
  });
  await runtime.start();
  return runtime;
}

async function main() {
  await startSlackChannelBot();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    const reason = err instanceof Error ? err.message : String(err);
    console.error(`startup failed: ${reason}`);
    process.exit(1);
  });
}
