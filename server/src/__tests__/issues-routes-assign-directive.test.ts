import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@orchestorai/db";
import type { StorageService } from "../storage/types.js";

const mockIssueGetById = vi.fn();
const mockIssueFindMentionedAgents = vi.fn();
const mockIssueCommandsUpdateIssue = vi.fn();
const mockAccessCanUser = vi.fn();
const mockAccessHasPermission = vi.fn();
const mockAgentGetById = vi.fn();
const mockAgentResolveByReference = vi.fn();
const mockLogActivity = vi.fn();

vi.mock("../services/index.js", () => ({
  accessService: () => ({
    canUser: mockAccessCanUser,
    hasPermission: mockAccessHasPermission,
  }),
  agentService: () => ({
    getById: mockAgentGetById,
    resolveByReference: mockAgentResolveByReference,
  }),
  goalService: () => ({}),
  heartbeatService: () => ({
    wakeup: vi.fn(),
  }),
  issueApprovalService: () => ({}),
  issueCommandService: () => ({
    updateIssue: mockIssueCommandsUpdateIssue,
  }),
  issueService: () => ({
    getById: mockIssueGetById,
    findMentionedAgents: mockIssueFindMentionedAgents,
  }),
  logActivity: (...args: unknown[]) => mockLogActivity(...args),
  projectService: () => ({}),
}));

const { issueRoutes } = await import("../routes/issues.js");

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as express.Request & { actor?: unknown }).actor = {
      type: "board",
      source: "local_implicit",
      userId: "board-user",
      isInstanceAdmin: false,
      companyIds: [],
      runId: null,
    };
    next();
  });
  app.use(
    "/api",
    issueRoutes({} as Db, {
      deleteObject: vi.fn(),
      putFile: vi.fn(),
    } as unknown as StorageService),
  );
  app.use((
    err: Error & { status?: number },
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    res.status(err.status ?? 500).json({ error: err.message });
  });
  return app;
}

describe("issueRoutes assignment comment directive", () => {
  const issueId = "11111111-1111-4111-8111-111111111111";
  const companyId = "22222222-2222-4222-8222-222222222222";
  const currentAssigneeId = "33333333-3333-4333-8333-333333333333";
  const nextAssigneeId = "44444444-4444-4444-8444-444444444444";

  beforeEach(() => {
    mockIssueGetById.mockReset();
    mockIssueFindMentionedAgents.mockReset();
    mockIssueCommandsUpdateIssue.mockReset();
    mockAccessCanUser.mockReset();
    mockAccessHasPermission.mockReset();
    mockAgentGetById.mockReset();
    mockAgentResolveByReference.mockReset();
    mockLogActivity.mockReset();
  });

  it("interprets /assign on PATCH comments as an assignee update", async () => {
    mockIssueGetById.mockResolvedValue({
      id: issueId,
      companyId,
      identifier: "HRH-10",
      title: "Resume Intelligence",
      status: "in_progress",
      assigneeAgentId: currentAssigneeId,
      assigneeUserId: null,
      createdByUserId: null,
    });
    mockAgentResolveByReference.mockResolvedValue({
      ambiguous: false,
      agent: {
        id: nextAssigneeId,
        companyId,
        name: "Avery (Project-Manager)",
        role: "general",
        status: "idle",
        urlKey: "avery-project-manager",
      },
    });
    mockIssueFindMentionedAgents.mockResolvedValue([]);
    mockIssueCommandsUpdateIssue.mockResolvedValue({
      issue: {
        id: issueId,
        companyId,
        identifier: "HRH-10",
        title: "Resume Intelligence",
        status: "blocked",
        assigneeAgentId: nextAssigneeId,
        assigneeUserId: null,
      },
      comment: {
        id: "55555555-5555-4555-8555-555555555555",
        companyId,
        issueId,
        authorAgentId: null,
        authorUserId: "board-user",
        body: "/assign @avery-project-manager\nNeed PM ownership on this blocker.",
        createdAt: new Date("2026-03-17T05:00:00.000Z"),
        updatedAt: new Date("2026-03-17T05:00:00.000Z"),
      },
    });

    const res = await request(createTestApp())
      .patch(`/api/issues/${issueId}`)
      .send({
        status: "blocked",
        comment: "/assign @avery-project-manager\nNeed PM ownership on this blocker.",
      });

    expect(res.status).toBe(200);
    expect(mockAgentResolveByReference).toHaveBeenCalledWith(companyId, "avery-project-manager");
    expect(mockIssueCommandsUpdateIssue).toHaveBeenCalledWith(
      issueId,
      expect.objectContaining({
        status: "blocked",
        assigneeAgentId: nextAssigneeId,
        assigneeUserId: null,
      }),
      expect.objectContaining({
        actorType: "user",
        actorId: "board-user",
      }),
      expect.objectContaining({
        comment: "/assign @avery-project-manager\nNeed PM ownership on this blocker.",
        mentionedAgentIds: [],
      }),
    );
  });

  it("interprets /assign on POST comment bodies as an assignee update", async () => {
    mockIssueGetById.mockResolvedValue({
      id: issueId,
      companyId,
      identifier: "HRH-10",
      title: "Resume Intelligence",
      status: "todo",
      assigneeAgentId: currentAssigneeId,
      assigneeUserId: null,
      createdByUserId: null,
      executionRunId: null,
    });
    mockAgentResolveByReference.mockResolvedValue({
      ambiguous: false,
      agent: {
        id: nextAssigneeId,
        companyId,
        name: "Avery (Project-Manager)",
        role: "general",
        status: "idle",
        urlKey: "avery-project-manager",
      },
    });
    mockIssueFindMentionedAgents.mockResolvedValue([]);
    mockIssueCommandsUpdateIssue.mockResolvedValue({
      issue: {
        id: issueId,
        companyId,
        identifier: "HRH-10",
        title: "Resume Intelligence",
        status: "todo",
        assigneeAgentId: nextAssigneeId,
        assigneeUserId: null,
      },
      comment: {
        id: "66666666-6666-4666-8666-666666666666",
        companyId,
        issueId,
        authorAgentId: null,
        authorUserId: "board-user",
        body: "/assign @avery-project-manager\nPlease take ownership of the remaining coordination.",
        createdAt: new Date("2026-03-17T05:01:00.000Z"),
        updatedAt: new Date("2026-03-17T05:01:00.000Z"),
      },
    });

    const res = await request(createTestApp())
      .post(`/api/issues/${issueId}/comments`)
      .send({
        body: "/assign @avery-project-manager\nPlease take ownership of the remaining coordination.",
      });

    expect(res.status).toBe(201);
    expect(mockAgentResolveByReference).toHaveBeenCalledWith(companyId, "avery-project-manager");
    expect(mockIssueCommandsUpdateIssue).toHaveBeenCalledWith(
      issueId,
      expect.objectContaining({
        assigneeAgentId: nextAssigneeId,
        assigneeUserId: null,
      }),
      expect.objectContaining({
        actorType: "user",
        actorId: "board-user",
      }),
      expect.objectContaining({
        comment: "/assign @avery-project-manager\nPlease take ownership of the remaining coordination.",
        mentionedAgentIds: [],
      }),
    );
  });
});
