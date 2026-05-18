import { describe, expect, it } from "vitest";
import {
  describeIssueUpdate,
  formatIssueActivityAction,
} from "./issue-update-descriptions";

describe("describeIssueUpdate", () => {
  it("includes ETA changes in update summaries", () => {
    expect(
      describeIssueUpdate({
        etaAt: "2026-03-18T17:30:00.000Z",
        _previous: {
          etaAt: null,
        },
      }),
    ).toBe("ETA -> 2026-03-18 17:30 UTC");
  });
});

describe("formatIssueActivityAction", () => {
  it("describes ETA diffs in the issue timeline", () => {
    expect(
      formatIssueActivityAction("issue.updated", {
        etaAt: "2026-03-18T19:00:00.000Z",
        _previous: {
          etaAt: "2026-03-18T17:30:00.000Z",
        },
      }),
    ).toBe("changed the ETA from 2026-03-18 17:30 UTC to 2026-03-18 19:00 UTC");
  });
});
