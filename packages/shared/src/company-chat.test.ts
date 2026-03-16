import { describe, expect, it } from "vitest";
import { createCompanyChatReactionSchema } from "./validators/company-chat.js";

describe("createCompanyChatReactionSchema", () => {
  it("accepts valid Slack emoji names", () => {
    expect(createCompanyChatReactionSchema.parse({ emoji: "thumbsup" })).toEqual({
      emoji: "thumbsup",
    });
    expect(createCompanyChatReactionSchema.parse({ emoji: "party_parrot" })).toEqual({
      emoji: "party_parrot",
    });
  });

  it("rejects invalid emoji names", () => {
    expect(() => createCompanyChatReactionSchema.parse({ emoji: "party parrot" })).toThrow();
    expect(() => createCompanyChatReactionSchema.parse({ emoji: ":joy:" })).toThrow();
  });
});
