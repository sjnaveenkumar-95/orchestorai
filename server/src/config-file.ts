import fs from "node:fs";
import { orchestoraiConfigSchema, type OrchestorAIConfig } from "@orchestorai/shared";
import { resolveOrchestorAIConfigPath } from "./paths.js";

export function readConfigFile(): OrchestorAIConfig | null {
  const configPath = resolveOrchestorAIConfigPath();

  if (!fs.existsSync(configPath)) return null;

  try {
    const raw = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    return orchestoraiConfigSchema.parse(raw);
  } catch {
    return null;
  }
}
