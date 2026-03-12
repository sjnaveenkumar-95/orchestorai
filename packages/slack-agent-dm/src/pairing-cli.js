#!/usr/bin/env node

import path from "node:path";
import { PairingStore, runPairingCommand } from "slack-agent-core";
import { loadConfig } from "./config.js";

async function main() {
  const { config } = loadConfig(process.cwd());
  const store = new PairingStore(path.resolve(config.runtime.dataDir));
  store.ensureLoaded();

  const exitCode = runPairingCommand({
    store,
    argv: process.argv.slice(2),
  });

  process.exit(exitCode);
}

main().catch((err) => {
  const reason = err instanceof Error ? err.message : String(err);
  console.error(`pairing cli failed: ${reason}`);
  process.exit(1);
});
