import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  describeLocalInstancePaths,
  expandHomePrefix,
  resolveOrchestorAIHomeDir,
  resolveOrchestorAIInstanceId,
} from "../config/home.js";

const ORIGINAL_ENV = { ...process.env };

describe("home path resolution", () => {
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("defaults to ~/.orchestorai and default instance", () => {
    delete process.env.ORCHESTORAI_HOME;
    delete process.env.ORCHESTORAI_INSTANCE_ID;

    const paths = describeLocalInstancePaths();
    expect(paths.homeDir).toBe(path.resolve(os.homedir(), ".orchestorai"));
    expect(paths.instanceId).toBe("default");
    expect(paths.configPath).toBe(path.resolve(os.homedir(), ".orchestorai", "instances", "default", "config.json"));
  });

  it("supports ORCHESTORAI_HOME and explicit instance ids", () => {
    process.env.ORCHESTORAI_HOME = "~/orchestorai-home";

    const home = resolveOrchestorAIHomeDir();
    expect(home).toBe(path.resolve(os.homedir(), "orchestorai-home"));
    expect(resolveOrchestorAIInstanceId("dev_1")).toBe("dev_1");
  });

  it("rejects invalid instance ids", () => {
    expect(() => resolveOrchestorAIInstanceId("bad/id")).toThrow(/Invalid instance id/);
  });

  it("expands ~ prefixes", () => {
    expect(expandHomePrefix("~")).toBe(os.homedir());
    expect(expandHomePrefix("~/x/y")).toBe(path.resolve(os.homedir(), "x/y"));
  });
});
