import { describe, expect, it } from "vitest";
import {
  deriveSocialRoomThreadStatusFromHeartbeatEvent,
  formatSocialRoomThreadProgressStatus,
} from "../services/slack-integrations.js";

describe("deriveSocialRoomThreadStatusFromHeartbeatEvent", () => {
  it("maps queued and running heartbeats to progress statuses", () => {
    expect(
      deriveSocialRoomThreadStatusFromHeartbeatEvent({
        eventType: "heartbeat.run.queued",
        hasActiveResponders: true,
      }),
    ).toBe("Selecting responders...");

    expect(
      deriveSocialRoomThreadStatusFromHeartbeatEvent({
        eventType: "heartbeat.run.status",
        runStatus: "running",
        hasActiveResponders: true,
      }),
    ).toBe("Waiting for replies...");
  });

  it("keeps waiting status while responders are still active", () => {
    expect(
      deriveSocialRoomThreadStatusFromHeartbeatEvent({
        eventType: "heartbeat.run.status",
        runStatus: "failed",
        hasActiveResponders: true,
      }),
    ).toBe("Waiting for replies...");
  });

  it("clears status on terminal heartbeat state when no responders are active", () => {
    expect(
      deriveSocialRoomThreadStatusFromHeartbeatEvent({
        eventType: "heartbeat.run.status",
        runStatus: "succeeded",
        hasActiveResponders: false,
      }),
    ).toBe("");
  });
});

describe("formatSocialRoomThreadProgressStatus", () => {
  it("shows the active replying agent when one responder is running", () => {
    expect(
      formatSocialRoomThreadProgressStatus({
        activeResponders: [{ agentName: "Nick", runStatus: "running" }],
        followOnPending: false,
      }),
    ).toBe("Nick is replying...");
  });

  it("shows waiting responder names when responders are queued", () => {
    expect(
      formatSocialRoomThreadProgressStatus({
        activeResponders: [
          { agentName: "Nick", runStatus: "queued" },
          { agentName: "Karthik", runStatus: "queued" },
        ],
        followOnPending: false,
      }),
    ).toBe("Waiting on Nick and Karthik...");
  });

  it("shows the running agent and queued remainder when multiple responders are active", () => {
    expect(
      formatSocialRoomThreadProgressStatus({
        activeResponders: [
          { agentName: "Nick", runStatus: "running" },
          { agentName: "Karthik", runStatus: "queued" },
          { agentName: "Avery", runStatus: "queued" },
        ],
        followOnPending: false,
      }),
    ).toBe("Nick is replying... 2 more queued.");
  });

  it("shows follow-on selection progress when no responders are active", () => {
    expect(
      formatSocialRoomThreadProgressStatus({
        activeResponders: [],
        followOnPending: true,
      }),
    ).toBe("Choosing the next speaker...");
  });
});
