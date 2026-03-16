import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@orchestorai/db";

const mockGetThreadById = vi.fn();
const mockCreateMessage = vi.fn();
const mockAttachMessageSlackMetadata = vi.fn();
const mockPostCompanyChatMessage = vi.fn();
const mockSetCompanyChatThreadStatus = vi.fn();
const mockRefreshCompanyChatThreadStatus = vi.fn();

vi.mock("../services/index.js", () => ({
  socialRoomService: () => ({
    getThreadById: mockGetThreadById,
    createMessage: mockCreateMessage,
    attachMessageSlackMetadata: mockAttachMessageSlackMetadata,
  }),
  slackIntegrationService: () => ({
    postCompanyChatMessage: mockPostCompanyChatMessage,
    setCompanyChatThreadStatus: mockSetCompanyChatThreadStatus,
    refreshCompanyChatThreadStatus: mockRefreshCompanyChatThreadStatus,
  }),
  logActivity: vi.fn(),
}));

const { socialRoomRoutes } = await import("../routes/social-room.js");

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).actor = {
      type: "agent",
      companyId: "company-1",
      agentId: "agent-1",
      runId: "run-1",
    };
    next();
  });
  app.use("/api", socialRoomRoutes({} as Db));
  return app;
}

describe("socialRoomRoutes", () => {
  beforeEach(() => {
    mockGetThreadById.mockReset();
    mockCreateMessage.mockReset();
    mockAttachMessageSlackMetadata.mockReset();
    mockPostCompanyChatMessage.mockReset();
    mockSetCompanyChatThreadStatus.mockReset();
    mockRefreshCompanyChatThreadStatus.mockReset();

    mockGetThreadById.mockResolvedValue({
      id: "thread-1",
      companyId: "company-1",
      slackChannelId: "C123",
      slackThreadTs: "1773421651.360429",
    });

    mockCreateMessage.mockResolvedValue({
      deduplicated: false,
      thread: {
        id: "thread-1",
        companyId: "company-1",
        slackChannelId: "C123",
        slackThreadTs: "1773421651.360429",
      },
      message: {
        id: "message-1",
        companyId: "company-1",
        slackChannelId: null,
        slackMessageTs: null,
      },
    });

    mockPostCompanyChatMessage.mockResolvedValue({
      channel: "C123",
      ts: "1773421660.000100",
      threadTs: "1773421651.360429",
    });
    mockAttachMessageSlackMetadata.mockResolvedValue(undefined);
    mockSetCompanyChatThreadStatus.mockResolvedValue(undefined);
    mockRefreshCompanyChatThreadStatus.mockResolvedValue(undefined);
  });

  it("refreshes Slack thread status after mirroring an agent social-room reply", async () => {
    const res = await request(createTestApp())
      .post("/api/chat-threads/thread-1/messages")
      .send({
        text: "I can help with that",
      });

    expect(res.status).toBe(201);
    expect(mockPostCompanyChatMessage).toHaveBeenCalledTimes(1);
    expect(mockRefreshCompanyChatThreadStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        threadId: "thread-1",
      }),
    );
    expect(mockSetCompanyChatThreadStatus).not.toHaveBeenCalled();
  });
});
