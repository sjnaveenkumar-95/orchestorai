import path from "node:path";

export interface BridgeConfig {
  host: string;
  port: number;
  slackSigningSecret: string;
  slackBotToken: string;
  paperclipApiUrl: string;
  paperclipApiToken: string | null;
  defaultCompanyId: string | null;
  outboundToken: string | null;
  stateFile: string;
}

function requireNonEmpty(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable ${key}`);
  }
  return value;
}

function optionalNonEmpty(env: NodeJS.ProcessEnv, key: string): string | null {
  const value = env[key]?.trim();
  return value ? value : null;
}

function parsePort(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? "3190", 10);
  if (!Number.isFinite(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error(`Invalid PORT value: ${value ?? ""}`);
  }
  return parsed;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): BridgeConfig {
  const configuredStateFile = optionalNonEmpty(env, "SLACK_BRIDGE_STATE_FILE");
  return {
    host: optionalNonEmpty(env, "HOST") ?? "127.0.0.1",
    port: parsePort(env.PORT),
    slackSigningSecret: requireNonEmpty(env, "SLACK_SIGNING_SECRET"),
    slackBotToken: requireNonEmpty(env, "SLACK_BOT_TOKEN"),
    paperclipApiUrl: requireNonEmpty(env, "PAPERCLIP_API_URL").replace(/\/+$/, ""),
    paperclipApiToken: optionalNonEmpty(env, "PAPERCLIP_API_TOKEN"),
    defaultCompanyId: optionalNonEmpty(env, "PAPERCLIP_DEFAULT_COMPANY_ID"),
    outboundToken: optionalNonEmpty(env, "SLACK_BRIDGE_OUTBOUND_TOKEN"),
    stateFile: configuredStateFile
      ? path.resolve(configuredStateFile)
      : path.resolve(process.cwd(), ".paperclip/slack-bridge-state.json"),
  };
}
