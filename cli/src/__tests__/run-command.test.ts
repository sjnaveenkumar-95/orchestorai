import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ORIGINAL_ENV = { ...process.env };
const ORIGINAL_STDIN_IS_TTY = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
const ORIGINAL_STDOUT_IS_TTY = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");

function setTTY(stdinIsTTY: boolean, stdoutIsTTY: boolean) {
  Object.defineProperty(process.stdin, "isTTY", { value: stdinIsTTY, configurable: true });
  Object.defineProperty(process.stdout, "isTTY", { value: stdoutIsTTY, configurable: true });
}

describe("runCommand", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env = { ...ORIGINAL_ENV };
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    if (ORIGINAL_STDIN_IS_TTY) {
      Object.defineProperty(process.stdin, "isTTY", ORIGINAL_STDIN_IS_TTY);
    }
    if (ORIGINAL_STDOUT_IS_TTY) {
      Object.defineProperty(process.stdout, "isTTY", ORIGINAL_STDOUT_IS_TTY);
    }
    vi.restoreAllMocks();
    vi.unmock("@clack/prompts");
    vi.unmock("../commands/onboard.js");
    vi.unmock("../commands/doctor.js");
    vi.unmock("../config/store.js");
    vi.unmock("../config/home.js");
    vi.unmock("node:fs");
  });

  it("auto-onboards with quickstart defaults in non-interactive mode when --yes is set", async () => {
    setTTY(false, false);

    const onboard = vi.fn().mockResolvedValue(undefined);
    const doctor = vi.fn().mockResolvedValue({ failed: 1 });
    const mkdirSync = vi.fn();
    const exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation(((code?: number) => {
        throw new Error(`exit:${code ?? 0}`);
      }) as never);

    vi.doMock("@clack/prompts", () => ({
      intro: vi.fn(),
      log: {
        message: vi.fn(),
        error: vi.fn(),
        step: vi.fn(),
      },
    }));
    vi.doMock("../commands/onboard.js", () => ({ onboard }));
    vi.doMock("../commands/doctor.js", () => ({ doctor }));
    vi.doMock("../config/store.js", () => ({
      configExists: vi.fn(() => false),
      resolveConfigPath: vi.fn(() => "/tmp/paperclip-home/instances/default/config.json"),
    }));
    vi.doMock("../config/home.js", () => ({
      resolvePaperclipInstanceId: vi.fn(() => "default"),
      resolvePaperclipHomeDir: vi.fn(() => "/tmp/paperclip-home"),
      describeLocalInstancePaths: vi.fn(() => ({
        homeDir: "/tmp/paperclip-home",
        instanceId: "default",
        instanceRoot: "/tmp/paperclip-home/instances/default",
      })),
    }));
    vi.doMock("node:fs", () => ({
      default: {
        mkdirSync,
        existsSync: vi.fn(() => false),
      },
    }));

    const { runCommand } = await import("../commands/run.js");

    await expect(runCommand({ yes: true })).rejects.toThrow("exit:1");

    expect(onboard).toHaveBeenCalledWith({
      config: "/tmp/paperclip-home/instances/default/config.json",
      invokedByRun: true,
      yes: true,
    });
    expect(doctor).toHaveBeenCalledWith({
      config: "/tmp/paperclip-home/instances/default/config.json",
      repair: true,
      yes: true,
    });
    expect(mkdirSync).toHaveBeenCalledWith("/tmp/paperclip-home", { recursive: true });
    expect(mkdirSync).toHaveBeenCalledWith("/tmp/paperclip-home/instances/default", { recursive: true });
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
