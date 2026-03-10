import { describe, expect, it, vi } from "vitest";
import type { AdapterExecutionContext, AdapterExecutionResult } from "@orchestorai/adapter-utils";
import { slackActionInterpreterService } from "../services/slack-action-interpreter.js";

function makeInput() {
  return {
    message: {
      companyId: "11111111-1111-1111-1111-111111111111",
      projectId: "22222222-2222-2222-2222-222222222222",
      issueId: null,
      channelId: "C123",
      channelName: "proj-alpha",
      threadTs: "1000.1",
      messageTs: "1000.1",
      authorSlackUserId: "U123",
      authorSlackUserName: null,
      originalText: "Create a ticket for architecture doc and assign it to @arjun",
      normalizedText: "Create a ticket for architecture doc and assign it to @arjun",
      isThreadReply: false,
      isLinkedIssueThread: false,
      isRootProjectMessage: true,
    },
    project: {
      id: "22222222-2222-2222-2222-222222222222",
      name: "Project Alpha",
      urlKey: "project-alpha",
      status: "in_progress",
    },
    linkedIssue: null,
    recentSlackMessages: [],
    recentIssueComments: [],
    candidateAgents: [
      {
        id: "33333333-3333-3333-3333-333333333333",
        name: "Arjun",
        urlKey: "arjun",
        aliases: ["arjun", "architect"],
        slackKeys: ["arjun"],
      },
    ],
    candidateProjects: [],
    candidateIssues: [],
  } as const;
}

function makeResult(overrides?: Partial<AdapterExecutionResult>): AdapterExecutionResult {
  return {
    exitCode: 0,
    signal: null,
    timedOut: false,
    errorMessage: null,
    resultJson: { stdout: "" },
    summary: "",
    ...overrides,
  };
}

describe("slackActionInterpreterService", () => {
  it("parses validated JSON output from Codex", async () => {
    const runCodex = vi.fn(async () =>
      makeResult({
        summary: JSON.stringify({
          actionType: "create_issue",
          targetIssueRef: null,
          targetProjectRef: "22222222-2222-2222-2222-222222222222",
          targetAgentRef: "33333333-3333-3333-3333-333333333333",
          normalizedMutation: {
            title: "Architecture doc",
            assigneeAgentRef: "33333333-3333-3333-3333-333333333333",
            priority: "medium",
          },
          commentaryToPersist: "Assign to architect and start planning.",
          slackReply: "Created a new issue for the architecture doc and assigned it to Arjun.",
          confidence: 0.94,
          needsClarification: false,
          reasons: ["clear create-and-assign request"],
        }),
      }),
    );

    const service = slackActionInterpreterService({
      runCodex,
      instanceSettings: {
        getRuntimeValue(key: string) {
          if (key === "slackInterpreterEnabled") return "true";
          return null;
        },
      } as never,
    });

    const result = await service.interpret(makeInput());

    expect(result.actionType).toBe("create_issue");
    expect(result.targetAgentRef).toBe("33333333-3333-3333-3333-333333333333");
    expect(result.normalizedMutation?.title).toBe("Architecture doc");
    expect(result.needsClarification).toBe(false);
  });

  it("returns clarify when interpreter is disabled", async () => {
    const runCodex = vi.fn();
    const service = slackActionInterpreterService({
      runCodex,
      instanceSettings: {
        getRuntimeValue(key: string) {
          if (key === "slackInterpreterEnabled") return "false";
          return null;
        },
      } as never,
    });

    const result = await service.interpret(makeInput());

    expect(result.actionType).toBe("clarify");
    expect(result.needsClarification).toBe(true);
    expect(runCodex).not.toHaveBeenCalled();
  });

  it("runs Codex in analysis-only mode without heartbeat injection", async () => {
    const runCodex = vi.fn(async (_ctx: AdapterExecutionContext) =>
      makeResult({
        summary: JSON.stringify({
          actionType: "query",
          targetIssueRef: null,
          targetProjectRef: null,
          targetAgentRef: null,
          normalizedMutation: null,
          commentaryToPersist: null,
          slackReply: "No mutation required.",
          confidence: 0.82,
          needsClarification: false,
          reasons: ["read-only question"],
        }),
      }),
    );

    const service = slackActionInterpreterService({
      runCodex,
      instanceSettings: {
        getRuntimeValue(key: string) {
          switch (key) {
            case "slackInterpreterEnabled":
              return "true";
            case "slackInterpreterModel":
              return "gpt-5.4";
            case "slackInterpreterProfile":
              return "slack-control";
            case "slackInterpreterWorkdir":
              return "/tmp/slack-control";
            case "slackInterpreterTimeoutSec":
              return "45";
            case "slackInterpreterContextLimit":
              return "6";
            default:
              return null;
          }
        },
      } as never,
    });

    await service.interpret(makeInput());

    expect(runCodex).toHaveBeenCalledTimes(1);
    const call = runCodex.mock.calls[0]?.[0] as AdapterExecutionContext;
    expect(call.config.injectHeartbeatBrief).toBe(false);
    expect(call.config.cwd).toBe("/tmp/slack-control");
    expect(call.config.model).toBe("gpt-5.4");
    expect(call.config.timeoutSec).toBe(45);
    expect(call.config.extraArgs).toEqual(["--skip-git-repo-check", "--profile", "slack-control"]);
    expect(call.config.promptTemplate).toContain("\"mode\": \"orchestorai_slack_control\"");
    expect(call.config.promptTemplate).toContain(
      "prefer create_child_issue instead of reopening the done issue",
    );
    expect(call.config.promptTemplate).toContain(
      "use recentSlackMessages to continue the thread conversation",
    );
  });

  it("falls back to clarify on invalid Codex output", async () => {
    const runCodex = vi.fn(async () =>
      makeResult({
        summary: "not-json",
      }),
    );

    const service = slackActionInterpreterService({
      runCodex,
      instanceSettings: {
        getRuntimeValue() {
          return "true";
        },
      } as never,
    });

    const result = await service.interpret(makeInput());

    expect(result.actionType).toBe("clarify");
    expect(result.needsClarification).toBe(true);
    expect(result.reasons[0]).toContain("JSON");
  });
});
