import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { testEnvironment } from "@orchestorai/adapter-claude-local/server";

const ORIGINAL_ANTHROPIC = process.env.ANTHROPIC_API_KEY;

afterEach(() => {
  if (ORIGINAL_ANTHROPIC === undefined) {
    delete process.env.ANTHROPIC_API_KEY;
  } else {
    process.env.ANTHROPIC_API_KEY = ORIGINAL_ANTHROPIC;
  }
});

describe("claude_local environment diagnostics", () => {
  it("returns a warning (not an error) when ANTHROPIC_API_KEY is set in host environment", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-test-host";

    const result = await testEnvironment({
      companyId: "company-1",
      adapterType: "claude_local",
      config: {
        command: process.execPath,
        cwd: process.cwd(),
      },
    });

    expect(result.status).toBe("warn");
    expect(
      result.checks.some(
        (check) =>
          check.code === "claude_anthropic_api_key_overrides_subscription" &&
          check.level === "warn",
      ),
    ).toBe(true);
    expect(result.checks.some((check) => check.level === "error")).toBe(false);
  });

  it("returns a warning (not an error) when ANTHROPIC_API_KEY is set in adapter env", async () => {
    delete process.env.ANTHROPIC_API_KEY;

    const result = await testEnvironment({
      companyId: "company-1",
      adapterType: "claude_local",
      config: {
        command: process.execPath,
        cwd: process.cwd(),
        env: {
          ANTHROPIC_API_KEY: "sk-test-config",
        },
      },
    });

    expect(result.status).toBe("warn");
    expect(
      result.checks.some(
        (check) =>
          check.code === "claude_anthropic_api_key_overrides_subscription" &&
          check.level === "warn",
      ),
    ).toBe(true);
    expect(result.checks.some((check) => check.level === "error")).toBe(false);
  });

  it("creates a missing working directory when cwd is absolute", async () => {
    const cwd = path.join(
      os.tmpdir(),
      `orchestorai-claude-local-cwd-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      "workspace",
    );

    await fs.rm(path.dirname(cwd), { recursive: true, force: true });

    const result = await testEnvironment({
      companyId: "company-1",
      adapterType: "claude_local",
      config: {
        command: process.execPath,
        cwd,
      },
    });

    expect(result.checks.some((check) => check.code === "claude_cwd_valid")).toBe(true);
    expect(result.checks.some((check) => check.level === "error")).toBe(false);
    const stats = await fs.stat(cwd);
    expect(stats.isDirectory()).toBe(true);
    await fs.rm(path.dirname(cwd), { recursive: true, force: true });
  });

  it("rewrites legacy .paperclip cwd paths to the current .orchestorai home", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "orchestorai-claude-legacy-home-"));
    const orchestoraiHome = path.join(root, ".orchestorai");
    const legacyHome = path.join(root, ".paperclip");
    const cwd = path.join(orchestoraiHome, "instances", "default", "agents", "claude-workspace");
    const legacyCwd = path.join(legacyHome, "instances", "default", "agents", "claude-workspace");
    const previousOrchestoraiHome = process.env.ORCHESTORAI_HOME;
    process.env.ORCHESTORAI_HOME = orchestoraiHome;

    try {
      const result = await testEnvironment({
        companyId: "company-1",
        adapterType: "claude_local",
        config: {
          command: process.execPath,
          cwd: legacyCwd,
        },
      });

      expect(result.checks.some((check) => check.code === "claude_cwd_valid")).toBe(true);
      expect(result.checks.some((check) => check.level === "error")).toBe(false);
      expect((await fs.stat(cwd)).isDirectory()).toBe(true);
      await expect(fs.stat(legacyHome)).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      if (previousOrchestoraiHome === undefined) {
        delete process.env.ORCHESTORAI_HOME;
      } else {
        process.env.ORCHESTORAI_HOME = previousOrchestoraiHome;
      }
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
