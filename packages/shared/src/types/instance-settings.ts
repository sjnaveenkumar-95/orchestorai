export type InstanceRuntimeSecretSource = "paperclip_env" | "process_env" | "unset";
export type InstanceRuntimeValueSource = "paperclip_env" | "process_env" | "config_file" | "unset";

export interface InstanceRuntimeSecretStatus {
  envKey: string;
  configured: boolean;
  maskedValue: string | null;
  source: InstanceRuntimeSecretSource;
}

export interface InstanceRuntimeValueStatus {
  envKey: string;
  configured: boolean;
  value: string | null;
  source: InstanceRuntimeValueSource;
}

export interface InstanceRuntimeSettings {
  envFilePath: string;
  restartRequired: boolean;
  authPublicBaseUrl: InstanceRuntimeValueStatus;
  slackDefaultChannelMemberIds: InstanceRuntimeValueStatus;
  secrets: {
    slackBotToken: InstanceRuntimeSecretStatus;
    slackAppToken: InstanceRuntimeSecretStatus;
    slackManifestToken: InstanceRuntimeSecretStatus;
    slackSigningSecret: InstanceRuntimeSecretStatus;
    betterAuthSecret: InstanceRuntimeSecretStatus;
  };
}
