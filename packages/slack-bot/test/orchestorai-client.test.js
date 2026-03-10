import test from "node:test";
import assert from "node:assert/strict";

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
