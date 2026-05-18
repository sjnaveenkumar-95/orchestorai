import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@orchestorai/db";
import type { StorageService } from "../storage/types.js";

const mockIssueGetById = vi.fn();
const mockIssueGetByIdentifier = vi.fn();
const mockIssueAssertCheckoutOwner = vi.fn();
const mockIssueFindMentionedAgents = vi.fn();
const mockIssueCommandsUpdateIssue = vi.fn();
const mockIssueCommandsCreateIssue = vi.fn();
const mockAccessCanUser = vi.fn();
const mockAccessHasPermission = vi.fn();
const mockAgentGetById = vi.fn();
const mockLogActivity = vi.fn();

vi.mock("../services/index.js", () => ({
  accessService: () => ({
    canUser: mockAccessCanUser,
    hasPermission: mockAccessHasPermission,
  }),
  agentService: () => ({
    getById: mockAgentGetById,
    resolveByReference: vi.fn(),
  }),
  goalService: () => ({}),
  heartbeatService: () => ({
    wakeup: vi.fn(),
    getRun: vi.fn(),
    getActiveRunForAgent: vi.fn(),
    cancelRun: vi.fn(),
  }),
  issueApprovalService: () => ({}),
  issueCommandService: () => ({
    updateIssue: mockIssueCommandsUpdateIssue,
    createIssue: mockIssueCommandsCreateIssue,
  }),
  issueService: () => ({
    getById: mockIssueGetById,
    getByIdentifier: mockIssueGetByIdentifier,
    assertCheckoutOwner: mockIssueAssertCheckoutOwner,
    findMentionedAgents: mockIssueFindMentionedAgents,
  }),
  logActivity: (...args: unknown[]) => mockLogActivity(...args),
  projectService: () => ({}),
}));

const { issueRoutes } = await import("../routes/issues.js");

type Actor =
  | {
      type: "board";
      source: "local_implicit";
      userId: string;
      isInstanceAdmin: boolean;
      companyIds: string[];
      runId: null;
    }
  | {
      type: "agent";
      agentId: string;
      companyId: string;
      runId: string;
    };

function createTestApp(actor: Actor) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as express.Request & { actor?: unknown }).actor = actor;
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

describe("issueRoutes ETA handling", () => {
  const issueId = "11111111-1111-4111-8111-111111111111";
  const companyId = "22222222-2222-4222-8222-222222222222";
  const actorAgentId = "33333333-3333-4333-8333-333333333333";
  const etaIso = "2026-03-18T17:30:00.000Z";

  beforeEach(() => {
    mockIssueGetById.mockReset();
    mockIssueGetByIdentifier.mockReset();
    mockIssueAssertCheckoutOwner.mockReset();
    mockIssueFindMentionedAgents.mockReset();
    mockIssueCommandsUpdateIssue.mockReset();
    mockIssueCommandsCreateIssue.mockReset();
    mockAccessCanUser.mockReset();
    mockAccessHasPermission.mockReset();
    mockAgentGetById.mockReset();
    mockLogActivity.mockReset();
  });

  it("coerces etaAt to Date on issue creation", async () => {
    mockIssueCommandsCreateIssue.mockResolvedValue({
      id: issueId,
      companyId,
      identifier: "ETA-1",
      title: "Create ETA field",
      status: "todo",
      priority: "high",
      etaAt: new Date(etaIso),
    });

    const res = await request(createTestApp({
      type: "board",
      source: "local_implicit",
      userId: "board-user",
      isInstanceAdmin: false,
      companyIds: [],
      runId: null,
    }))
      .post(`/api/companies/${companyId}/issues`)
      .send({
        title: "Create ETA field",
        status: "todo",
        priority: "high",
        etaAt: etaIso,
      });

    expect(res.status).toBe(201);
    expect(mockIssueCommandsCreateIssue).toHaveBeenCalledWith(
      companyId,
      expect.objectContaining({
        title: "Create ETA field",
        etaAt: expect.any(Date),
      }),
      expect.objectContaining({
        actorType: "user",
        actorId: "board-user",
      }),
    );
    expect((mockIssueCommandsCreateIssue.mock.calls[0] ?? [])[1].etaAt.toISOString()).toBe(etaIso);
  });

  it("allows PM agents to set the initial ETA", async () => {
    mockIssueGetById.mockResolvedValue({
      id: issueId,
      companyId,
      identifier: "ETA-2",
      title: "Analyze estimate",
      status: "todo",
      priority: "medium",
      assigneeAgentId: null,
      assigneeUserId: null,
      createdByUserId: null,
      etaAt: null,
    });
    mockAgentGetById.mockResolvedValue({
      id: actorAgentId,
      companyId,
      role: "pm",
      title: "Product Manager",
      permissions: {},
    });
    mockIssueCommandsUpdateIssue.mockResolvedValue({
      issue: {
        id: issueId,
        companyId,
        identifier: "ETA-2",
        title: "Analyze estimate",
        status: "todo",
        etaAt: new Date(etaIso),
      },
      comment: null,
    });

    const res = await request(createTestApp({
      type: "agent",
      agentId: actorAgentId,
      companyId,
      runId: "run-1",
    }))
      .patch(`/api/issues/${issueId}`)
      .send({ etaAt: etaIso });

    expect(res.status).toBe(200);
    expect(mockIssueCommandsUpdateIssue).toHaveBeenCalledWith(
      issueId,
      expect.objectContaining({
        etaAt: expect.any(Date),
      }),
      expect.objectContaining({
        actorType: "agent",
        actorId: actorAgentId,
        runId: "run-1",
      }),
      expect.any(Object),
    );
    expect((mockIssueCommandsUpdateIssue.mock.calls[0] ?? [])[1].etaAt.toISOString()).toBe(etaIso);
  });

  it("allows the checked-out assignee to overwrite ETA while in progress", async () => {
    mockIssueGetById.mockResolvedValue({
      id: issueId,
      companyId,
      identifier: "ETA-3",
      title: "Execute work",
      status: "in_progress",
      priority: "medium",
      assigneeAgentId: actorAgentId,
      assigneeUserId: null,
      createdByUserId: null,
      etaAt: new Date("2026-03-18T16:00:00.000Z"),
    });
    mockIssueAssertCheckoutOwner.mockResolvedValue({
      id: issueId,
      status: "in_progress",
      assigneeAgentId: actorAgentId,
      checkoutRunId: "run-1",
      adoptedFromRunId: null,
    });
    mockIssueCommandsUpdateIssue.mockResolvedValue({
      issue: {
        id: issueId,
        companyId,
        identifier: "ETA-3",
        title: "Execute work",
        status: "in_progress",
        etaAt: new Date(etaIso),
      },
      comment: null,
    });

    const res = await request(createTestApp({
      type: "agent",
      agentId: actorAgentId,
      companyId,
      runId: "run-1",
    }))
      .patch(`/api/issues/${issueId}`)
      .send({ etaAt: etaIso });

    expect(res.status).toBe(200);
    expect(mockIssueAssertCheckoutOwner).toHaveBeenCalledWith(issueId, actorAgentId, "run-1");
    expect(mockIssueCommandsUpdateIssue).toHaveBeenCalled();
  });

  it("rejects ETA updates from unauthorized non-assignee agents", async () => {
    mockIssueGetById.mockResolvedValue({
      id: issueId,
      companyId,
      identifier: "ETA-4",
      title: "Execute work",
      status: "todo",
      priority: "medium",
      assigneeAgentId: null,
      assigneeUserId: null,
      createdByUserId: null,
      etaAt: null,
    });
    mockAgentGetById.mockResolvedValue({
      id: actorAgentId,
      companyId,
      role: "engineer",
      title: "Developer",
      permissions: {},
    });

    const res = await request(createTestApp({
      type: "agent",
      agentId: actorAgentId,
      companyId,
      runId: "run-1",
    }))
      .patch(`/api/issues/${issueId}`)
      .send({ etaAt: etaIso });

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: "Missing ETA permission" });
    expect(mockIssueCommandsUpdateIssue).not.toHaveBeenCalled();
  });
});
