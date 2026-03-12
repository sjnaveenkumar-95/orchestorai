import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";

import { OrchestorAIClient } from "../src/orchestorai-client.js";

function createJsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get(name) {
        return String(name || "").toLowerCase() === "content-type"
          ? "application/json; charset=utf-8"
          : null;
      },
    },
    async json() {
      return body;
    },
    async text() {
      return JSON.stringify(body);
    },
  };
}

test("getManagedProjectChannel returns the active managed project for a Slack channel", async () => {
  const client = new OrchestorAIClient({
    apiUrl: "http://127.0.0.1:3101",
    companyId: "company-1",
    fetchImpl: async () =>
      createJsonResponse([
        {
          id: "project-1",
          name: "Inactive Project",
          slackChannel: {
            channelId: "C111",
            status: "archived",
          },
        },
        {
          id: "project-2",
          name: "Managed Project",
          slackChannel: {
            channelId: "C222",
            status: "active",
          },
        },
      ]),
  });

  const project = await client.getManagedProjectChannel("C222");

  assert.equal(project?.id, "project-2");
  assert.equal(project?.name, "Managed Project");
});

test("forwardSlackControlEvent sends the trusted bot headers to the server route", async () => {
  const calls = [];
  const client = new OrchestorAIClient({
    apiUrl: "http://127.0.0.1:3101",
    companyId: "company-1",
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return createJsonResponse({ ok: true });
    },
  });

  await client.forwardSlackControlEvent(
    {
      type: "event_callback",
      event_id: "evt-1",
      event: {
        type: "message",
        channel: "C222",
        text: "create a ticket",
        ts: "1773106939.915489",
      },
    },
    {
      botToken: "xoxb-test-token",
    },
  );

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "http://127.0.0.1:3101/api/slack/control/events");
  assert.equal(calls[0].init?.method, "POST");
  assert.equal(calls[0].init?.headers?.authorization, "Bearer xoxb-test-token");
  assert.equal(calls[0].init?.headers?.["x-orchestorai-slack-source"], "slack-bot");
});

test("handleSlackApprovalThreadReply signs the request and posts it to OrchestorAI", async () => {
  const calls = [];
  const client = new OrchestorAIClient({
    apiUrl: "http://localhost:3100/",
    companyId: "company-1",
    controlSigningSecret: "test-signing-secret",
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return {
        ok: true,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({ handled: true, outcome: "approved_once" }),
      };
    },
  });

  const payload = {
    channelId: "C123",
    threadTs: "1773160944.866529",
    slackUserId: "U123",
    text: "approved for now",
  };

  const result = await client.handleSlackApprovalThreadReply(payload);

  assert.deepEqual(result, { handled: true, outcome: "approved_once" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "http://localhost:3100/api/slack/control/approval-thread-replies");
  assert.equal(calls[0].options.method, "POST");
  assert.equal(calls[0].options.headers.Accept, "application/json");
  assert.equal(calls[0].options.headers["Content-Type"], "application/json");
  assert.equal(calls[0].options.body, JSON.stringify(payload));

  const timestamp = calls[0].options.headers["x-slack-request-timestamp"];
  assert.ok(timestamp);
  const expectedSignature = `v0=${createHmac("sha256", "test-signing-secret")
    .update(`v0:${timestamp}:${calls[0].options.body}`)
    .digest("hex")}`;
  assert.equal(calls[0].options.headers["x-slack-signature"], expectedSignature);
});

test("listAgents can enrich agents with Slack bot user ids", async () => {
  const calls = [];
  const client = new OrchestorAIClient({
    apiUrl: "http://localhost:3100/",
    companyId: "company-1",
    fetchImpl: async (url) => {
      calls.push(String(url));
      if (String(url).endsWith("/api/companies/company-1/agents")) {
        return {
          ok: true,
          headers: new Headers({ "content-type": "application/json" }),
          json: async () => [{ id: "agent-1", name: "Nick (SDE-3)" }],
        };
      }
      if (String(url).endsWith("/api/agents/agent-1/slack")) {
        return {
          ok: true,
          headers: new Headers({ "content-type": "application/json" }),
          json: async () => ({ botUserId: "U0AKA233HGA", installStatus: "active" }),
        };
      }
      throw new Error(`Unexpected request: ${url}`);
    },
  });

  const agents = await client.listAgents({ includeSlack: true });

  assert.deepEqual(agents, [
    {
      id: "agent-1",
      name: "Nick (SDE-3)",
      slackBotUserId: "U0AKA233HGA",
    },
  ]);
  assert.deepEqual(calls, [
    "http://localhost:3100/api/companies/company-1/agents",
    "http://localhost:3100/api/agents/agent-1/slack",
  ]);
});
