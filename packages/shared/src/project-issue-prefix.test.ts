import { describe, expect, it } from "vitest";
import { deriveProjectIssuePrefixBase } from "./project-issue-prefix.js";

describe("deriveProjectIssuePrefixBase", () => {
  it("uses the first three letters for single-word project names", () => {
    expect(deriveProjectIssuePrefixBase("Eyalty")).toBe("EYA");
  });

  it("keeps short acronym tokens before adding the next token initial", () => {
    expect(deriveProjectIssuePrefixBase("AI Auto expe")).toBe("AIA");
  });

  it("ignores generic suffix words when deriving the prefix", () => {
    expect(deriveProjectIssuePrefixBase("Test Project")).toBe("TES");
    expect(deriveProjectIssuePrefixBase("Eyalty App")).toBe("EYA");
  });
});
