import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createInstanceSettingsService } from "../services/instance-settings.ts";

const ORIGINAL_SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;
const ORIGINAL_SLACK_APP_TOKEN = process.env.SLACK_APP_TOKEN;
const ORIGINAL_SLACK_MANIFEST_TOKEN = process.env.SLACK_APP_MANIFEST_TOKEN;
const ORIGINAL_SLACK_SIGNING_SECRET = process.env.SLACK_SIGNING_SECRET;
const ORIGINAL_PAPERCLIP_AUTH_PUBLIC_BASE_URL = process.env.PAPERCLIP_AUTH_PUBLIC_BASE_URL;
const ORIGINAL_PAPERCLIP_PUBLIC_URL = process.env.PAPERCLIP_PUBLIC_URL;
const ORIGINAL_PAPERCLIP_CONFIG = process.env.PAPERCLIP_CONFIG;
const ORIGINAL_PAPERCLIP_HOME = process.env.PAPERCLIP_HOME;
const ORIGINAL_PAPERCLIP_INSTANCE_ID = process.env.PAPERCLIP_INSTANCE_ID;
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

  if (ORIGINAL_PAPERCLIP_AUTH_PUBLIC_BASE_URL === undefined) delete process.env.PAPERCLIP_AUTH_PUBLIC_BASE_URL;
  else process.env.PAPERCLIP_AUTH_PUBLIC_BASE_URL = ORIGINAL_PAPERCLIP_AUTH_PUBLIC_BASE_URL;

  if (ORIGINAL_PAPERCLIP_PUBLIC_URL === undefined) delete process.env.PAPERCLIP_PUBLIC_URL;
  else process.env.PAPERCLIP_PUBLIC_URL = ORIGINAL_PAPERCLIP_PUBLIC_URL;

  if (ORIGINAL_PAPERCLIP_CONFIG === undefined) delete process.env.PAPERCLIP_CONFIG;
  else process.env.PAPERCLIP_CONFIG = ORIGINAL_PAPERCLIP_CONFIG;

  if (ORIGINAL_PAPERCLIP_HOME === undefined) delete process.env.PAPERCLIP_HOME;
  else process.env.PAPERCLIP_HOME = ORIGINAL_PAPERCLIP_HOME;

  if (ORIGINAL_PAPERCLIP_INSTANCE_ID === undefined) delete process.env.PAPERCLIP_INSTANCE_ID;
  else process.env.PAPERCLIP_INSTANCE_ID = ORIGINAL_PAPERCLIP_INSTANCE_ID;

  if (ORIGINAL_BETTER_AUTH_SECRET === undefined) delete process.env.BETTER_AUTH_SECRET;
  else process.env.BETTER_AUTH_SECRET = ORIGINAL_BETTER_AUTH_SECRET;
});

describe("createInstanceSettingsService", () => {
  it("reads configured secrets from the Paperclip env file", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "paperclip-instance-settings-"));
    const envFilePath = path.join(tmpDir, ".env");
    fs.writeFileSync(
      envFilePath,
      [
        "SLACK_BOT_TOKEN=xoxb-1234567890-abcd",
        "SLACK_APP_TOKEN=xapp-1-abcd-efgh",
        "SLACK_APP_MANIFEST_TOKEN=xoxe.xoxp-manifest-token",
        "SLACK_SIGNING_SECRET=signing-secret-value",
        "PAPERCLIP_AUTH_PUBLIC_BASE_URL=https://paperclip.example.com",
        "BETTER_AUTH_SECRET=super-secret-value",
        "",
      ].join("\n"),
    );

    process.env.PAPERCLIP_CONFIG = path.join(tmpDir, "missing-config.json");
    const svc = createInstanceSettingsService({ envFilePath });
    const result = svc.getRuntimeSettings();

    expect(result.envFilePath).toBe(envFilePath);
    expect(result.authPublicBaseUrl.configured).toBe(true);
    expect(result.authPublicBaseUrl.source).toBe("paperclip_env");
    expect(result.authPublicBaseUrl.value).toBe("https://paperclip.example.com");
    expect(result.secrets.slackBotToken.configured).toBe(true);
    expect(result.secrets.slackBotToken.source).toBe("paperclip_env");
    expect(result.secrets.slackBotToken.maskedValue).toMatch(/^xoxb-\*+abcd$/);
    expect(result.secrets.slackAppToken.configured).toBe(true);
    expect(result.secrets.slackAppToken.source).toBe("paperclip_env");
    expect(result.secrets.slackManifestToken.configured).toBe(true);
    expect(result.secrets.slackManifestToken.source).toBe("paperclip_env");
    expect(result.secrets.slackSigningSecret.configured).toBe(true);
    expect(result.secrets.slackSigningSecret.source).toBe("paperclip_env");
    expect(result.secrets.betterAuthSecret.configured).toBe(true);
    expect(result.secrets.betterAuthSecret.source).toBe("paperclip_env");
  });

  it("falls back to process env when the instance env file does not contain a value", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "paperclip-instance-settings-"));
    const envFilePath = path.join(tmpDir, ".env");
    process.env.SLACK_BOT_TOKEN = "xoxb-process-token";
    process.env.PAPERCLIP_AUTH_PUBLIC_BASE_URL = "https://runtime.paperclip.example.com";
    process.env.PAPERCLIP_CONFIG = path.join(tmpDir, "missing-config.json");

    const svc = createInstanceSettingsService({ envFilePath });
    const result = svc.getRuntimeSettings();

    expect(result.authPublicBaseUrl.configured).toBe(true);
    expect(result.authPublicBaseUrl.source).toBe("process_env");
    expect(result.authPublicBaseUrl.value).toBe("https://runtime.paperclip.example.com");
    expect(result.secrets.slackBotToken.configured).toBe(true);
    expect(result.secrets.slackBotToken.source).toBe("process_env");
  });

  it("writes updated secrets into the instance env file and preserves unrelated keys", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "paperclip-instance-settings-"));
    const envFilePath = path.join(tmpDir, ".env");
    fs.writeFileSync(envFilePath, "PAPERCLIP_ENABLED=true\n", "utf8");

    process.env.PAPERCLIP_CONFIG = path.join(tmpDir, "missing-config.json");
    const svc = createInstanceSettingsService({ envFilePath });
    const result = svc.updateRuntimeSettings({
      authPublicBaseUrl: "https://saved.paperclip.example.com",
      slackBotToken: "xoxb-updated-token",
      slackManifestToken: "xoxe.xoxp-updated-manifest-token",
      slackSigningSecret: "updated-signing-secret",
      betterAuthSecret: "updated-auth-secret",
    });

    const contents = fs.readFileSync(envFilePath, "utf8");
    expect(contents).toContain("PAPERCLIP_ENABLED=true");
    expect(contents).toContain("PAPERCLIP_AUTH_PUBLIC_BASE_URL=https://saved.paperclip.example.com");
    expect(contents).toContain("SLACK_BOT_TOKEN=xoxb-updated-token");
    expect(contents).toContain("SLACK_APP_MANIFEST_TOKEN=xoxe.xoxp-updated-manifest-token");
    expect(contents).toContain("SLACK_SIGNING_SECRET=updated-signing-secret");
    expect(contents).toContain("BETTER_AUTH_SECRET=updated-auth-secret");
    expect(result.authPublicBaseUrl.source).toBe("paperclip_env");
    expect(result.authPublicBaseUrl.value).toBe("https://saved.paperclip.example.com");
    expect(result.secrets.slackBotToken.source).toBe("paperclip_env");
    expect(result.secrets.slackManifestToken.source).toBe("paperclip_env");
    expect(result.secrets.slackSigningSecret.source).toBe("paperclip_env");
    expect(result.secrets.betterAuthSecret.source).toBe("paperclip_env");
  });

  it("defaults the runtime env file path to the global Paperclip instance env", () => {
    const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "paperclip-home-"));
    process.env.PAPERCLIP_HOME = tmpHome;
    process.env.PAPERCLIP_INSTANCE_ID = "settings-test";
    process.env.PAPERCLIP_CONFIG = path.join(tmpHome, "missing-config.json");

    const svc = createInstanceSettingsService();
    const result = svc.getRuntimeSettings();

    expect(result.envFilePath).toBe(
      path.join(tmpHome, "instances", "settings-test", ".env"),
    );
  });
});
