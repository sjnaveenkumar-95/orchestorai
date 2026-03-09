import os from "node:os";
import path from "node:path";

const DEFAULT_INSTANCE_ID = "default";
const INSTANCE_ID_RE = /^[a-zA-Z0-9_-]+$/;
const PATH_SEGMENT_RE = /^[a-zA-Z0-9_-]+$/;

function expandHomePrefix(value: string): string {
  if (value === "~") return os.homedir();
  if (value.startsWith("~/")) return path.resolve(os.homedir(), value.slice(2));
  return value;
}

export function resolveOrchestorAIHomeDir(): string {
  const envHome = process.env.ORCHESTORAI_HOME?.trim();
  if (envHome) return path.resolve(expandHomePrefix(envHome));
  return path.resolve(os.homedir(), ".orchestorai");
}

export function resolveOrchestorAIInstanceId(): string {
  const raw = process.env.ORCHESTORAI_INSTANCE_ID?.trim() || DEFAULT_INSTANCE_ID;
  if (!INSTANCE_ID_RE.test(raw)) {
    throw new Error(`Invalid ORCHESTORAI_INSTANCE_ID '${raw}'.`);
  }
  return raw;
}

export function resolveOrchestorAIInstanceRoot(): string {
  return path.resolve(resolveOrchestorAIHomeDir(), "instances", resolveOrchestorAIInstanceId());
}

export function resolveDefaultConfigPath(): string {
  return path.resolve(resolveOrchestorAIInstanceRoot(), "config.json");
}

export function resolveDefaultEnvPath(): string {
  return path.resolve(resolveOrchestorAIInstanceRoot(), ".env");
}

export function resolveDefaultEmbeddedPostgresDir(): string {
  return path.resolve(resolveOrchestorAIInstanceRoot(), "db");
}

export function resolveDefaultLogsDir(): string {
  return path.resolve(resolveOrchestorAIInstanceRoot(), "logs");
}

export function resolveDefaultSecretsKeyFilePath(): string {
  return path.resolve(resolveOrchestorAIInstanceRoot(), "secrets", "master.key");
}

export function resolveDefaultStorageDir(): string {
  return path.resolve(resolveOrchestorAIInstanceRoot(), "data", "storage");
}

export function resolveDefaultBackupDir(): string {
  return path.resolve(resolveOrchestorAIInstanceRoot(), "data", "backups");
}

export function resolveDefaultAgentWorkspaceDir(agentId: string): string {
  const trimmed = agentId.trim();
  if (!PATH_SEGMENT_RE.test(trimmed)) {
    throw new Error(`Invalid agent id for workspace path '${agentId}'.`);
  }
  return path.resolve(resolveOrchestorAIInstanceRoot(), "workspaces", trimmed);
}

export function resolveHomeAwarePath(value: string): string {
  return path.resolve(expandHomePrefix(value));
}
