export type InstanceRuntimeSecretSource = "paperclip_env" | "process_env" | "unset";

export interface InstanceRuntimeSecretStatus {
  envKey: string;
  configured: boolean;
  maskedValue: string | null;
  source: InstanceRuntimeSecretSource;
}

export interface InstanceRuntimeSettings {
  envFilePath: string;
  restartRequired: boolean;
  secrets: {
    slackBotToken: InstanceRuntimeSecretStatus;
    slackAppToken: InstanceRuntimeSecretStatus;
    betterAuthSecret: InstanceRuntimeSecretStatus;
  };
}
