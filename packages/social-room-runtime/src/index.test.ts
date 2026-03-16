import { describe, expect, it } from "vitest";
import {
  buildDefaultSocialRoomPromptPack,
  classifySocialRoomThreadCompletion,
  composeSocialRoomInstructions,
  countConsecutiveAgentMessages,
  DEFAULT_SOCIAL_ROOM_FOLLOW_ON_DEBOUNCE_MS,
  DEFAULT_SOCIAL_ROOM_FOLLOW_ON_TARGET,
  DEFAULT_SOCIAL_ROOM_THREAD_EXPIRY_MINUTES,
  evaluateAutonomousStartEligibility,
  extractMentionedSocialSpeakerAgentIds,
  findSocialRoomReplayMessageForAgentRun,
  resolveSocialRoomIncomingWakePlan,
  shortlistSocialSpeakerCandidates,
  shouldAutoExpireSocialRoomThread,
  validateSocialSpeakerSelectionDecision,
} from "./index.js";

describe("buildDefaultSocialRoomPromptPack", () => {
  it("creates casual room prompts with the company name", () => {
    const promptPack = buildDefaultSocialRoomPromptPack("Androventure");
    expect(promptPack.system).toContain("Androventure");
    expect(promptPack.agents).toContain("company_chat_*");
    expect(promptPack.soul).toContain("breakroom energy");
    expect(promptPack.system).toContain("1 to 3 short sentences");
    expect(promptPack.agents).toContain("Do not echo the same acknowledgment");
  });
});

describe("classifySocialRoomThreadCompletion", () => {
  it("marks explicit wrap-up language as done", () => {
    expect(
      classifySocialRoomThreadCompletion([
        { authorType: "user", text: "That manager update was ridiculous." },
        { authorType: "agent", text: "Agreed, but that is probably a good place to stop." },
      ]),
    ).toBe("done");
  });

  it("keeps open questions as ongoing", () => {
    expect(
      classifySocialRoomThreadCompletion([
        { authorType: "agent", text: "Should we keep digging into that rumor?" },
      ]),
    ).toBe("ongoing");
  });
});

describe("evaluateAutonomousStartEligibility", () => {
  it("allows a new autonomous thread only when the room is idle and the last thread is done", () => {
    const result = evaluateAutonomousStartEligibility({
      autonomousStartEnabled: true,
      activeAutonomousThreads: 1,
      maxAutonomousThreads: 3,
      idleThresholdHours: 3,
      lastRoomActivityAt: new Date("2026-03-13T06:00:00.000Z"),
      now: new Date("2026-03-13T10:00:00.000Z"),
      lastThreadAssessment: "done",
    });

    expect(result).toEqual({ allowed: true, reason: "idle_and_done" });
  });

  it("blocks when the last thread is still ongoing", () => {
    const result = evaluateAutonomousStartEligibility({
      autonomousStartEnabled: true,
      activeAutonomousThreads: 0,
      maxAutonomousThreads: 3,
      idleThresholdHours: 3,
      lastRoomActivityAt: new Date("2026-03-13T06:00:00.000Z"),
      now: new Date("2026-03-13T10:00:00.000Z"),
      lastThreadAssessment: "ongoing",
    });

    expect(result).toEqual({ allowed: false, reason: "last_thread_not_done" });
  });
});

describe("social-room timing defaults", () => {
  it("uses the livelier follow-on tuning defaults", () => {
    expect(DEFAULT_SOCIAL_ROOM_FOLLOW_ON_TARGET).toBe(2);
    expect(DEFAULT_SOCIAL_ROOM_FOLLOW_ON_DEBOUNCE_MS).toBe(8_000);
    expect(DEFAULT_SOCIAL_ROOM_THREAD_EXPIRY_MINUTES).toBe(60);
  });
});

describe("shouldAutoExpireSocialRoomThread", () => {
  it("expires a non-done thread after 60 minutes of inactivity", () => {
    expect(
      shouldAutoExpireSocialRoomThread({
        assessment: "unclear",
        lastActivityAt: new Date("2026-03-13T10:00:00.000Z"),
        now: new Date("2026-03-13T11:00:00.000Z"),
      }),
    ).toBe(true);
  });

  it("does not expire a thread that is already done or still fresh", () => {
    expect(
      shouldAutoExpireSocialRoomThread({
        assessment: "done",
        lastActivityAt: new Date("2026-03-13T10:00:00.000Z"),
        now: new Date("2026-03-13T12:30:00.000Z"),
      }),
    ).toBe(false);

    expect(
      shouldAutoExpireSocialRoomThread({
        assessment: "ongoing",
        lastActivityAt: new Date("2026-03-13T10:00:00.000Z"),
        now: new Date("2026-03-13T10:45:00.000Z"),
      }),
    ).toBe(false);
  });
});

describe("findSocialRoomReplayMessageForAgentRun", () => {
  it("returns the existing matching agent message when the same run retries the same text", () => {
    const replay = findSocialRoomReplayMessageForAgentRun({
      runStartedAt: new Date("2026-03-13T14:11:52.303Z"),
      agentId: "ceo",
      text: "Loud and clear. CEO microphone budget remains fully approved.",
      messages: [
        {
          id: "before-run",
          authorAgentId: "ceo",
          text: "Loud and clear. CEO microphone budget remains fully approved.",
          createdAt: new Date("2026-03-13T14:10:00.000Z"),
        },
        {
          id: "during-run",
          authorAgentId: "ceo",
          text: "Loud and clear. CEO microphone budget remains fully approved.",
          createdAt: new Date("2026-03-13T14:12:25.921Z"),
        },
      ],
    });

    expect(replay?.id).toBe("during-run");
  });

  it("ignores messages from a different agent or a different text", () => {
    const replay = findSocialRoomReplayMessageForAgentRun({
      runStartedAt: new Date("2026-03-13T14:11:52.303Z"),
      agentId: "ceo",
      text: "Loud and clear. CEO microphone budget remains fully approved.",
      messages: [
        {
          id: "other-agent",
          authorAgentId: "cto",
          text: "Loud and clear. CEO microphone budget remains fully approved.",
          createdAt: new Date("2026-03-13T14:12:25.921Z"),
        },
        {
          id: "other-text",
          authorAgentId: "ceo",
          text: "Different reply.",
          createdAt: new Date("2026-03-13T14:12:25.921Z"),
        },
      ],
    });

    expect(replay).toBeNull();
  });
});

describe("resolveSocialRoomIncomingWakePlan", () => {
  it("uses a single selected opener when a new human thread starts", () => {
    expect(
      resolveSocialRoomIncomingWakePlan({
        authorType: "user",
        threadMessageCount: 1,
      }),
    ).toEqual({
      shouldWake: true,
      reason: "company_chat_thread_opened",
      mode: "initial_wave",
      maxSelections: 1,
    });
  });

  it("uses a single selected opener when an autonomous agent thread starts", () => {
    expect(
      resolveSocialRoomIncomingWakePlan({
        authorType: "agent",
        threadMessageCount: 1,
      }),
    ).toEqual({
      shouldWake: true,
      reason: "company_chat_thread_opened",
      mode: "initial_wave",
      maxSelections: 1,
    });
  });

  it("keeps the existing multi-agent wave for later human replies", () => {
    expect(
      resolveSocialRoomIncomingWakePlan({
        authorType: "user",
        threadMessageCount: 3,
        initialWaveTarget: 3,
      }),
    ).toEqual({
      shouldWake: true,
      reason: "company_chat_human_post",
      mode: "initial_wave",
      maxSelections: 3,
    });
  });

  it("does not wake a fresh wave for later agent replies", () => {
    expect(
      resolveSocialRoomIncomingWakePlan({
        authorType: "agent",
        threadMessageCount: 2,
      }),
    ).toEqual({
      shouldWake: false,
      reason: null,
      mode: null,
      maxSelections: 0,
    });
  });
});

describe("composeSocialRoomInstructions", () => {
  it("combines base persona files, room prompt files, and a context brief", () => {
    const rendered = composeSocialRoomInstructions({
      baseFiles: {
        agents: {
          label: "Base Agent AGENTS",
          path: "/tmp/agent/AGENTS.md",
          content: "You are the QA lead.",
        },
        soul: {
          label: "Base Agent SOUL",
          path: "/tmp/agent/SOUL.md",
          content: "Dry humor, sharp memory.",
        },
      },
      roomFiles: {
        system: {
          label: "Social Room SYSTEM",
          path: "/tmp/room/SYSTEM.md",
          content: "General discussion only.",
        },
        agents: {
          label: "Social Room AGENTS",
          path: "/tmp/room/AGENTS.md",
          content: "Social participation is in scope.",
        },
        soul: {
          label: "Social Room SOUL",
          path: "/tmp/room/SOUL.md",
          content: "Coffee-break energy.",
        },
      },
      contextBrief: "Room thread: gossip about sprint planning.",
    });

    expect(rendered).toContain("General discussion only.");
    expect(rendered).toContain("You are the QA lead.");
    expect(rendered).toContain("Coffee-break energy.");
    expect(rendered).toContain("Room thread: gossip about sprint planning.");
  });
});

describe("shortlistSocialSpeakerCandidates", () => {
  it("prioritizes engineering voices for Flutter and Dart conversations while keeping a cameo slot", () => {
    const shortlist = shortlistSocialSpeakerCandidates({
      maxCandidates: 12,
      recentConversationText:
        "Flutter and Dart are changing again after the latest SDK update. We need to talk through dev impact, test coverage, and rollout risk.",
      candidates: [
        {
          id: "cto",
          name: "Karthik",
          role: "cto",
          title: "CTO",
          capabilities: "Architecture, Flutter, Dart, engineering leadership",
          personaDigest: "Owns technical roadmap and architecture decisions across the engineering org.",
          lastParticipatedAt: new Date("2026-03-13T08:00:00.000Z"),
        },
        {
          id: "dev",
          name: "Michelle",
          role: "engineer",
          title: "Senior Flutter Engineer",
          capabilities: "Flutter, Dart, mobile app development",
          personaDigest: "Builds Flutter features, debugs Dart issues, and ships mobile releases.",
          lastParticipatedAt: new Date("2026-03-13T09:00:00.000Z"),
        },
        {
          id: "qa",
          name: "Priya",
          role: "qa",
          title: "QA Automation Engineer",
          capabilities: "Regression testing, mobile QA, test coverage",
          personaDigest: "Focuses on test stability, automation coverage, and release risk.",
          lastParticipatedAt: new Date("2026-03-13T10:00:00.000Z"),
        },
        {
          id: "marketing",
          name: "Jordan",
          role: "general",
          title: "Marketing Staff",
          capabilities: "Messaging, launches, campaigns",
          personaDigest: "Focuses on messaging tests, launches, and audience communication.",
          lastParticipatedAt: new Date("2026-03-12T10:00:00.000Z"),
        },
      ],
      recentSpeakerAgentIds: ["dev"],
    });

    expect(shortlist.candidates.slice(0, 3).map((candidate) => candidate.id)).toEqual(
      expect.arrayContaining(["cto", "qa", "dev"]),
    );
    expect(shortlist.candidates.slice(0, 3).map((candidate) => candidate.id)).not.toContain("marketing");
    expect(shortlist.cameoCandidateIds).toContain("marketing");
  });

  it("prioritizes explicitly mentioned colleagues even when they are less relevant lexically", () => {
    const shortlist = shortlistSocialSpeakerCandidates({
      maxCandidates: 4,
      recentConversationText: "@avery can you weigh in on the standup chaos too?",
      preferredAgentIds: ["pm"],
      candidates: [
        {
          id: "cto",
          name: "Karthik",
          role: "cto",
          title: "CTO",
          capabilities: "Architecture",
          personaDigest: "Owns architecture and engineering direction.",
          lastParticipatedAt: new Date("2026-03-13T08:00:00.000Z"),
        },
        {
          id: "pm",
          name: "Avery",
          role: "pm",
          title: "Project Manager",
          capabilities: "Coordination",
          personaDigest: "Keeps standups moving and cleans up process chaos.",
          lastParticipatedAt: new Date("2026-03-13T09:00:00.000Z"),
        },
      ],
      recentSpeakerAgentIds: [],
    });

    expect(shortlist.candidates[0]?.id).toBe("pm");
  });
});

describe("extractMentionedSocialSpeakerAgentIds", () => {
  it("detects explicit agent mentions by @slug and unique first name", () => {
    const result = extractMentionedSocialSpeakerAgentIds({
      text: "@avery I agree, but Nick should probably answer that one.",
      candidates: [
        {
          id: "pm",
          name: "Avery",
          title: "Project Manager",
        },
        {
          id: "eng",
          name: "Nick",
          title: "Engineer",
        },
      ],
    });

    expect(result).toEqual(["pm", "eng"]);
  });
});

describe("validateSocialSpeakerSelectionDecision", () => {
  it("rejects immediate repeats unless the selector explicitly allows them", () => {
    const rejected = validateSocialSpeakerSelectionDecision({
      mode: "follow_on",
      maxSelections: 1,
      immediatePreviousSpeakerAgentId: "cto",
      fallbackDecision: {
        selectedAgentIds: [],
        stop: false,
        allowImmediateRepeat: false,
        summary: "fallback",
      },
      candidateIds: new Set(["cto", "qa"]),
      decision: {
        selectedAgentIds: ["cto"],
        stop: false,
        allowImmediateRepeat: false,
        summary: "CTO should keep going",
      },
      cameoCandidateIds: new Set(),
    });

    expect(rejected.selectedAgentIds).toEqual([]);
    expect(rejected.stop).toBe(true);

    const accepted = validateSocialSpeakerSelectionDecision({
      mode: "follow_on",
      maxSelections: 1,
      immediatePreviousSpeakerAgentId: "cto",
      fallbackDecision: {
        selectedAgentIds: [],
        stop: false,
        allowImmediateRepeat: false,
        summary: "fallback",
      },
      candidateIds: new Set(["cto", "qa"]),
      decision: {
        selectedAgentIds: ["cto"],
        stop: false,
        allowImmediateRepeat: true,
        summary: "CTO should keep going",
      },
      cameoCandidateIds: new Set(),
    });

    expect(accepted.selectedAgentIds).toEqual(["cto"]);
    expect(accepted.allowImmediateRepeat).toBe(true);
  });
});

describe("countConsecutiveAgentMessages", () => {
  it("counts the trailing agent-only chain after the last human or system message", () => {
    expect(
      countConsecutiveAgentMessages([
        { authorType: "user", text: "Anyone seen the Flutter release notes?" },
        { authorType: "agent", text: "Yes, Dart got a few analyzer tweaks." },
        { authorType: "agent", text: "The test suite will definitely notice." },
      ]),
    ).toBe(2);
  });
});
