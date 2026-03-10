import test from "node:test";
import assert from "node:assert/strict";

import {
  buildOrchestorAILatestCommentSummary,
  buildOrchestorAIIssueSummary,
  buildOrchestorAIOverviewSummary,
  shouldMirrorIssueToControlApp,
} from "../src/slack-runtime.js";

test("buildOrchestorAIIssueSummary renders a concise ticket summary", () => {
  const summary = buildOrchestorAIIssueSummary({
    issue: {
      identifier: "AND-9",
      title: "Implement OTP/email verification gate on app restart",
      status: "in_review",
      priority: "high",
      description:
        "Source: [AND-8](/issues/AND-8)\n\nImplement the approved fix to prevent bypassing OTP/email verification after app kill + restart.",
    },
    assigneeName: "Nick (SDE-3)",
    projectName: "Eyalty App",
    parentIdentifier: "AND-8",
  });

  assert.match(summary, /^\*Summary\*/);
  assert.match(summary, /AND-9: Implement OTP\/email verification gate on app restart/);
  assert.match(summary, /Status: in review\. Priority: high\. Assignee: Nick \(SDE-3\)\. Project: Eyalty App\./);
  assert.match(summary, /Parent: AND-8\. Brief: Implement the approved fix to prevent bypassing OTP\/email verification after app kill \+ restart\./);
});

test("buildOrchestorAIOverviewSummary renders counts plus active and completed tickets", () => {
  const summary = buildOrchestorAIOverviewSummary({
    issues: [
      {
        identifier: "AND-9",
        title: "Implement OTP/email verification gate on app restart",
        status: "in_review",
        assigneeAgentId: "agent-1",
        updatedAt: "2026-03-08T08:00:00.000Z",
      },
      {
        identifier: "AND-14",
        title: "Name Agents",
        status: "done",
        assigneeAgentId: "agent-2",
        updatedAt: "2026-03-08T07:00:00.000Z",
      },
    ],
    agentsById: new Map([
      ["agent-1", "Nick (SDE-3)"],
      ["agent-2", "Naveen (CEO)"],
    ]),
    projectName: "Eyalty App",
  });

  assert.match(summary, /^\*Summary\*/);
  assert.match(summary, /2 tickets in Eyalty App: 1 in review, 1 done\./);
  assert.match(summary, /Active: AND-9 Implement OTP\/email verification gate on app restart \(in review, Nick \(SDE-3\)\)/);
  assert.match(summary, /Recent completions: AND-14 Name Agents \(done, Naveen \(CEO\)\)/);
});

test("buildOrchestorAILatestCommentSummary renders the newest comment as full markdown-friendly text", () => {
  const summary = buildOrchestorAILatestCommentSummary({
    identifier: "AND-12",
    authorName: "CTO",
    comment: {
      body:
        "## Update\n\nOrg change applied.\n\n- Michelle (SDE-2) now reports to Nick (SDE-3).\n- Verified reportsTo for Michelle is set to Nick's agent id.\n- Issue: [AND-12](/AND/issues/AND-12)\n- Manager: [Nick (SDE-3)](/AND/agents/nick-sde-3)\n- Direct report: [Michelle (SDE-2)](/AND/agents/michelle-sde-2)",
    },
  });

  assert.equal(
    summary,
    "*Summary*\nLatest comment on AND-12 by CTO:\nOrg change applied.\n\nMichelle (SDE-2) now reports to Nick (SDE-3).\nVerified reportsTo for Michelle is set to Nick's agent id.\nIssue: AND-12\nManager: Nick (SDE-3)\nDirect report: Michelle (SDE-2)",
  );
});

test("buildOrchestorAILatestCommentSummary handles tickets with no comments", () => {
  const summary = buildOrchestorAILatestCommentSummary({
    identifier: "AND-15",
    comment: null,
  });

  assert.equal(summary, "*Summary*\n- AND-15 has no comments yet.");
});

test("shouldMirrorIssueToControlApp suppresses board-created issues that are not board-targeted", () => {
  const shouldMirror = shouldMirrorIssueToControlApp({
    issue: {
      identifier: "AND-20",
      title: "Create architecture doc",
      description: "Produce a detailed architecture document.",
      createdByUserId: "local-board",
      assigneeUserId: null,
    },
    payload: {
      actorType: "user",
      details: {},
    },
  });

  assert.equal(shouldMirror, false);
});

test("shouldMirrorIssueToControlApp allows board-created issues assigned to board users", () => {
  const shouldMirror = shouldMirrorIssueToControlApp({
    issue: {
      identifier: "AND-21",
      title: "Review delivery plan",
      description: "",
      createdByUserId: "local-board",
      assigneeUserId: "local-board",
    },
    payload: {
      actorType: "user",
      details: {},
    },
  });

  assert.equal(shouldMirror, true);
});

test("shouldMirrorIssueToControlApp allows board-created issues when a later comment mentions board", () => {
  const shouldMirror = shouldMirrorIssueToControlApp({
    issue: {
      identifier: "AND-22",
      title: "Create implementation subtasks",
      description: "",
      createdByUserId: "local-board",
      assigneeUserId: null,
    },
    payload: {
      actorType: "agent",
      details: {
        bodySnippet: "Board please review the proposed subtasks before we proceed.",
      },
    },
  });

  assert.equal(shouldMirror, true);
});
