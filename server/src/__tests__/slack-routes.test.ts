import { createHmac } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import express from "express";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import type { Db } from "@orchestorai/db";
import { slackRoutes } from "../routes/slack.js";

const ORIGINAL_SLACK_SIGNING_SECRET = process.env.SLACK_SIGNING_SECRET;
const ORIGINAL_ORCHESTORAI_HOME = process.env.ORCHESTORAI_HOME;
const ORIGINAL_ORCHESTORAI_INSTANCE_ID = process.env.ORCHESTORAI_INSTANCE_ID;
const ORIGINAL_ORCHESTORAI_CONFIG = process.env.ORCHESTORAI_CONFIG;

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

  if (ORIGINAL_ORCHESTORAI_HOME === undefined) delete process.env.ORCHESTORAI_HOME;
  else process.env.ORCHESTORAI_HOME = ORIGINAL_ORCHESTORAI_HOME;

  if (ORIGINAL_ORCHESTORAI_INSTANCE_ID === undefined) delete process.env.ORCHESTORAI_INSTANCE_ID;
  else process.env.ORCHESTORAI_INSTANCE_ID = ORIGINAL_ORCHESTORAI_INSTANCE_ID;

  if (ORIGINAL_ORCHESTORAI_CONFIG === undefined) delete process.env.ORCHESTORAI_CONFIG;
  else process.env.ORCHESTORAI_CONFIG = ORIGINAL_ORCHESTORAI_CONFIG;
});

function isolateOrchestorAIHome() {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "orchestorai-slack-routes-"));
  process.env.ORCHESTORAI_HOME = tmpHome;
  process.env.ORCHESTORAI_INSTANCE_ID = "slack-routes-test";
  process.env.ORCHESTORAI_CONFIG = path.join(tmpHome, "missing-config.json");
}

describe("slackRoutes", () => {
  it("accepts Slack URL verification requests with a valid signature", async () => {
    isolateOrchestorAIHome();
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
    isolateOrchestorAIHome();
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
