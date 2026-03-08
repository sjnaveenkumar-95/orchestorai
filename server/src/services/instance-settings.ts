import type { InstanceRuntimeSecretStatus, InstanceRuntimeSettings, UpdateInstanceRuntimeSettings } from "@paperclipai/shared";
import { resolvePaperclipEnvPath } from "../paths.js";
import { readPaperclipEnvEntries, writePaperclipEnvEntries } from "../paperclip-env.js";

const RUNTIME_SECRET_KEYS = {
  slackBotToken: "SLACK_BOT_TOKEN",
  slackAppToken: "SLACK_APP_TOKEN",
  betterAuthSecret: "BETTER_AUTH_SECRET",
} as const satisfies Record<keyof UpdateInstanceRuntimeSettings, string>;

type RuntimeSecretField = keyof typeof RUNTIME_SECRET_KEYS;

function isNonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function maskSecretValue(envKey: string, value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }

  if (envKey === "SLACK_BOT_TOKEN" || envKey === "SLACK_APP_TOKEN") {
    const dashIndex = trimmed.indexOf("-");
    const prefix = dashIndex >= 0 ? trimmed.slice(0, dashIndex + 1) : "";
    const suffix = trimmed.slice(-4);
    const maskLength = Math.max(4, trimmed.length - prefix.length - suffix.length);
    return `${prefix}${"*".repeat(maskLength)}${suffix}`;
  }

  const suffix = trimmed.slice(-4);
  const maskLength = Math.max(8, trimmed.length - suffix.length);
  return `${"*".repeat(maskLength)}${suffix}`;
}

function resolveSecretStatus(
  envEntries: Record<string, string>,
  field: RuntimeSecretField,
): InstanceRuntimeSecretStatus {
  const envKey = RUNTIME_SECRET_KEYS[field];
  const fileValue = envEntries[envKey];
  if (isNonEmpty(fileValue)) {
    return {
      envKey,
      configured: true,
      maskedValue: maskSecretValue(envKey, fileValue),
      source: "paperclip_env",
    };
  }

  const processValue = process.env[envKey];
  if (isNonEmpty(processValue)) {
    return {
      envKey,
      configured: true,
      maskedValue: maskSecretValue(envKey, processValue),
      source: "process_env",
    };
  }

  return {
    envKey,
    configured: false,
    maskedValue: null,
    source: "unset",
  };
}

export function createInstanceSettingsService(options: { envFilePath?: string } = {}) {
  const envFilePath = options.envFilePath ?? resolvePaperclipEnvPath();

  function getRuntimeSettings(): InstanceRuntimeSettings {
    const envEntries = readPaperclipEnvEntries(envFilePath);
    return {
      envFilePath,
      restartRequired: true,
      secrets: {
        slackBotToken: resolveSecretStatus(envEntries, "slackBotToken"),
        slackAppToken: resolveSecretStatus(envEntries, "slackAppToken"),
        betterAuthSecret: resolveSecretStatus(envEntries, "betterAuthSecret"),
      },
    };
  }

  function updateRuntimeSettings(input: UpdateInstanceRuntimeSettings): InstanceRuntimeSettings {
    const nextEntries: Record<string, string> = {};

    for (const [field, envKey] of Object.entries(RUNTIME_SECRET_KEYS) as [RuntimeSecretField, string][]) {
      const value = input[field];
      if (!isNonEmpty(value)) {
        continue;
      }
      nextEntries[envKey] = value.trim();
    }

    writePaperclipEnvEntries(nextEntries, envFilePath);
    return getRuntimeSettings();
  }

  return {
    getRuntimeSettings,
    updateRuntimeSettings,
  };
}
