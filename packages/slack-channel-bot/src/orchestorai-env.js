import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";

function isNonEmpty(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function expandHomePrefix(value, env) {
  const homeDir = env.HOME || os.homedir();
  if (value === "~") {
    return homeDir;
  }
  if (value.startsWith("~/")) {
    return path.resolve(homeDir, value.slice(2));
  }
  return value;
}

function resolveOrchestorAIHomeDir(env) {
  const orchestoraiHome = env.ORCHESTORAI_HOME;
  if (isNonEmpty(orchestoraiHome)) {
    return path.resolve(expandHomePrefix(orchestoraiHome.trim(), env));
  }
  return path.resolve(env.HOME || os.homedir(), ".orchestorai");
}

export function resolveOrchestorAIEnvPath({ cwd = process.cwd(), env = process.env } = {}) {
  const explicitEnvPath = env.ORCHESTORAI_ENV_FILE;
  if (isNonEmpty(explicitEnvPath)) {
    return path.resolve(explicitEnvPath.trim());
  }

  const configPath = env.ORCHESTORAI_CONFIG;
  if (isNonEmpty(configPath)) {
    return path.resolve(path.dirname(configPath.trim()), ".env");
  }

  const instanceId = isNonEmpty(env.ORCHESTORAI_INSTANCE_ID) ? env.ORCHESTORAI_INSTANCE_ID.trim() : "default";
  return path.resolve(resolveOrchestorAIHomeDir(env), "instances", instanceId, ".env");
}

export function loadOrchestorAIEnvIntoProcess({
  cwd = process.cwd(),
  env = process.env,
  keys = [],
} = {}) {
  const envPath = resolveOrchestorAIEnvPath({ cwd, env });
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
