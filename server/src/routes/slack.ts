import { createHmac, timingSafeEqual } from "node:crypto";
import { Router } from "express";
import type { Db } from "@orchestorai/db";
import { slackIntegrationService } from "../services/index.js";
import { logger } from "../middleware/logger.js";
import { createInstanceSettingsService } from "../services/instance-settings.js";

function safeCompare(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }
  return timingSafeEqual(leftBuffer, rightBuffer);
}

function verifySlackSignature(input: {
  signingSecret: string;
  rawBody: string;
  timestampHeader?: string;
  signatureHeader?: string;
}) {
  const timestamp = Number.parseInt(input.timestampHeader ?? "", 10);
  if (!Number.isFinite(timestamp)) {
    return false;
  }

  const ageSeconds = Math.abs(Math.floor(Date.now() / 1000) - timestamp);
  if (ageSeconds > 60 * 5) {
    return false;
  }

  const base = `v0:${timestamp}:${input.rawBody}`;
  const digest = `v0=${createHmac("sha256", input.signingSecret).update(base).digest("hex")}`;
  return safeCompare(digest, input.signatureHeader ?? "");
}

function verifyInternalSlackBotRequest(input: {
  expectedBotToken?: string | null;
  authorizationHeader?: string;
  sourceHeader?: string;
}) {
  if (input.sourceHeader !== "slack-bot") {
    return false;
  }

  const expectedBotToken = input.expectedBotToken?.trim();
  if (!expectedBotToken) {
    return false;
  }

  const authorizationHeader = input.authorizationHeader?.trim();
  if (!authorizationHeader?.toLowerCase().startsWith("bearer ")) {
    return false;
  }

  const providedToken = authorizationHeader.slice("bearer ".length).trim();
  if (!providedToken) {
    return false;
  }

  return safeCompare(expectedBotToken, providedToken);
}

function readRawBody(body: unknown) {
  if (Buffer.isBuffer(body)) {
    return body.toString("utf8");
  }
  if (typeof body === "string") {
    return body;
  }
  return "";
}

export function slackRoutes(db: Db) {
  const router = Router();
  const slackSvc = slackIntegrationService(db);
  const instanceSettings = createInstanceSettingsService();
  slackSvc.startLiveEventForwarder();

  router.get("/slack/agent-oauth/callback", async (req, res) => {
    const code = typeof req.query.code === "string" ? req.query.code.trim() : "";
    const state = typeof req.query.state === "string" ? req.query.state.trim() : "";
    const error = typeof req.query.error === "string" ? req.query.error.trim() : "";

    if (error) {
      res.status(400).type("html").send(
        `<html><body><h1>Slack install failed</h1><p>${error}</p></body></html>`,
      );
      return;
    }

    if (!code || !state) {
      res.status(400).type("html").send(
        "<html><body><h1>Missing Slack OAuth parameters</h1></body></html>",
      );
      return;
    }

    try {
      const app = await slackSvc.completeAgentInstall({ code, state });
      res.status(200).type("html").send(
        `<html><body><h1>Slack app installed</h1><p>Agent Slack app is now ${app.installStatus}.</p></body></html>`,
      );
    } catch (err) {
      logger.warn({ err, state }, "failed to complete Slack OAuth callback");
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).type("html").send(
        `<html><body><h1>Slack install failed</h1><p>${message}</p></body></html>`,
      );
    }
  });

  router.post("/slack/control/events", async (req, res) => {
    const rawBody = readRawBody(req.body);

    const isInternalSlackBotRequest = verifyInternalSlackBotRequest({
      expectedBotToken: instanceSettings.getRuntimeSecretValue("slackBotToken"),
      authorizationHeader: req.header("authorization") ?? undefined,
      sourceHeader: req.header("x-orchestorai-slack-source") ?? undefined,
    });

    if (!isInternalSlackBotRequest) {
      const signingSecret = instanceSettings.getRuntimeSecretValue("slackSigningSecret");
      if (!signingSecret) {
        res.status(503).json({ error: "Slack signing secret is not configured" });
        return;
      }

      const isValid = verifySlackSignature({
        signingSecret,
        rawBody,
        timestampHeader: req.header("x-slack-request-timestamp") ?? undefined,
        signatureHeader: req.header("x-slack-signature") ?? undefined,
      });

      if (!isValid) {
        res.status(401).json({ error: "Invalid Slack signature" });
        return;
      }
    }

    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(rawBody) as Record<string, unknown>;
    } catch {
      res.status(400).json({ error: "Invalid Slack payload" });
      return;
    }

    if (payload.type === "url_verification" && typeof payload.challenge === "string") {
      res.status(200).json({ challenge: payload.challenge });
      return;
    }

    res.status(200).json({ ok: true });
    void slackSvc
      .handleSlackControlEvent(
        payload as Parameters<typeof slackSvc.handleSlackControlEvent>[0],
      )
      .catch((err) => {
        logger.warn({ err }, "failed to handle Slack control event");
      });
  });

  router.post("/slack/control/approval-thread-replies", async (req, res) => {
    const signingSecret = instanceSettings.getRuntimeSecretValue("slackSigningSecret");
    if (!signingSecret) {
      res.status(503).json({ error: "Slack signing secret is not configured" });
      return;
    }

    const rawBody = readRawBody(req.body);
    const isValid = verifySlackSignature({
      signingSecret,
      rawBody,
      timestampHeader: req.header("x-slack-request-timestamp") ?? undefined,
      signatureHeader: req.header("x-slack-signature") ?? undefined,
    });

    if (!isValid) {
      res.status(401).json({ error: "Invalid Slack signature" });
      return;
    }

    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(rawBody) as Record<string, unknown>;
    } catch {
      res.status(400).json({ error: "Invalid Slack payload" });
      return;
    }

    const channelId = typeof payload.channelId === "string" ? payload.channelId.trim() : "";
    const threadTs = typeof payload.threadTs === "string" ? payload.threadTs.trim() : "";
    const slackUserId = typeof payload.slackUserId === "string" ? payload.slackUserId.trim() : "";
    const text = typeof payload.text === "string" ? payload.text : "";

    if (!channelId || !threadTs || !slackUserId) {
      res.status(400).json({ error: "channelId, threadTs, and slackUserId are required" });
      return;
    }

    const result = await slackSvc.handleApprovalThreadMessage({
      channelId,
      threadTs,
      slackUserId,
      text,
    });
    res.status(200).json(result);
  });

  return router;
}
