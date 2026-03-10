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
  | "slackInterpreterEnabled"
  | "slackInterpreterModel"
  | "slackInterpreterProfile"
  | "slackInterpreterWorkdir"
  | "slackInterpreterTimeoutSec"
  | "slackInterpreterContextLimit"
  | "slackAgentMappingsJson"
  | "slackProjectMappingsJson";

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
  slackInterpreterEnabled: "SLACK_INTERPRETER_ENABLED",
  slackInterpreterModel: "SLACK_INTERPRETER_MODEL",
  slackInterpreterProfile: "SLACK_INTERPRETER_PROFILE",
  slackInterpreterWorkdir: "SLACK_INTERPRETER_WORKDIR",
  slackInterpreterTimeoutSec: "SLACK_INTERPRETER_TIMEOUT_SEC",
  slackInterpreterContextLimit: "SLACK_INTERPRETER_CONTEXT_LIMIT",
  slackAgentMappingsJson: "SLACK_AGENT_MAPPINGS_JSON",
  slackProjectMappingsJson: "SLACK_PROJECT_MAPPINGS_JSON",
};

const AUTH_PUBLIC_BASE_URL_ENV_KEY = RUNTIME_VALUE_KEYS.authPublicBaseUrl;
const SLACK_DEFAULT_CHANNEL_MEMBER_IDS_ENV_KEY = RUNTIME_VALUE_KEYS.slackDefaultChannelMemberIds;

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
      slackInterpreterEnabled: resolveSimpleValueStatus(
        envEntries,
        RUNTIME_VALUE_KEYS.slackInterpreterEnabled,
      ),
      slackInterpreterModel: resolveSimpleValueStatus(
        envEntries,
        RUNTIME_VALUE_KEYS.slackInterpreterModel,
      ),
      slackInterpreterProfile: resolveSimpleValueStatus(
        envEntries,
        RUNTIME_VALUE_KEYS.slackInterpreterProfile,
      ),
      slackInterpreterWorkdir: resolveSimpleValueStatus(
        envEntries,
        RUNTIME_VALUE_KEYS.slackInterpreterWorkdir,
      ),
      slackInterpreterTimeoutSec: resolveSimpleValueStatus(
        envEntries,
        RUNTIME_VALUE_KEYS.slackInterpreterTimeoutSec,
      ),
      slackInterpreterContextLimit: resolveSimpleValueStatus(
        envEntries,
        RUNTIME_VALUE_KEYS.slackInterpreterContextLimit,
      ),
      slackAgentMappingsJson: resolveSimpleValueStatus(
        envEntries,
        RUNTIME_VALUE_KEYS.slackAgentMappingsJson,
      ),
      slackProjectMappingsJson: resolveSimpleValueStatus(
        envEntries,
        RUNTIME_VALUE_KEYS.slackProjectMappingsJson,
      ),
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

    if (typeof input.slackInterpreterEnabled === "boolean") {
      nextEntries[RUNTIME_VALUE_KEYS.slackInterpreterEnabled] = input.slackInterpreterEnabled ? "true" : "false";
    }
    if (isNonEmpty(input.slackInterpreterModel)) {
      nextEntries[RUNTIME_VALUE_KEYS.slackInterpreterModel] = input.slackInterpreterModel.trim();
    }
    if (isNonEmpty(input.slackInterpreterProfile)) {
      nextEntries[RUNTIME_VALUE_KEYS.slackInterpreterProfile] = input.slackInterpreterProfile.trim();
    }
    if (isNonEmpty(input.slackInterpreterWorkdir)) {
      nextEntries[RUNTIME_VALUE_KEYS.slackInterpreterWorkdir] = input.slackInterpreterWorkdir.trim();
    }
    if (typeof input.slackInterpreterTimeoutSec === "number") {
      nextEntries[RUNTIME_VALUE_KEYS.slackInterpreterTimeoutSec] = String(input.slackInterpreterTimeoutSec);
    }
    if (typeof input.slackInterpreterContextLimit === "number") {
      nextEntries[RUNTIME_VALUE_KEYS.slackInterpreterContextLimit] = String(input.slackInterpreterContextLimit);
    }
    if (isNonEmpty(input.slackAgentMappingsJson)) {
      nextEntries[RUNTIME_VALUE_KEYS.slackAgentMappingsJson] = input.slackAgentMappingsJson.trim();
    }
    if (isNonEmpty(input.slackProjectMappingsJson)) {
      nextEntries[RUNTIME_VALUE_KEYS.slackProjectMappingsJson] = input.slackProjectMappingsJson.trim();
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
