import fs from "node:fs";
import path from "node:path";
import { resolveDefaultConfigPath, resolveDefaultEnvPath } from "./home-paths.js";

const ORCHESTORAI_CONFIG_BASENAME = "config.json";
const ORCHESTORAI_ENV_FILENAME = ".env";

function findConfigFileFromAncestors(startDir: string): string | null {
  const absoluteStartDir = path.resolve(startDir);
  let currentDir = absoluteStartDir;

  while (true) {
    const candidate = path.resolve(currentDir, ".orchestorai", ORCHESTORAI_CONFIG_BASENAME);
    if (fs.existsSync(candidate)) {
      return candidate;
    }

    const nextDir = path.resolve(currentDir, "..");
    if (nextDir === currentDir) break;
    currentDir = nextDir;
  }

  return null;
}

export function resolveOrchestorAIConfigPath(overridePath?: string): string {
  if (overridePath) return path.resolve(overridePath);
  if (process.env.ORCHESTORAI_CONFIG) return path.resolve(process.env.ORCHESTORAI_CONFIG);
  return findConfigFileFromAncestors(process.cwd()) ?? resolveDefaultConfigPath();
}

export function resolveOrchestorAIEnvPath(overrideConfigPath?: string): string {
  if (overrideConfigPath) {
    return path.resolve(path.dirname(resolveOrchestorAIConfigPath(overrideConfigPath)), ORCHESTORAI_ENV_FILENAME);
  }
  return resolveDefaultEnvPath();
}
