import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createInstanceSettingsService } from "../services/instance-settings.ts";

const ORIGINAL_SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;
const ORIGINAL_SLACK_APP_TOKEN = process.env.SLACK_APP_TOKEN;
const ORIGINAL_SLACK_MANIFEST_TOKEN = process.env.SLACK_APP_MANIFEST_TOKEN;
const ORIGINAL_SLACK_SIGNING_SECRET = process.env.SLACK_SIGNING_SECRET;
const ORIGINAL_ORCHESTORAI_AUTH_PUBLIC_BASE_URL = process.env.ORCHESTORAI_AUTH_PUBLIC_BASE_URL;
const ORIGINAL_ORCHESTORAI_PUBLIC_URL = process.env.ORCHESTORAI_PUBLIC_URL;
const ORIGINAL_SLACK_BOARD_APPROVER_USER_IDS = process.env.SLACK_BOARD_APPROVER_USER_IDS;
const ORIGINAL_SLACK_DEFAULT_CHANNEL_MEMBER_IDS = process.env.SLACK_DEFAULT_CHANNEL_MEMBER_IDS;
const ORIGINAL_ORCHESTORAI_CONFIG = process.env.ORCHESTORAI_CONFIG;
const ORIGINAL_ORCHESTORAI_HOME = process.env.ORCHESTORAI_HOME;
const ORIGINAL_ORCHESTORAI_INSTANCE_ID = process.env.ORCHESTORAI_INSTANCE_ID;
const ORIGINAL_BETTER_AUTH_SECRET = process.env.BETTER_AUTH_SECRET;

afterEach(() => {
  if (ORIGINAL_SLACK_BOT_TOKEN === undefined) delete process.env.SLACK_BOT_TOKEN;
  else process.env.SLACK_BOT_TOKEN = ORIGINAL_SLACK_BOT_TOKEN;

  if (ORIGINAL_SLACK_APP_TOKEN === undefined) delete process.env.SLACK_APP_TOKEN;
  else process.env.SLACK_APP_TOKEN = ORIGINAL_SLACK_APP_TOKEN;

  if (ORIGINAL_SLACK_MANIFEST_TOKEN === undefined) delete process.env.SLACK_APP_MANIFEST_TOKEN;
  else process.env.SLACK_APP_MANIFEST_TOKEN = ORIGINAL_SLACK_MANIFEST_TOKEN;

  if (ORIGINAL_SLACK_SIGNING_SECRET === undefined) delete process.env.SLACK_SIGNING_SECRET;
  else process.env.SLACK_SIGNING_SECRET = ORIGINAL_SLACK_SIGNING_SECRET;

  if (ORIGINAL_ORCHESTORAI_AUTH_PUBLIC_BASE_URL === undefined) delete process.env.ORCHESTORAI_AUTH_PUBLIC_BASE_URL;
  else process.env.ORCHESTORAI_AUTH_PUBLIC_BASE_URL = ORIGINAL_ORCHESTORAI_AUTH_PUBLIC_BASE_URL;

  if (ORIGINAL_ORCHESTORAI_PUBLIC_URL === undefined) delete process.env.ORCHESTORAI_PUBLIC_URL;
  else process.env.ORCHESTORAI_PUBLIC_URL = ORIGINAL_ORCHESTORAI_PUBLIC_URL;

  if (ORIGINAL_SLACK_BOARD_APPROVER_USER_IDS === undefined) delete process.env.SLACK_BOARD_APPROVER_USER_IDS;
  else process.env.SLACK_BOARD_APPROVER_USER_IDS = ORIGINAL_SLACK_BOARD_APPROVER_USER_IDS;

  if (ORIGINAL_SLACK_DEFAULT_CHANNEL_MEMBER_IDS === undefined) delete process.env.SLACK_DEFAULT_CHANNEL_MEMBER_IDS;
  else process.env.SLACK_DEFAULT_CHANNEL_MEMBER_IDS = ORIGINAL_SLACK_DEFAULT_CHANNEL_MEMBER_IDS;

  if (ORIGINAL_ORCHESTORAI_CONFIG === undefined) delete process.env.ORCHESTORAI_CONFIG;
  else process.env.ORCHESTORAI_CONFIG = ORIGINAL_ORCHESTORAI_CONFIG;

  if (ORIGINAL_ORCHESTORAI_HOME === undefined) delete process.env.ORCHESTORAI_HOME;
  else process.env.ORCHESTORAI_HOME = ORIGINAL_ORCHESTORAI_HOME;

  if (ORIGINAL_ORCHESTORAI_INSTANCE_ID === undefined) delete process.env.ORCHESTORAI_INSTANCE_ID;
  else process.env.ORCHESTORAI_INSTANCE_ID = ORIGINAL_ORCHESTORAI_INSTANCE_ID;

  if (ORIGINAL_BETTER_AUTH_SECRET === undefined) delete process.env.BETTER_AUTH_SECRET;
  else process.env.BETTER_AUTH_SECRET = ORIGINAL_BETTER_AUTH_SECRET;
});

describe("createInstanceSettingsService", () => {
  it("reads configured secrets from the OrchestorAI env file", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "orchestorai-instance-settings-"));
    const envFilePath = path.join(tmpDir, ".env");
    fs.writeFileSync(
      envFilePath,
      [
        "SLACK_BOT_TOKEN=xoxb-1234567890-abcd",
        "SLACK_APP_TOKEN=xapp-1-abcd-efgh",
        "SLACK_APP_MANIFEST_TOKEN=xoxe.xoxp-manifest-token",
        "SLACK_SIGNING_SECRET=signing-secret-value",
        "ORCHESTORAI_AUTH_PUBLIC_BASE_URL=https://orchestorai.example.com",
        "SLACK_BOARD_APPROVER_USER_IDS=U12345,U67890",
        "BETTER_AUTH_SECRET=super-secret-value",
        "",
      ].join("\n"),
    );

    process.env.ORCHESTORAI_CONFIG = path.join(tmpDir, "missing-config.json");
    const svc = createInstanceSettingsService({ envFilePath });
    const result = svc.getRuntimeSettings();

    expect(result.envFilePath).toBe(envFilePath);
    expect(result.authPublicBaseUrl.configured).toBe(true);
    expect(result.authPublicBaseUrl.source).toBe("orchestorai_env");
    expect(result.authPublicBaseUrl.value).toBe("https://orchestorai.example.com");
    expect(result.slackBoardApproverUserIds.configured).toBe(true);
    expect(result.slackBoardApproverUserIds.source).toBe("orchestorai_env");
    expect(result.slackBoardApproverUserIds.value).toBe("U12345,U67890");
    expect(result.secrets.slackBotToken.configured).toBe(true);
    expect(result.secrets.slackBotToken.source).toBe("orchestorai_env");
    expect(result.secrets.slackBotToken.maskedValue).toMatch(/^xoxb-\*+abcd$/);
    expect(result.secrets.slackAppToken.configured).toBe(true);
    expect(result.secrets.slackAppToken.source).toBe("orchestorai_env");
    expect(result.secrets.slackManifestToken.configured).toBe(true);
    expect(result.secrets.slackManifestToken.source).toBe("orchestorai_env");
    expect(result.secrets.slackSigningSecret.configured).toBe(true);
    expect(result.secrets.slackSigningSecret.source).toBe("orchestorai_env");
    expect(result.secrets.betterAuthSecret.configured).toBe(true);
    expect(result.secrets.betterAuthSecret.source).toBe("orchestorai_env");
  });

  it("falls back to process env when the instance env file does not contain a value", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "orchestorai-instance-settings-"));
    const envFilePath = path.join(tmpDir, ".env");
    process.env.SLACK_BOT_TOKEN = "xoxb-process-token";
    process.env.ORCHESTORAI_AUTH_PUBLIC_BASE_URL = "https://runtime.orchestorai.example.com";
    process.env.SLACK_BOARD_APPROVER_USER_IDS = "U99999";
    process.env.ORCHESTORAI_CONFIG = path.join(tmpDir, "missing-config.json");

    const svc = createInstanceSettingsService({ envFilePath });
    const result = svc.getRuntimeSettings();

    expect(result.authPublicBaseUrl.configured).toBe(true);
    expect(result.authPublicBaseUrl.source).toBe("process_env");
    expect(result.authPublicBaseUrl.value).toBe("https://runtime.orchestorai.example.com");
    expect(result.slackBoardApproverUserIds.configured).toBe(true);
    expect(result.slackBoardApproverUserIds.source).toBe("process_env");
    expect(result.slackBoardApproverUserIds.value).toBe("U99999");
    expect(result.secrets.slackBotToken.configured).toBe(true);
    expect(result.secrets.slackBotToken.source).toBe("process_env");
  });

  it("uses SLACK_DEFAULT_CHANNEL_MEMBER_IDS when board approver ids are unset", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "orchestorai-instance-settings-"));
    const envFilePath = path.join(tmpDir, ".env");
    fs.writeFileSync(envFilePath, "SLACK_DEFAULT_CHANNEL_MEMBER_IDS=UDEFAULT1,UDEFAULT2\n", "utf8");

    delete process.env.SLACK_BOARD_APPROVER_USER_IDS;
    delete process.env.SLACK_DEFAULT_CHANNEL_MEMBER_IDS;
    process.env.ORCHESTORAI_CONFIG = path.join(tmpDir, "missing-config.json");

    const svc = createInstanceSettingsService({ envFilePath });
    const result = svc.getRuntimeSettings();

    expect(result.slackDefaultChannelMemberIds.configured).toBe(true);
    expect(result.slackDefaultChannelMemberIds.value).toBe("UDEFAULT1,UDEFAULT2");
    expect(result.slackBoardApproverUserIds.configured).toBe(true);
    expect(result.slackBoardApproverUserIds.source).toBe("orchestorai_env");
    expect(result.slackBoardApproverUserIds.value).toBe("UDEFAULT1,UDEFAULT2");
    expect(svc.getRuntimeValue("slackBoardApproverUserIds")).toBe("UDEFAULT1,UDEFAULT2");
  });

  it("writes updated secrets into the instance env file and preserves unrelated keys", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "orchestorai-instance-settings-"));
    const envFilePath = path.join(tmpDir, ".env");
    fs.writeFileSync(envFilePath, "ORCHESTORAI_ENABLED=true\n", "utf8");

    process.env.ORCHESTORAI_CONFIG = path.join(tmpDir, "missing-config.json");
    const svc = createInstanceSettingsService({ envFilePath });
    const result = svc.updateRuntimeSettings({
      authPublicBaseUrl: "https://saved.orchestorai.example.com",
      slackBoardApproverUserIds: "U11111,U22222",
      slackBotToken: "xoxb-updated-token",
      slackManifestToken: "xoxe.xoxp-updated-manifest-token",
      slackSigningSecret: "updated-signing-secret",
      betterAuthSecret: "updated-auth-secret",
    });

    const contents = fs.readFileSync(envFilePath, "utf8");
    expect(contents).toContain("ORCHESTORAI_ENABLED=true");
    expect(contents).toContain("ORCHESTORAI_AUTH_PUBLIC_BASE_URL=https://saved.orchestorai.example.com");
    expect(contents).toContain("SLACK_BOARD_APPROVER_USER_IDS=U11111,U22222");
    expect(contents).toContain("SLACK_BOT_TOKEN=xoxb-updated-token");
    expect(contents).toContain("SLACK_APP_MANIFEST_TOKEN=xoxe.xoxp-updated-manifest-token");
    expect(contents).toContain("SLACK_SIGNING_SECRET=updated-signing-secret");
    expect(contents).toContain("BETTER_AUTH_SECRET=updated-auth-secret");
    expect(result.authPublicBaseUrl.source).toBe("orchestorai_env");
    expect(result.authPublicBaseUrl.value).toBe("https://saved.orchestorai.example.com");
    expect(result.slackBoardApproverUserIds.source).toBe("orchestorai_env");
    expect(result.slackBoardApproverUserIds.value).toBe("U11111,U22222");
    expect(result.secrets.slackBotToken.source).toBe("orchestorai_env");
    expect(result.secrets.slackManifestToken.source).toBe("orchestorai_env");
    expect(result.secrets.slackSigningSecret.source).toBe("orchestorai_env");
    expect(result.secrets.betterAuthSecret.source).toBe("orchestorai_env");
  });

  it("defaults the runtime env file path to the global OrchestorAI instance env", () => {
    const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "orchestorai-home-"));
    process.env.ORCHESTORAI_HOME = tmpHome;
    process.env.ORCHESTORAI_INSTANCE_ID = "settings-test";
    process.env.ORCHESTORAI_CONFIG = path.join(tmpHome, "missing-config.json");

    const svc = createInstanceSettingsService();
    const result = svc.getRuntimeSettings();

    expect(result.envFilePath).toBe(
      path.join(tmpHome, "instances", "settings-test", ".env"),
    );
  });
});
