import type {
  InstanceRuntimeSecretStatus,
  InstanceRuntimeSettings,
  InstanceRuntimeValueStatus,
  UpdateInstanceRuntimeSettings,
} from "@orchestorai/shared";
import { readConfigFile } from "../config-file.js";
import { resolveOrchestorAIEnvPath } from "../paths.js";
import { readOrchestorAIEnvEntries, writeOrchestorAIEnvEntries } from "../orchestorai-env.js";

type RuntimeSecretField =
  | "slackBotToken"
  | "slackAppToken"
  | "slackManifestToken"
  | "slackSigningSecret"
  | "betterAuthSecret";

type RuntimeValueField =
  | "authPublicBaseUrl"
  | "slackDefaultChannelMemberIds"
  | "slackBoardApproverUserIds";

const RUNTIME_SECRET_KEYS: Record<RuntimeSecretField, string> = {
  slackBotToken: "SLACK_BOT_TOKEN",
  slackAppToken: "SLACK_APP_TOKEN",
  slackManifestToken: "SLACK_APP_MANIFEST_TOKEN",
  slackSigningSecret: "SLACK_SIGNING_SECRET",
  betterAuthSecret: "BETTER_AUTH_SECRET",
};

const RUNTIME_VALUE_KEYS: Record<RuntimeValueField, string> = {
  authPublicBaseUrl: "ORCHESTORAI_AUTH_PUBLIC_BASE_URL",
  slackDefaultChannelMemberIds: "SLACK_DEFAULT_CHANNEL_MEMBER_IDS",
  slackBoardApproverUserIds: "SLACK_BOARD_APPROVER_USER_IDS",
};

const AUTH_PUBLIC_BASE_URL_ENV_KEY = RUNTIME_VALUE_KEYS.authPublicBaseUrl;
const SLACK_DEFAULT_CHANNEL_MEMBER_IDS_ENV_KEY = RUNTIME_VALUE_KEYS.slackDefaultChannelMemberIds;
const SLACK_BOARD_APPROVER_USER_IDS_ENV_KEY = RUNTIME_VALUE_KEYS.slackBoardApproverUserIds;

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
      source: "orchestorai_env",
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

function resolveAuthPublicBaseUrlStatus(
  envEntries: Record<string, string>,
): InstanceRuntimeValueStatus {
  const fileValue = envEntries[AUTH_PUBLIC_BASE_URL_ENV_KEY];
  if (isNonEmpty(fileValue)) {
    return {
      envKey: AUTH_PUBLIC_BASE_URL_ENV_KEY,
      configured: true,
      value: fileValue.trim(),
      source: "orchestorai_env",
    };
  }

  const processValue = process.env.ORCHESTORAI_AUTH_PUBLIC_BASE_URL ?? process.env.ORCHESTORAI_PUBLIC_URL;
  if (isNonEmpty(processValue)) {
    return {
      envKey: AUTH_PUBLIC_BASE_URL_ENV_KEY,
      configured: true,
      value: processValue.trim(),
      source: "process_env",
    };
  }

  const configValue = readConfigFile()?.auth?.publicBaseUrl;
  if (isNonEmpty(configValue)) {
    return {
      envKey: AUTH_PUBLIC_BASE_URL_ENV_KEY,
      configured: true,
      value: configValue.trim(),
      source: "config_file",
    };
  }

  return {
    envKey: AUTH_PUBLIC_BASE_URL_ENV_KEY,
    configured: false,
    value: null,
    source: "unset",
  };
}

function resolveSimpleValueStatus(
  envEntries: Record<string, string>,
  envKey: string,
): InstanceRuntimeValueStatus {
  const fileValue = envEntries[envKey];
  if (isNonEmpty(fileValue)) {
    return {
      envKey,
      configured: true,
      value: fileValue.trim(),
      source: "orchestorai_env",
    };
  }

  const processValue = process.env[envKey];
  if (isNonEmpty(processValue)) {
    return {
      envKey,
      configured: true,
      value: processValue.trim(),
      source: "process_env",
    };
  }

  return {
    envKey,
    configured: false,
    value: null,
    source: "unset",
  };
}

function resolveSlackBoardApproverUserIdsStatus(
  envEntries: Record<string, string>,
): InstanceRuntimeValueStatus {
  const direct = resolveSimpleValueStatus(envEntries, SLACK_BOARD_APPROVER_USER_IDS_ENV_KEY);
  if (direct.configured) {
    return direct;
  }

  const fallback = resolveSimpleValueStatus(envEntries, SLACK_DEFAULT_CHANNEL_MEMBER_IDS_ENV_KEY);
  if (fallback.configured) {
    return {
      envKey: SLACK_BOARD_APPROVER_USER_IDS_ENV_KEY,
      configured: true,
      value: fallback.value,
      source: fallback.source,
    };
  }

  return direct;
}

function resolveRuntimeSecretValue(
  envEntries: Record<string, string>,
  field: RuntimeSecretField,
): string | null {
  const envKey = RUNTIME_SECRET_KEYS[field];
  const fileValue = envEntries[envKey];
  if (isNonEmpty(fileValue)) {
    return fileValue.trim();
  }

  const processValue = process.env[envKey];
  if (isNonEmpty(processValue)) {
    return processValue.trim();
  }

  return null;
}

function resolveRuntimeValue(
  envEntries: Record<string, string>,
  field: RuntimeValueField,
): string | null {
  if (field === "authPublicBaseUrl") {
    const fileValue = envEntries[AUTH_PUBLIC_BASE_URL_ENV_KEY];
    if (isNonEmpty(fileValue)) {
      return fileValue.trim();
    }

    const processValue = process.env.ORCHESTORAI_AUTH_PUBLIC_BASE_URL ?? process.env.ORCHESTORAI_PUBLIC_URL;
    if (isNonEmpty(processValue)) {
      return processValue.trim();
    }

    const configValue = readConfigFile()?.auth?.publicBaseUrl;
    if (isNonEmpty(configValue)) {
      return configValue.trim();
    }

    return null;
  }

  if (field === "slackBoardApproverUserIds") {
    const directValue = resolveSimpleValueStatus(envEntries, SLACK_BOARD_APPROVER_USER_IDS_ENV_KEY);
    if (directValue.configured) {
      return directValue.value;
    }

    const fallbackValue = resolveSimpleValueStatus(envEntries, SLACK_DEFAULT_CHANNEL_MEMBER_IDS_ENV_KEY);
    return fallbackValue.configured ? fallbackValue.value : null;
  }

  const envKey = RUNTIME_VALUE_KEYS[field];
  const fileValue = envEntries[envKey];
  if (isNonEmpty(fileValue)) {
    return fileValue.trim();
  }

  const processValue = process.env[envKey];
  if (isNonEmpty(processValue)) {
    return processValue.trim();
  }

  return null;
}

export function createInstanceSettingsService(options: { envFilePath?: string } = {}) {
  const envFilePath = options.envFilePath ?? resolveOrchestorAIEnvPath();

  function getRuntimeSettings(): InstanceRuntimeSettings {
    const envEntries = readOrchestorAIEnvEntries(envFilePath);
    return {
      envFilePath,
      restartRequired: true,
      authPublicBaseUrl: resolveAuthPublicBaseUrlStatus(envEntries),
      slackDefaultChannelMemberIds: resolveSimpleValueStatus(
        envEntries,
        SLACK_DEFAULT_CHANNEL_MEMBER_IDS_ENV_KEY,
      ),
      slackBoardApproverUserIds: resolveSlackBoardApproverUserIdsStatus(envEntries),
      secrets: {
        slackBotToken: resolveSecretStatus(envEntries, "slackBotToken"),
        slackAppToken: resolveSecretStatus(envEntries, "slackAppToken"),
        slackManifestToken: resolveSecretStatus(envEntries, "slackManifestToken"),
        slackSigningSecret: resolveSecretStatus(envEntries, "slackSigningSecret"),
        betterAuthSecret: resolveSecretStatus(envEntries, "betterAuthSecret"),
      },
    };
  }

  function updateRuntimeSettings(input: UpdateInstanceRuntimeSettings): InstanceRuntimeSettings {
    const nextEntries: Record<string, string> = {};

    if (isNonEmpty(input.authPublicBaseUrl)) {
      nextEntries[AUTH_PUBLIC_BASE_URL_ENV_KEY] = input.authPublicBaseUrl.trim();
    }

    if (isNonEmpty(input.slackDefaultChannelMemberIds)) {
      nextEntries[SLACK_DEFAULT_CHANNEL_MEMBER_IDS_ENV_KEY] = input.slackDefaultChannelMemberIds.trim();
    }

    if (isNonEmpty(input.slackBoardApproverUserIds)) {
      nextEntries[SLACK_BOARD_APPROVER_USER_IDS_ENV_KEY] = input.slackBoardApproverUserIds.trim();
    }

    for (const [field, envKey] of Object.entries(RUNTIME_SECRET_KEYS) as [RuntimeSecretField, string][]) {
      const value = input[field];
      if (!isNonEmpty(value)) {
        continue;
      }
      nextEntries[envKey] = value.trim();
    }

    writeOrchestorAIEnvEntries(nextEntries, envFilePath);
    return getRuntimeSettings();
  }

  return {
    getRuntimeSettings,
    getRuntimeSecretValue(field: RuntimeSecretField) {
      const envEntries = readOrchestorAIEnvEntries(envFilePath);
      return resolveRuntimeSecretValue(envEntries, field);
    },
    getRuntimeValue(field: RuntimeValueField) {
      const envEntries = readOrchestorAIEnvEntries(envFilePath);
      return resolveRuntimeValue(envEntries, field);
    },
    updateRuntimeSettings,
  };
}
