import { describe, expect, it } from "vitest";
import {
  generateUniqueReferenceAliases,
  readReferenceAliases,
} from "@orchestorai/shared";
import {
  applyResolvedReferenceAliases,
  resolveEntityReferenceAliases,
} from "../services/reference-aliases.ts";

describe("generateUniqueReferenceAliases", () => {
  it("generates short and full aliases for agents", () => {
    const aliases = generateUniqueReferenceAliases({
      kind: "agent",
      name: "QA Engineer",
    });

    expect(aliases.primaryAlias).toBe("qa");
    expect(aliases.aliases).toEqual(["qa", "qa-engineer"]);
  });

  it("generates short and full aliases for projects", () => {
    const aliases = generateUniqueReferenceAliases({
      kind: "project",
      name: "Eyalty App",
    });

    expect(aliases.primaryAlias).toBe("eyalty");
    expect(aliases.aliases).toEqual(["eyalty", "eyalty-app"]);
  });
});

describe("resolveEntityReferenceAliases", () => {
  it("avoids ambiguous short aliases across agents", () => {
    const aliases = resolveEntityReferenceAliases("agent", [
      {
        id: "agent-1",
        name: "Nick (SDE-2)",
        metadata: null,
        status: "idle",
        createdAt: new Date("2026-03-07T10:00:00.000Z"),
      },
      {
        id: "agent-2",
        name: "Nick (SDE-3)",
        metadata: null,
        status: "idle",
        createdAt: new Date("2026-03-07T10:05:00.000Z"),
      },
    ], {
      shouldReserve: (row) => row.status !== "terminated",
    });

    expect(aliases.get("agent-1")).toMatchObject({
      primaryAlias: "nick",
      aliases: ["nick", "nick-sde-2"],
    });
    expect(aliases.get("agent-2")).toMatchObject({
      primaryAlias: "nick-sde-3",
      aliases: ["nick-sde-3"],
    });
  });

  it("preserves stored aliases and hydrates metadata on read", () => {
    const resolved = resolveEntityReferenceAliases("project", [
      {
        id: "project-1",
        name: "Eyalty App",
        metadata: {
          references: {
            aliasMode: "generated",
            primaryAlias: "eyalty",
            aliases: ["eyalty", "eyalty-app"],
          },
        },
        createdAt: new Date("2026-03-07T09:00:00.000Z"),
      },
      {
        id: "project-2",
        name: "AI Auto Expense Tracker",
        metadata: null,
        createdAt: new Date("2026-03-07T09:05:00.000Z"),
      },
    ]);

    const hydrated = applyResolvedReferenceAliases(
      {
        id: "project-2",
        name: "AI Auto Expense Tracker",
        metadata: null,
      },
      resolved.get("project-2"),
    );

    expect(readReferenceAliases(hydrated.metadata)).toMatchObject({
      primaryAlias: "expense",
      aliases: ["expense", "expense-tracker", "ai-auto-expense-tracker"],
    });
    expect(resolved.get("project-1")).toMatchObject({
      primaryAlias: "eyalty",
      aliases: ["eyalty", "eyalty-app"],
    });
  });
});
