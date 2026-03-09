import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parse as parseEnvFileContents } from "dotenv";
import { resolveOrchestorAIEnvPath } from "./paths.js";

function isNonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function renderEnvFile(entries: Record<string, string>) {
  return [
    "# OrchestorAI environment variables",
    ...Object.entries(entries).map(([key, value]) => `${key}=${value}`),
    "",
  ].join("\n");
}

export function readOrchestorAIEnvEntries(filePath = resolveOrchestorAIEnvPath()): Record<string, string> {
  if (!existsSync(filePath)) {
    return {};
  }

  try {
    return parseEnvFileContents(readFileSync(filePath, "utf-8"));
  } catch {
    return {};
  }
}

export function loadOrchestorAIEnvFile(
  options: {
    filePath?: string;
    overrideKeys?: string[];
  } = {},
): { filePath: string; loadedKeys: string[] } | null {
  const filePath = options.filePath ?? resolveOrchestorAIEnvPath();
  if (!existsSync(filePath)) {
    return null;
  }

  const entries = readOrchestorAIEnvEntries(filePath);
  const overrideKeys = new Set(options.overrideKeys ?? []);
  const loadedKeys: string[] = [];

  for (const [key, rawValue] of Object.entries(entries)) {
    if (!isNonEmpty(rawValue)) {
      continue;
    }
    const value = rawValue.trim();
    if (overrideKeys.has(key) || !isNonEmpty(process.env[key])) {
      process.env[key] = value;
      loadedKeys.push(key);
    }
  }

  return { filePath, loadedKeys };
}

export function writeOrchestorAIEnvEntries(
  nextEntries: Record<string, string>,
  filePath = resolveOrchestorAIEnvPath(),
): void {
  const current = readOrchestorAIEnvEntries(filePath);
  const merged = { ...current };

  for (const [key, rawValue] of Object.entries(nextEntries)) {
    if (!isNonEmpty(rawValue)) {
      continue;
    }
    merged[key] = rawValue.trim();
  }

  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, renderEnvFile(merged), { mode: 0o600 });
}
