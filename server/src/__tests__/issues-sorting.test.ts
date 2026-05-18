import { describe, expect, it } from "vitest";
import { sortIssuesForList } from "../services/issues.ts";

function makeIssue(
  overrides: Partial<{
    id: string;
    status: string;
    priority: string;
    etaAt: Date | null;
    updatedAt: Date;
  }> = {},
) {
  return {
    id: "issue-default",
    status: "todo",
    priority: "medium",
    etaAt: null,
    updatedAt: new Date("2026-03-19T10:00:00.000Z"),
    ...overrides,
  };
}

describe("sortIssuesForList", () => {
  it("orders ETA-bearing open work before TBD and terminal issues", () => {
    const ordered = sortIssuesForList([
      makeIssue({
        id: "tbd-critical",
        status: "todo",
        priority: "critical",
        etaAt: null,
        updatedAt: new Date("2026-03-19T11:00:00.000Z"),
      }),
      makeIssue({
        id: "later-eta",
        status: "in_progress",
        priority: "low",
        etaAt: new Date("2026-03-19T14:00:00.000Z"),
      }),
      makeIssue({
        id: "earlier-eta",
        status: "todo",
        priority: "medium",
        etaAt: new Date("2026-03-19T12:00:00.000Z"),
      }),
      makeIssue({
        id: "done-issue",
        status: "done",
        priority: "critical",
        etaAt: new Date("2026-03-19T09:00:00.000Z"),
      }),
    ], "eta_urgency");

    expect(ordered.map((issue) => issue.id)).toEqual([
      "earlier-eta",
      "later-eta",
      "tbd-critical",
      "done-issue",
    ]);
  });

  it("preserves legacy manual priority ordering in priority mode", () => {
    const ordered = sortIssuesForList([
      makeIssue({
        id: "medium-eta",
        priority: "medium",
        etaAt: new Date("2026-03-19T09:00:00.000Z"),
      }),
      makeIssue({
        id: "critical-tbd",
        priority: "critical",
        etaAt: null,
      }),
      makeIssue({
        id: "high-later",
        priority: "high",
        etaAt: new Date("2026-03-19T18:00:00.000Z"),
      }),
    ], "priority");

    expect(ordered.map((issue) => issue.id)).toEqual([
      "critical-tbd",
      "high-later",
      "medium-eta",
    ]);
  });
});
