import { createHmac } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import express from "express";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import type { Db } from "@paperclipai/db";
import { slackRoutes } from "../routes/slack.js";

const ORIGINAL_SLACK_SIGNING_SECRET = process.env.SLACK_SIGNING_SECRET;
const ORIGINAL_PAPERCLIP_HOME = process.env.PAPERCLIP_HOME;
const ORIGINAL_PAPERCLIP_INSTANCE_ID = process.env.PAPERCLIP_INSTANCE_ID;
const ORIGINAL_PAPERCLIP_CONFIG = process.env.PAPERCLIP_CONFIG;

function signSlackBody(signingSecret: string, rawBody: string, timestamp: string) {
  const base = `v0:${timestamp}:${rawBody}`;
  return `v0=${createHmac("sha256", signingSecret).update(base).digest("hex")}`;
}

function createTestApp() {
  const app = express();
  app.use("/api/slack/control/events", express.raw({ type: "application/json" }));
  app.use("/api", slackRoutes({} as Db));
  return app;
}

afterEach(() => {
  if (ORIGINAL_SLACK_SIGNING_SECRET === undefined) delete process.env.SLACK_SIGNING_SECRET;
  else process.env.SLACK_SIGNING_SECRET = ORIGINAL_SLACK_SIGNING_SECRET;

  if (ORIGINAL_PAPERCLIP_HOME === undefined) delete process.env.PAPERCLIP_HOME;
  else process.env.PAPERCLIP_HOME = ORIGINAL_PAPERCLIP_HOME;

  if (ORIGINAL_PAPERCLIP_INSTANCE_ID === undefined) delete process.env.PAPERCLIP_INSTANCE_ID;
  else process.env.PAPERCLIP_INSTANCE_ID = ORIGINAL_PAPERCLIP_INSTANCE_ID;

  if (ORIGINAL_PAPERCLIP_CONFIG === undefined) delete process.env.PAPERCLIP_CONFIG;
  else process.env.PAPERCLIP_CONFIG = ORIGINAL_PAPERCLIP_CONFIG;
});

function isolatePaperclipHome() {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "paperclip-slack-routes-"));
  process.env.PAPERCLIP_HOME = tmpHome;
  process.env.PAPERCLIP_INSTANCE_ID = "slack-routes-test";
  process.env.PAPERCLIP_CONFIG = path.join(tmpHome, "missing-config.json");
}

describe("slackRoutes", () => {
  it("accepts Slack URL verification requests with a valid signature", async () => {
    isolatePaperclipHome();
    process.env.SLACK_SIGNING_SECRET = "test-signing-secret";

    const payload = {
      type: "url_verification",
      challenge: "hello-slack",
    };
    const rawBody = JSON.stringify(payload);
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = signSlackBody(process.env.SLACK_SIGNING_SECRET, rawBody, timestamp);

    const res = await request(createTestApp())
      .post("/api/slack/control/events")
      .set("content-type", "application/json")
      .set("x-slack-request-timestamp", timestamp)
      .set("x-slack-signature", signature)
      .send(rawBody);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ challenge: "hello-slack" });
  });

  it("rejects Slack callbacks with an invalid signature", async () => {
    isolatePaperclipHome();
    process.env.SLACK_SIGNING_SECRET = "test-signing-secret";

    const payload = {
      type: "url_verification",
      challenge: "hello-slack",
    };
    const rawBody = JSON.stringify(payload);
    const timestamp = String(Math.floor(Date.now() / 1000));

    const res = await request(createTestApp())
      .post("/api/slack/control/events")
      .set("content-type", "application/json")
      .set("x-slack-request-timestamp", timestamp)
      .set("x-slack-signature", "v0=invalid")
      .send(rawBody);

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "Invalid Slack signature" });
  });
});
