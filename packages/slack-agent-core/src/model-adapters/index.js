import { CodexCliModelAdapter } from "./codex-cli.js";

export function createModelAdapter(config) {
  if (!config || typeof config !== "object") {
    throw new Error("model config is required");
  }

  if (config.provider === "codex_cli") {
    return new CodexCliModelAdapter(config);
  }

  throw new Error(`Unsupported model provider: ${String(config.provider || "unknown")}`);
}

export { CodexCliModelAdapter };
