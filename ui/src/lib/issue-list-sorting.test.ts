import { describe, expect, it } from "vitest";
import { queryKeys } from "./queryKeys";
import { defaultIssueListViewState, sortIssuesForView } from "./issue-list-sorting";

function makeIssue(
  overrides: Partial<{
    id: string;
    status: string;
    priority: string;
    etaAt: string | null;
    updatedAt: string;
    createdAt: string;
    title: string;
  }> = {},
) {
  return {
    id: "issue-default",
    companyId: "company-1",
    projectId: null,
    goalId: null,
    parentId: null,
    title: "Default issue",
    description: null,
    status: "todo",
    priority: "medium",
    assigneeAgentId: null,
    assigneeUserId: null,
    checkoutRunId: null,
    executionRunId: null,
    executionAgentNameKey: null,
    executionLockedAt: null,
    createdByAgentId: null,
    createdByUserId: null,
    issueNumber: null,
    identifier: null,
    requestDepth: 0,
    billingCode: null,
    assigneeAdapterOverrides: null,
    startedAt: null,
    etaAt: null,
    completedAt: null,
    cancelledAt: null,
    hiddenAt: null,
    createdAt: "2026-03-19T09:00:00.000Z",
    updatedAt: "2026-03-19T10:00:00.000Z",
    ...overrides,
  };
}

describe("issue-list-sorting", () => {
  it("defaults issue list view state to ETA urgency ordering", () => {
    expect(defaultIssueListViewState.sortField).toBe("eta_urgency");
  });

  it("orders ETA-bearing issues before TBD and terminal items", () => {
    const ordered = sortIssuesForView([
      makeIssue({
        id: "tbd-critical",
        priority: "critical",
      }),
      makeIssue({
        id: "later-eta",
        status: "in_progress",
        etaAt: "2026-03-19T14:00:00.000Z",
      }),
      makeIssue({
        id: "earlier-eta",
        etaAt: "2026-03-19T12:00:00.000Z",
      }),
      makeIssue({
        id: "done-issue",
        status: "done",
        etaAt: "2026-03-19T08:00:00.000Z",
      }),
    ], {
      ...defaultIssueListViewState,
      sortField: "eta_urgency",
      sortDir: "asc",
    });

    expect(ordered.map((issue) => issue.id)).toEqual([
      "earlier-eta",
      "later-eta",
      "tbd-critical",
      "done-issue",
    ]);
  });

  it("separates cached issue searches by sort mode", () => {
    expect(
      queryKeys.issues.search("company-1", "eta", "project-1", "eta_urgency"),
    ).not.toEqual(
      queryKeys.issues.search("company-1", "eta", "project-1", "priority"),
    );
  });
});
