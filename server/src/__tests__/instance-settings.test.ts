import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createInstanceSettingsService } from "../services/instance-settings.ts";

const ORIGINAL_SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;
const ORIGINAL_SLACK_APP_TOKEN = process.env.SLACK_APP_TOKEN;
const ORIGINAL_BETTER_AUTH_SECRET = process.env.BETTER_AUTH_SECRET;

afterEach(() => {
  if (ORIGINAL_SLACK_BOT_TOKEN === undefined) delete process.env.SLACK_BOT_TOKEN;
  else process.env.SLACK_BOT_TOKEN = ORIGINAL_SLACK_BOT_TOKEN;

  if (ORIGINAL_SLACK_APP_TOKEN === undefined) delete process.env.SLACK_APP_TOKEN;
  else process.env.SLACK_APP_TOKEN = ORIGINAL_SLACK_APP_TOKEN;

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
        "BETTER_AUTH_SECRET=super-secret-value",
        "",
      ].join("\n"),
    );

    const svc = createInstanceSettingsService({ envFilePath });
    const result = svc.getRuntimeSettings();

    expect(result.envFilePath).toBe(envFilePath);
    expect(result.secrets.slackBotToken.configured).toBe(true);
    expect(result.secrets.slackBotToken.source).toBe("paperclip_env");
    expect(result.secrets.slackBotToken.maskedValue).toMatch(/^xoxb-\*+abcd$/);
    expect(result.secrets.slackAppToken.configured).toBe(true);
    expect(result.secrets.slackAppToken.source).toBe("paperclip_env");
    expect(result.secrets.betterAuthSecret.configured).toBe(true);
    expect(result.secrets.betterAuthSecret.source).toBe("paperclip_env");
  });

  it("falls back to process env when the instance env file does not contain a value", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "paperclip-instance-settings-"));
    const envFilePath = path.join(tmpDir, ".env");
    process.env.SLACK_BOT_TOKEN = "xoxb-process-token";

    const svc = createInstanceSettingsService({ envFilePath });
    const result = svc.getRuntimeSettings();

    expect(result.secrets.slackBotToken.configured).toBe(true);
    expect(result.secrets.slackBotToken.source).toBe("process_env");
  });

  it("writes updated secrets into the instance env file and preserves unrelated keys", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "paperclip-instance-settings-"));
    const envFilePath = path.join(tmpDir, ".env");
    fs.writeFileSync(envFilePath, "PAPERCLIP_ENABLED=true\n", "utf8");

    const svc = createInstanceSettingsService({ envFilePath });
    const result = svc.updateRuntimeSettings({
      slackBotToken: "xoxb-updated-token",
      betterAuthSecret: "updated-auth-secret",
    });

    const contents = fs.readFileSync(envFilePath, "utf8");
    expect(contents).toContain("PAPERCLIP_ENABLED=true");
    expect(contents).toContain("SLACK_BOT_TOKEN=xoxb-updated-token");
    expect(contents).toContain("BETTER_AUTH_SECRET=updated-auth-secret");
    expect(result.secrets.slackBotToken.source).toBe("paperclip_env");
    expect(result.secrets.betterAuthSecret.source).toBe("paperclip_env");
  });
});
