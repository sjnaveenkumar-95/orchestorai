import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";

function isNonEmpty(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function findLegacyConfigFromAncestors(startDir) {
  let currentDir = path.resolve(startDir);
  while (true) {
    const candidate = path.resolve(currentDir, ".paperclip", "config.json");
    if (fs.existsSync(candidate)) {
      return candidate;
    }
    const nextDir = path.resolve(currentDir, "..");
    if (nextDir === currentDir) {
      break;
    }
    currentDir = nextDir;
  }
  return null;
}

export function resolvePaperclipEnvPath({ cwd = process.cwd(), env = process.env } = {}) {
  const explicitEnvPath = env.PAPERCLIP_ENV_FILE;
  if (isNonEmpty(explicitEnvPath)) {
    return path.resolve(explicitEnvPath.trim());
  }

  const configPath = env.PAPERCLIP_CONFIG;
  if (isNonEmpty(configPath)) {
    return path.resolve(path.dirname(configPath.trim()), ".env");
  }

  const paperclipHome = env.PAPERCLIP_HOME;
  if (isNonEmpty(paperclipHome)) {
    const instanceId = isNonEmpty(env.PAPERCLIP_INSTANCE_ID) ? env.PAPERCLIP_INSTANCE_ID.trim() : "default";
    return path.resolve(paperclipHome.trim(), "instances", instanceId, ".env");
  }

  const legacyConfig = findLegacyConfigFromAncestors(cwd);
  if (legacyConfig) {
    return path.resolve(path.dirname(legacyConfig), ".env");
  }

  return null;
}

export function loadPaperclipEnvIntoProcess({
  cwd = process.cwd(),
  env = process.env,
  keys = [],
} = {}) {
  const envPath = resolvePaperclipEnvPath({ cwd, env });
  if (!envPath || !fs.existsSync(envPath)) {
    return null;
  }

  const parsed = dotenv.parse(fs.readFileSync(envPath, "utf8"));
  const keyFilter = new Set(keys);
  const loadedKeys = [];

  for (const [key, rawValue] of Object.entries(parsed)) {
    if (keyFilter.size > 0 && !keyFilter.has(key)) {
      continue;
    }
    if (!isNonEmpty(rawValue)) {
      continue;
    }
    env[key] = rawValue.trim();
    loadedKeys.push(key);
  }

  return {
    envPath,
    loadedKeys,
  };
}
