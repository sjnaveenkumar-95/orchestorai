import { describe, expect, it } from "vitest";
import {
  buildSlackControlQueryReply,
  buildSlackControlMessageText,
  buildSlackIssueSummary,
  buildSlackProjectOverviewSummary,
  isSupportedSlackControlSubtype,
} from "../services/slack-integrations.js";

describe("isSupportedSlackControlSubtype", () => {
  it("allows file share events through the managed-channel control path", () => {
    expect(isSupportedSlackControlSubtype(undefined)).toBe(true);
    expect(isSupportedSlackControlSubtype("file_share")).toBe(true);
    expect(isSupportedSlackControlSubtype("channel_join")).toBe(false);
  });
});

describe("buildSlackControlMessageText", () => {
  it("appends attachment metadata to the interpreted message text", () => {
    expect(
      buildSlackControlMessageText({
        text: "Please review this deck",
        files: [
          {
            name: "HR Process Automation.pptx",
            pretty_type: "PowerPoint",
            mimetype: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
          },
        ],
      }),
    ).toBe(
      "Please review this deck\n\nAttached files:\n- HR Process Automation.pptx (PowerPoint, application/vnd.openxmlformats-officedocument.presentationml.presentation)",
    );
  });

  it("falls back to attachment metadata when the Slack message body is empty", () => {
    expect(
      buildSlackControlMessageText({
        text: "",
        files: [
          {
            name: "HR Process Automation.pptx",
            pretty_type: "PowerPoint",
          },
        ],
      }),
    ).toBe("Attached files:\n- HR Process Automation.pptx (PowerPoint)");
  });
});

describe("buildSlackIssueSummary", () => {
  it("renders a concise issue summary for linked issue queries", () => {
    expect(
      buildSlackIssueSummary({
        issue: {
          identifier: "HRH-28",
          title: "Refresh stale inventory warnings",
          status: "in_review",
          priority: "high",
          description: "Follow the updated warehouse refresh plan.",
        },
        assigneeName: "Michelle (SDE-2)",
        projectName: "HR-System",
        parentIdentifier: "HRH-12",
      }),
    ).toBe(
      "*Summary*\n- HRH-28: Refresh stale inventory warnings\n- Status: in review. Priority: high. Assignee: Michelle (SDE-2). Project: HR-System.\n- Parent: HRH-12. Brief: Follow the updated warehouse refresh plan.",
    );
  });
});

describe("buildSlackProjectOverviewSummary", () => {
  it("renders a project overview summary for project-status queries", () => {
    expect(
      buildSlackProjectOverviewSummary({
        projectName: "HR-System",
        agentsById: new Map([
          ["agent-1", "Michelle (SDE-2)"],
          ["agent-2", "Nick (SDE-3)"],
        ]),
        issues: [
          {
            identifier: "HRH-28",
            title: "Refresh stale inventory warnings",
            status: "in_review",
            assigneeAgentId: "agent-1",
            updatedAt: "2026-03-17T09:30:00.000Z",
          },
          {
            identifier: "HRH-25",
            title: "Add warehouse replay controls",
            status: "todo",
            assigneeAgentId: "agent-2",
            updatedAt: "2026-03-17T08:30:00.000Z",
          },
          {
            identifier: "HRH-20",
            title: "Close payroll retry audit",
            status: "done",
            assigneeAgentId: "agent-2",
            updatedAt: "2026-03-17T07:30:00.000Z",
          },
        ],
      }),
    ).toBe(
      "*Summary*\n- 3 tickets in HR-System: 1 todo, 1 in review, 1 done.\n- Active: HRH-28 Refresh stale inventory warnings (in review, Michelle (SDE-2)); HRH-25 Add warehouse replay controls (todo, Nick (SDE-3))\n- Recent completions: HRH-20 Close payroll retry audit (done, Nick (SDE-3))",
    );
  });
});

describe("buildSlackControlQueryReply", () => {
  it("prefers a project overview when the query targets the current project channel", () => {
    expect(
      buildSlackControlQueryReply({
        fallbackReply: "Acknowledged. I’ll provide a current status briefing for the HR-System project.",
        projectName: "HR-System",
        agentsById: new Map([["agent-1", "Michelle (SDE-2)"]]),
        issues: [
          {
            identifier: "HRH-28",
            title: "Refresh stale inventory warnings",
            status: "in_review",
            assigneeAgentId: "agent-1",
            updatedAt: "2026-03-17T09:30:00.000Z",
          },
        ],
      }),
    ).toBe(
      "*Summary*\n- 1 tickets in HR-System: 1 in review.\n- Active: HRH-28 Refresh stale inventory warnings (in review, Michelle (SDE-2))\n- Recent completions: none yet.",
    );
  });
});
