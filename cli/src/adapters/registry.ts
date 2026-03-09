import type { CLIAdapterModule } from "@orchestorai/adapter-utils";
import { printClaudeStreamEvent } from "@orchestorai/adapter-claude-local/cli";
import { printCodexStreamEvent } from "@orchestorai/adapter-codex-local/cli";
import { printOpenClawStreamEvent } from "@orchestorai/adapter-openclaw/cli";
import { processCLIAdapter } from "./process/index.js";
import { httpCLIAdapter } from "./http/index.js";

const claudeLocalCLIAdapter: CLIAdapterModule = {
  type: "claude_local",
  formatStdoutEvent: printClaudeStreamEvent,
};

const codexLocalCLIAdapter: CLIAdapterModule = {
  type: "codex_local",
  formatStdoutEvent: printCodexStreamEvent,
};

const openclawCLIAdapter: CLIAdapterModule = {
  type: "openclaw",
  formatStdoutEvent: printOpenClawStreamEvent,
};

const adaptersByType = new Map<string, CLIAdapterModule>(
  [claudeLocalCLIAdapter, codexLocalCLIAdapter, openclawCLIAdapter, processCLIAdapter, httpCLIAdapter].map((a) => [a.type, a]),
);

export function getCLIAdapter(type: string): CLIAdapterModule {
  return adaptersByType.get(type) ?? processCLIAdapter;
}
