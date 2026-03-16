import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  resetAgentPersonaDigestCacheForTests,
  resolveAgentPersonaDigest,
} from "../social-room/agent-persona-digest.js";

describe("resolveAgentPersonaDigest", () => {
  let tempDir = "";

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "orchestorai-agent-digest-"));
    resetAgentPersonaDigestCacheForTests();
  });

  afterEach(async () => {
    resetAgentPersonaDigestCacheForTests();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("refreshes the digest when the agent home files change on disk", async () => {
    const instructionsPath = path.resolve(tempDir, "AGENTS.md");
    const soulPath = path.resolve(tempDir, "SOUL.md");

    await fs.writeFile(instructionsPath, "# Identity\n- Flutter engineer who lives in Dart land.", "utf8");
    await fs.writeFile(soulPath, "Dry humor and release anxiety.", "utf8");

    const first = await resolveAgentPersonaDigest({
      id: "agent-1",
      name: "Michelle",
      role: "engineer",
      title: "Senior Flutter Engineer",
      capabilities: "Flutter, Dart",
      adapterConfig: {
        instructionsFilePath: instructionsPath,
      },
    });

    expect(first.digest).toContain("Flutter engineer");

    await fs.writeFile(instructionsPath, "# Identity\n- Flutter engineer who now obsesses over testing.", "utf8");

    const second = await resolveAgentPersonaDigest({
      id: "agent-1",
      name: "Michelle",
      role: "engineer",
      title: "Senior Flutter Engineer",
      capabilities: "Flutter, Dart",
      adapterConfig: {
        instructionsFilePath: instructionsPath,
      },
    });

    expect(second.digest).toContain("obsesses over testing");
  });
});
