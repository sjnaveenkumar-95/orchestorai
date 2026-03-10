import { describe, expect, it } from "vitest";
import { sessionCodec as claudeSessionCodec } from "@orchestorai/adapter-claude-local/server";
import { sessionCodec as codexSessionCodec, isCodexUnknownSessionError } from "@orchestorai/adapter-codex-local/server";

describe("adapter session codecs", () => {
  it("normalizes claude session params with cwd", () => {
    const parsed = claudeSessionCodec.deserialize({
      session_id: "claude-session-1",
      folder: "/tmp/workspace",
    });
    expect(parsed).toEqual({
      sessionId: "claude-session-1",
      cwd: "/tmp/workspace",
    });

    const serialized = claudeSessionCodec.serialize(parsed);
    expect(serialized).toEqual({
      sessionId: "claude-session-1",
      cwd: "/tmp/workspace",
    });
    expect(claudeSessionCodec.getDisplayId?.(serialized ?? null)).toBe("claude-session-1");
  });

  it("normalizes codex session params with cwd", () => {
    const parsed = codexSessionCodec.deserialize({
      sessionId: "codex-session-1",
      cwd: "/tmp/codex",
    });
    expect(parsed).toEqual({
      sessionId: "codex-session-1",
      cwd: "/tmp/codex",
    });

    const serialized = codexSessionCodec.serialize(parsed);
    expect(serialized).toEqual({
      sessionId: "codex-session-1",
      cwd: "/tmp/codex",
    });
    expect(codexSessionCodec.getDisplayId?.(serialized ?? null)).toBe("codex-session-1");
  });

  it("rewrites legacy .paperclip cwd values when ORCHESTORAI_HOME is set", () => {
    const previousOrchestoraiHome = process.env.ORCHESTORAI_HOME;
    process.env.ORCHESTORAI_HOME = "/Users/naveenkumar/.orchestorai";

    try {
      expect(
        claudeSessionCodec.deserialize({
          session_id: "claude-session-legacy",
          folder: "/Users/naveenkumar/.paperclip/instances/default/agents/cto",
        }),
      ).toEqual({
        sessionId: "claude-session-legacy",
        cwd: "/Users/naveenkumar/.orchestorai/instances/default/agents/cto",
      });

      expect(
        codexSessionCodec.serialize({
          sessionId: "codex-session-legacy",
          cwd: "/Users/naveenkumar/.paperclip/instances/default/agents/priya",
        }),
      ).toEqual({
        sessionId: "codex-session-legacy",
        cwd: "/Users/naveenkumar/.orchestorai/instances/default/agents/priya",
      });
    } finally {
      if (previousOrchestoraiHome === undefined) {
        delete process.env.ORCHESTORAI_HOME;
      } else {
        process.env.ORCHESTORAI_HOME = previousOrchestoraiHome;
      }
    }
  });
});

describe("codex resume recovery detection", () => {
  it("detects unknown session errors from codex output", () => {
    expect(
      isCodexUnknownSessionError(
        '{"type":"error","message":"Unknown session id abc"}',
        "",
      ),
    ).toBe(true);
    expect(
      isCodexUnknownSessionError(
        "",
        "thread 123 not found",
      ),
    ).toBe(true);
    expect(
      isCodexUnknownSessionError(
        '{"type":"result","ok":true}',
        "",
      ),
    ).toBe(false);
  });
});
