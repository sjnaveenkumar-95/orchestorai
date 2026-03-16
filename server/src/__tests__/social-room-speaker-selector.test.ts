import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockReadConfigFile = vi.fn();
const mockEnsureCommandResolvable = vi.fn();
const mockEnsurePathInEnv = vi.fn();
const mockRunChildProcess = vi.fn();

vi.mock("../config-file.js", () => ({
  readConfigFile: mockReadConfigFile,
}));

vi.mock("@orchestorai/adapter-utils/server-utils", async () => {
  const actual = await vi.importActual<typeof import("@orchestorai/adapter-utils/server-utils")>(
    "@orchestorai/adapter-utils/server-utils",
  );
  return {
    ...actual,
    ensureCommandResolvable: mockEnsureCommandResolvable,
    ensurePathInEnv: mockEnsurePathInEnv,
    runChildProcess: mockRunChildProcess,
  };
});

const originalFetch = global.fetch;

const {
  selectSocialRoomSpeakers,
} = await import("../social-room/speaker-selector.js");

function buildCodexSelectorStdout(decision: Record<string, unknown>) {
  return [
    JSON.stringify({ type: "thread.started", thread_id: "selector-session-1" }),
    JSON.stringify({
      type: "item.completed",
      item: {
        type: "agent_message",
        text: JSON.stringify(decision),
      },
    }),
    JSON.stringify({
      type: "turn.completed",
      usage: {
        input_tokens: 42,
        output_tokens: 12,
      },
    }),
  ].join("\n");
}

describe("selectSocialRoomSpeakers", () => {
  beforeEach(() => {
    mockReadConfigFile.mockReset();
    mockEnsureCommandResolvable.mockReset();
    mockEnsurePathInEnv.mockReset();
    mockRunChildProcess.mockReset();
    mockEnsureCommandResolvable.mockResolvedValue(undefined);
    mockEnsurePathInEnv.mockImplementation((env) => env);
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("falls back to rotation when no server llm config is available", async () => {
    mockReadConfigFile.mockReturnValue(null);

    const result = await selectSocialRoomSpeakers({
      companyId: "company-1",
      roomId: "room-1",
      mode: "initial_wave",
      maxSelections: 3,
      recentConversationText: "Flutter and Dart update discussion",
      candidates: [
        {
          id: "cto",
          name: "Karthik",
          role: "cto",
          title: "CTO",
          capabilities: "Architecture, Flutter",
          personaDigest: "Technical roadmap and architecture leadership.",
          lastParticipatedAt: new Date("2026-03-13T10:00:00.000Z"),
        },
        {
          id: "dev",
          name: "Michelle",
          role: "engineer",
          title: "Senior Flutter Engineer",
          capabilities: "Flutter, Dart",
          personaDigest: "Builds Flutter features and debugs Dart issues.",
          lastParticipatedAt: new Date("2026-03-13T09:00:00.000Z"),
        },
      ],
      fallbackAgentIds: ["dev", "cto"],
      recentSpeakerAgentIds: [],
    });

    expect(result.source).toBe("fallback");
    expect(result.decision.selectedAgentIds).toEqual(["dev", "cto"]);
    expect(result.fallbackReason).toBe("llm_config_missing");
  });

  it("accepts valid structured selector output from the llm", async () => {
    mockReadConfigFile.mockReturnValue({
      llm: {
        provider: "openai",
      },
    });

    mockRunChildProcess.mockResolvedValue({
      exitCode: 0,
      signal: null,
      timedOut: false,
      stdout: buildCodexSelectorStdout({
        selectedAgentIds: ["cto", "qa"],
        stop: false,
        allowImmediateRepeat: false,
        summary: "Engineering-heavy topic, so CTO and QA should respond first.",
      }),
      stderr: "",
    });

    const result = await selectSocialRoomSpeakers({
      companyId: "company-1",
      roomId: "room-1",
      mode: "initial_wave",
      maxSelections: 3,
      recentConversationText:
        "Flutter and Dart update discussion about rollout risk and mobile test coverage",
      candidates: [
        {
          id: "cto",
          name: "Karthik",
          role: "cto",
          title: "CTO",
          capabilities: "Architecture, Flutter",
          personaDigest: "Technical roadmap and architecture leadership.",
          lastParticipatedAt: new Date("2026-03-13T10:00:00.000Z"),
        },
        {
          id: "qa",
          name: "Priya",
          role: "qa",
          title: "QA Automation Engineer",
          capabilities: "Mobile QA, regression coverage",
          personaDigest: "Owns automation coverage and release risk.",
          lastParticipatedAt: new Date("2026-03-13T08:00:00.000Z"),
        },
        {
          id: "marketing",
          name: "Jordan",
          role: "general",
          title: "Marketing Staff",
          capabilities: "Messaging, launches",
          personaDigest: "Handles launches and external messaging.",
          lastParticipatedAt: new Date("2026-03-13T07:00:00.000Z"),
        },
      ],
      fallbackAgentIds: ["marketing", "qa", "cto"],
      recentSpeakerAgentIds: [],
    });

    expect(result.source).toBe("llm");
    expect(result.decision.selectedAgentIds).toEqual(["cto", "qa"]);
    expect(result.fallbackReason).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
    expect(mockEnsureCommandResolvable).toHaveBeenCalledWith(
      "codex",
      process.cwd(),
      expect.objectContaining(process.env),
    );
    expect(mockRunChildProcess).toHaveBeenCalledTimes(1);
    const [, command, args, options] = mockRunChildProcess.mock.calls[0] ?? [];
    expect(command).toBe("codex");
    expect(args).toEqual(["exec", "--json", "--model", "gpt-5.3-codex", "-"]);
    expect(options).toEqual(
      expect.objectContaining({
        cwd: process.cwd(),
        timeoutSec: 60,
        graceSec: 5,
        stdin: expect.stringContaining("Candidate agents:"),
      }),
    );
  });

  it("uses the configured llm model and reasoning effort when provided", async () => {
    mockReadConfigFile.mockReturnValue({
      llm: {
        provider: "openai",
        model: "gpt-5.4",
        reasoningEffort: "medium",
      },
    });

    mockRunChildProcess.mockResolvedValue({
      exitCode: 0,
      signal: null,
      timedOut: false,
      stdout: buildCodexSelectorStdout({
        selectedAgentIds: ["cto"],
        stop: false,
        allowImmediateRepeat: false,
        summary: "CTO should reply.",
      }),
      stderr: "",
    });

    await selectSocialRoomSpeakers({
      companyId: "company-1",
      roomId: "room-1",
      mode: "initial_wave",
      maxSelections: 1,
      recentConversationText: "Architecture discussion",
      candidates: [
        {
          id: "cto",
          name: "Karthik",
          role: "cto",
          title: "CTO",
          capabilities: "Architecture",
          personaDigest: "Technical roadmap and architecture leadership.",
          lastParticipatedAt: new Date("2026-03-13T10:00:00.000Z"),
        },
      ],
      fallbackAgentIds: ["cto"],
      recentSpeakerAgentIds: [],
    });

    const [, , args] = mockRunChildProcess.mock.calls[0] ?? [];
    expect(args).toEqual([
      "exec",
      "--json",
      "--model",
      "gpt-5.4",
      "-c",
      'model_reasoning_effort="medium"',
      "-",
    ]);
  });

  it("tells the selector to pick one best speaker when only one opening reply is needed", async () => {
    mockReadConfigFile.mockReturnValue({
      llm: {
        provider: "openai",
      },
    });

    mockRunChildProcess.mockResolvedValue({
      exitCode: 0,
      signal: null,
      timedOut: false,
      stdout: buildCodexSelectorStdout({
        selectedAgentIds: ["cto"],
        stop: false,
        allowImmediateRepeat: false,
        summary: "CTO is the best single opener.",
      }),
      stderr: "",
    });

    await selectSocialRoomSpeakers({
      companyId: "company-1",
      roomId: "room-1",
      mode: "initial_wave",
      maxSelections: 1,
      recentConversationText: "Fresh thread about a Flutter migration.",
      candidates: [
        {
          id: "cto",
          name: "Karthik",
          role: "cto",
          title: "CTO",
          capabilities: "Architecture, Flutter",
          personaDigest: "Technical roadmap and architecture leadership.",
          lastParticipatedAt: new Date("2026-03-13T10:00:00.000Z"),
        },
      ],
      fallbackAgentIds: ["cto"],
      recentSpeakerAgentIds: [],
    });

    const [, , , options] = mockRunChildProcess.mock.calls[0] ?? [];
    expect(options).toEqual(
      expect.objectContaining({
        stdin: expect.stringContaining(
          "Pick the single best next speaker, not a representative set of roles.",
        ),
      }),
    );
  });

  it("biases follow-on prompts toward continuing the conversation before stopping", async () => {
    mockReadConfigFile.mockReturnValue({
      llm: {
        provider: "openai",
      },
    });

    mockRunChildProcess.mockResolvedValue({
      exitCode: 0,
      signal: null,
      timedOut: false,
      stdout: buildCodexSelectorStdout({
        selectedAgentIds: [],
        stop: true,
        allowImmediateRepeat: false,
        summary: "The thread is clearly exhausted.",
      }),
      stderr: "",
    });

    await selectSocialRoomSpeakers({
      companyId: "company-1",
      roomId: "room-1",
      mode: "follow_on",
      maxSelections: 2,
      recentConversationText: "Casual banter about meeting chaos and who should pile on next",
      candidates: [
        {
          id: "ops",
          name: "Casey",
          role: "operations",
          title: "Operations Lead",
          capabilities: "Process, coordination",
          personaDigest: "Keeps conversations moving and reacts to process chaos.",
          lastParticipatedAt: new Date("2026-03-13T10:00:00.000Z"),
        },
      ],
      fallbackAgentIds: ["ops"],
      recentSpeakerAgentIds: [],
    });

    const [, , , options] = mockRunChildProcess.mock.calls[0] ?? [];
    expect(options).toEqual(
      expect.objectContaining({
        stdin: expect.stringContaining(
          "In follow_on mode, prefer continuing with a natural next reply unless the thread is clearly exhausted.",
        ),
      }),
    );
  });

  it("falls back when the llm returns an invalid immediate repeat", async () => {
    mockReadConfigFile.mockReturnValue({
      llm: {
        provider: "openai",
      },
    });

    mockRunChildProcess.mockResolvedValue({
      exitCode: 0,
      signal: null,
      timedOut: false,
      stdout: buildCodexSelectorStdout({
        selectedAgentIds: ["cto"],
        stop: false,
        allowImmediateRepeat: false,
        summary: "CTO should keep talking.",
      }),
      stderr: "",
    });

    const result = await selectSocialRoomSpeakers({
      companyId: "company-1",
      roomId: "room-1",
      mode: "follow_on",
      maxSelections: 1,
      recentConversationText: "Follow-up on the same Flutter thread",
      immediatePreviousSpeakerAgentId: "cto",
      candidates: [
        {
          id: "cto",
          name: "Karthik",
          role: "cto",
          title: "CTO",
          capabilities: "Architecture, Flutter",
          personaDigest: "Technical roadmap and architecture leadership.",
          lastParticipatedAt: new Date("2026-03-13T10:00:00.000Z"),
        },
        {
          id: "qa",
          name: "Priya",
          role: "qa",
          title: "QA Automation Engineer",
          capabilities: "Mobile QA, regression coverage",
          personaDigest: "Owns automation coverage and release risk.",
          lastParticipatedAt: new Date("2026-03-13T08:00:00.000Z"),
        },
      ],
      fallbackAgentIds: ["qa"],
      recentSpeakerAgentIds: ["cto"],
    });

    expect(result.source).toBe("fallback");
    expect(result.decision.selectedAgentIds).toEqual(["qa"]);
    expect(result.fallbackReason).toBe("selector_invalid");
  });

  it("falls back when the local codex selector process fails", async () => {
    mockReadConfigFile.mockReturnValue({
      llm: {
        provider: "openai",
      },
    });
    mockRunChildProcess.mockRejectedValue(new Error("codex failed"));

    const result = await selectSocialRoomSpeakers({
      companyId: "company-1",
      roomId: "room-1",
      mode: "follow_on",
      maxSelections: 1,
      recentConversationText: "What changed in the latest Dart release?",
      candidates: [
        {
          id: "dev",
          name: "Michelle",
          role: "engineer",
          title: "Senior Flutter Engineer",
          capabilities: "Flutter, Dart",
          personaDigest: "Builds Flutter features and debugs Dart issues.",
          lastParticipatedAt: new Date("2026-03-13T09:00:00.000Z"),
        },
      ],
      fallbackAgentIds: ["dev"],
      recentSpeakerAgentIds: [],
    });

    expect(result.source).toBe("fallback");
    expect(result.decision.selectedAgentIds).toEqual(["dev"]);
    expect(result.fallbackReason).toBe("selector_error");
  });
});
