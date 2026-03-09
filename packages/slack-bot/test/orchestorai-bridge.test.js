import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  detectOrchestorAICommentRequest,
  detectOrchestorAISummaryRequest,
  detectTaskRequest,
  extractIssueIdentifiers,
  extractProjectSelectors,
  fingerprintIssueComment,
  formatChildIssueParentNotice,
  formatChildIssueThreadRootMessage,
  hasOrchestorAITrigger,
  resolveAssignee,
  resolveProject,
  stripBotMention,
} from "../src/orchestorai-bridge.js";
import { OrchestorAIThreadStore } from "../src/orchestorai-thread-store.js";

test("detectTaskRequest accepts bot mention before task prefix", () => {
  const task = detectTaskRequest({
    text: "<@U123> task: Fix the failing deploy\nMore detail here",
    taskPrefix: "task:",
  });

  assert.ok(task);
  assert.equal(task.title, "Fix the failing deploy");
  assert.equal(task.body, "Fix the failing deploy\nMore detail here");
});

test("detectTaskRequest accepts configured trigger mention before task prefix", () => {
  const task = detectTaskRequest({
    text: "@orchestorai task: Fix the failing deploy\nMore detail here",
    taskPrefix: "task:",
    triggerMentions: ["@orchestorai"],
  });

  assert.ok(task);
  assert.equal(task.title, "Fix the failing deploy");
  assert.equal(task.body, "Fix the failing deploy\nMore detail here");
});

test("extractIssueIdentifiers reads OrchestorAI issue identifiers from text", () => {
  const identifiers = extractIssueIdentifiers("Can you summarize AND-9 and pap-14?");

  assert.deepEqual(identifiers, ["AND-9", "PAP-14"]);
});

test("detectOrchestorAISummaryRequest matches overview requests", () => {
  const request = detectOrchestorAISummaryRequest({
    text: "Can you give me a summary of tickets in OrchestorAI?",
  });

  assert.deepEqual(request, {
    kind: "overview",
    issueIdentifiers: [],
    source: "overview",
  });
});

test("detectOrchestorAISummaryRequest matches explicit issue summaries", () => {
  const request = detectOrchestorAISummaryRequest({
    text: "Please summarize AND-9 for me",
  });

  assert.deepEqual(request, {
    kind: "issue",
    issueIdentifiers: ["AND-9"],
    source: "identifier",
  });
});

test("detectOrchestorAISummaryRequest uses mapped thread issue for 'this ticket'", () => {
  const request = detectOrchestorAISummaryRequest({
    text: "What is the status of this ticket?",
    mappedIssueIdentifier: "and-8",
  });

  assert.deepEqual(request, {
    kind: "issue",
    issueIdentifiers: ["AND-8"],
    source: "mapped_thread",
  });
});

test("detectOrchestorAICommentRequest matches latest comment lookup by identifier", () => {
  const request = detectOrchestorAICommentRequest({
    text: "Get me the recent comment from AND-12 ticket",
  });

  assert.deepEqual(request, {
    kind: "latest_comment",
    issueIdentifiers: ["AND-12"],
    source: "identifier",
  });
});

test("detectOrchestorAICommentRequest uses mapped thread issue for current ticket comments", () => {
  const request = detectOrchestorAICommentRequest({
    text: "What is the latest comment on this ticket?",
    mappedIssueIdentifier: "and-9",
  });

  assert.deepEqual(request, {
    kind: "latest_comment",
    issueIdentifiers: ["AND-9"],
    source: "mapped_thread",
  });
});

test("detectTaskRequest accepts a title line before the trigger line", () => {
  const task = detectTaskRequest({
    text: "Eyalty - Verify email verification flow\n@orchestorai task: Check the kill and restart flow\nInclude Business and Consumer variants",
    taskPrefix: "task:",
    triggerMentions: ["@orchestorai"],
  });

  assert.ok(task);
  assert.equal(task.title, "Eyalty - Verify email verification flow");
  assert.equal(task.body, "Check the kill and restart flow\nInclude Business and Consumer variants");
});

test("hasOrchestorAITrigger matches bot mention and configured aliases", () => {
  assert.equal(
    hasOrchestorAITrigger({
      text: "<@BOT1> task: Fix the deploy",
      botUserId: "BOT1",
      triggerMentions: ["@orchestorai"],
    }),
    true,
  );

  assert.equal(
    hasOrchestorAITrigger({
      text: "task: Fix the deploy\n@orchestorai please create this",
      botUserId: "BOT1",
      triggerMentions: ["@orchestorai"],
    }),
    true,
  );

  assert.equal(
    hasOrchestorAITrigger({
      text: "task: Fix the deploy",
      botUserId: "BOT1",
      triggerMentions: ["@orchestorai"],
    }),
    false,
  );
});

test("resolveAssignee prefers configured Slack mapping", () => {
  const result = resolveAssignee({
    text: "task: <@U999> investigate this regression",
    agentMappings: {
      U999: "agent-2",
      "@alice": "agent-1",
    },
    agents: [
      { id: "agent-1", name: "Alice" },
      { id: "agent-2", name: "ReleaseCaptain" },
    ],
  });

  assert.equal(result.kind, "match");
  assert.equal(result.agent.id, "agent-2");
  assert.equal(result.source, "mapping");
});

test("resolveAssignee falls back to exact OrchestorAI agent name", () => {
  const result = resolveAssignee({
    text: "task: @BackendEngineer fix the webhook retry bug",
    agentMappings: {},
    agents: [
      { id: "agent-1", name: "BackendEngineer" },
      { id: "agent-2", name: "FrontendEngineer" },
    ],
  });

  assert.equal(result.kind, "match");
  assert.equal(result.agent.id, "agent-1");
  assert.equal(result.source, "agent_name");
});

test("resolveAssignee uses persisted generated agent aliases before exact names", () => {
  const result = resolveAssignee({
    text: "task: @qa please verify the regression",
    agentMappings: {},
    agents: [
      {
        id: "agent-1",
        name: "QA Engineer",
        urlKey: "qa-engineer",
        metadata: {
          references: {
            aliasMode: "generated",
            primaryAlias: "qa",
            aliases: ["qa", "qa-engineer"],
          },
        },
      },
    ],
  });

  assert.equal(result.kind, "match");
  assert.equal(result.agent.id, "agent-1");
  assert.equal(result.source, "agent_alias");
});

test("resolveAssignee falls back to agent urlKey when alias metadata is unavailable", () => {
  const result = resolveAssignee({
    text: "task: @nick-sde-3 take this",
    agentMappings: {},
    agents: [
      { id: "agent-1", name: "Nick (SDE-3)", urlKey: "nick-sde-3", metadata: null },
    ],
  });

  assert.equal(result.kind, "match");
  assert.equal(result.agent.id, "agent-1");
  assert.equal(result.source, "agent_url_key");
});

test("extractProjectSelectors reads project metadata lines", () => {
  const selectors = extractProjectSelectors(
    "task: Fix onboarding\nproject: Eyalty App\n#project expense-tracker",
  );

  assert.deepEqual(selectors, ["Eyalty App", "expense-tracker"]);
});

test("extractProjectSelectors reads inline hashtag project selectors", () => {
  const selectors = extractProjectSelectors(
    "@orchestorai task: Check email flow #project eyalty. @qa please verify.",
  );

  assert.deepEqual(selectors, ["eyalty"]);
});

test("resolveProject prefers configured project alias mapping", () => {
  const result = resolveProject({
    text: "task: Fix onboarding\nproject: eyalty",
    projectMappings: {
      eyalty: "project-2",
      expense: "project-1",
    },
    projects: [
      { id: "project-1", name: "AI-Auto-Expense-Tracker" },
      { id: "project-2", name: "Eyalty App" },
    ],
  });

  assert.equal(result.kind, "match");
  assert.equal(result.project.id, "project-2");
  assert.equal(result.source, "mapping");
});

test("resolveProject falls back to exact OrchestorAI project name", () => {
  const result = resolveProject({
    text: "task: Fix onboarding\nproject: AI Auto Expense Tracker",
    projectMappings: {},
    projects: [
      { id: "project-1", name: "AI-Auto-Expense-Tracker" },
      { id: "project-2", name: "Eyalty App" },
    ],
  });

  assert.equal(result.kind, "match");
  assert.equal(result.project.id, "project-1");
  assert.equal(result.source, "project_name");
});

test("resolveProject uses persisted generated project aliases before exact names", () => {
  const result = resolveProject({
    text: "task: Fix onboarding\nproject: eyalty",
    projectMappings: {},
    projects: [
      {
        id: "project-1",
        name: "Eyalty App",
        urlKey: "eyalty-app",
        metadata: {
          references: {
            aliasMode: "generated",
            primaryAlias: "eyalty",
            aliases: ["eyalty", "eyalty-app"],
          },
        },
      },
    ],
  });

  assert.equal(result.kind, "match");
  assert.equal(result.project.id, "project-1");
  assert.equal(result.source, "project_alias");
});

test("resolveProject falls back to project urlKey when alias metadata is unavailable", () => {
  const result = resolveProject({
    text: "task: Fix onboarding\nproject: expense-tracker",
    projectMappings: {},
    projects: [
      {
        id: "project-1",
        name: "AI Auto Expense Tracker",
        urlKey: "expense-tracker",
        metadata: null,
      },
    ],
  });

  assert.equal(result.kind, "match");
  assert.equal(result.project.id, "project-1");
  assert.equal(result.source, "project_url_key");
});

test("stripBotMention only removes the bot mention", () => {
  const result = stripBotMention("<@BOT1> please sync this for <@U123>", "BOT1");
  assert.equal(result, "please sync this for <@U123>");
});

test("stripBotMention removes configured orchestorai aliases", () => {
  const result = stripBotMention("@orchestorai please sync this for <@U123>", "BOT1", ["@orchestorai"]);
  assert.equal(result, "please sync this for <@U123>");
});

test("formatChildIssueThreadRootMessage includes parent, assignee, and project context", () => {
  const message = formatChildIssueThreadRootMessage({
    childIdentifier: "AND-9",
    parentIdentifier: "AND-8",
    title: "Implement OTP/email verification gate on app restart",
    assigneeName: "CTO",
    projectName: "Eyalty App",
  });

  assert.equal(
    message,
    [
      "Created OrchestorAI issue AND-9 from AND-8.",
      "This thread will track AND-9.",
      "Title: Implement OTP/email verification gate on app restart",
      "Assignee: CTO",
      "Project: Eyalty App",
    ].join("\n"),
  );
});

test("formatChildIssueParentNotice explains that a new Slack thread was opened", () => {
  const message = formatChildIssueParentNotice({
    childIdentifier: "AND-9",
    parentIdentifier: "AND-8",
  });

  assert.equal(
    message,
    "OrchestorAI AND-9 was created from AND-8. I opened a new Slack thread for AND-9.",
  );
});

test("orchestorai thread store persists mappings and fingerprints", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "orchestorai-thread-store-"));
  try {
    const store = new OrchestorAIThreadStore(tmpDir);
    store.ensureLoaded();

    store.putMapping({
      channelId: "C123",
      threadTs: "111.222",
      companyId: "company-1",
      issueId: "issue-1",
      issueIdentifier: "PAP-1",
      assigneeAgentId: "agent-1",
      assigneeName: "BackendEngineer",
    });

    const fingerprint = fingerprintIssueComment("Progress update from Slack");
    store.rememberSlackFingerprint("issue-1", fingerprint);

    assert.equal(store.getMapping("C123", "111.222")?.issueIdentifier, "PAP-1");
    assert.equal(store.getMappingByIssueId("issue-1")?.channelId, "C123");
    assert.equal(store.hasRecentSlackFingerprint("issue-1", fingerprint), true);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("orchestorai thread store remembers preferred company channels and can infer from mappings", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "orchestorai-thread-store-pref-"));
  try {
    const store = new OrchestorAIThreadStore(tmpDir);
    store.ensureLoaded();

    store.putMapping({
      channelId: "D-OLDER",
      threadTs: "1000.1",
      companyId: "company-1",
      issueId: "issue-1",
      issueIdentifier: "AND-1",
      createdAt: "2026-03-07T10:00:00.000Z",
      updatedAt: "2026-03-07T10:00:00.000Z",
    });
    store.putMapping({
      channelId: "D-NEWER",
      threadTs: "1000.2",
      companyId: "company-1",
      issueId: "issue-2",
      issueIdentifier: "AND-2",
      createdAt: "2026-03-07T11:00:00.000Z",
      updatedAt: "2026-03-07T11:00:00.000Z",
    });

    assert.equal(store.getPreferredChannel("company-1"), "D-NEWER");

    store.setPreferredChannel("company-1", "D-PREFERRED");
    assert.equal(store.getPreferredChannel("company-1"), "D-PREFERRED");
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
