import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@orchestorai/db";

const mockGetById = vi.fn();
const mockUpdate = vi.fn();
const mockHeartbeatList = vi.fn();
const mockSyncAgentAppDisplayName = vi.fn();
const mockLogActivity = vi.fn();

vi.mock("../services/index.js", () => ({
  agentService: () => ({
    getById: mockGetById,
    update: mockUpdate,
    resolveByReference: vi.fn(),
  }),
  accessService: () => ({
    canUser: vi.fn(),
    hasPermission: vi.fn(),
  }),
  approvalService: () => ({}),
  heartbeatService: () => ({
    list: mockHeartbeatList,
  }),
  issueApprovalService: () => ({}),
  issueService: () => ({}),
  logActivity: (...args: unknown[]) => mockLogActivity(...args),
  secretService: () => ({
    normalizeAdapterConfigForPersistence: async (_companyId: string, config: Record<string, unknown>) => config,
  }),
  slackIntegrationService: () => ({
    syncAgentAppDisplayName: mockSyncAgentAppDisplayName,
  }),
}));

const { agentRoutes } = await import("../routes/agents.js");

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
  app.use("/api", agentRoutes({} as Db));
  app.use((err: Error & { status?: number }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(err.status ?? 500).json({ error: err.message });
  });
  return app;
}

describe("agentRoutes PATCH /agents/:id", () => {
  const agentId = "11111111-1111-4111-8111-111111111111";
  const companyId = "22222222-2222-4222-8222-222222222222";

  beforeEach(() => {
    mockGetById.mockReset();
    mockUpdate.mockReset();
    mockHeartbeatList.mockReset();
    mockSyncAgentAppDisplayName.mockReset();
    mockLogActivity.mockReset();
  });

  it("syncs Slack app display name when the agent name changes", async () => {
    mockGetById.mockResolvedValue({
      id: agentId,
      companyId,
      name: "John",
      role: "general",
      status: "idle",
    });
    mockUpdate.mockResolvedValue({
      id: agentId,
      companyId,
      name: "Clara",
      role: "general",
      status: "idle",
    });
    mockSyncAgentAppDisplayName.mockResolvedValue({ synced: true });

    const res = await request(createTestApp())
      .patch(`/api/agents/${agentId}`)
      .send({ name: "Clara" });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: agentId,
      name: "Clara",
    });
    expect(mockSyncAgentAppDisplayName).toHaveBeenCalledTimes(1);
    expect(mockSyncAgentAppDisplayName).toHaveBeenCalledWith(agentId);
  });

  it("does not sync Slack app display name when name is not part of the patch", async () => {
    mockGetById.mockResolvedValue({
      id: agentId,
      companyId,
      name: "Clara",
      role: "general",
      status: "idle",
    });
    mockUpdate.mockResolvedValue({
      id: agentId,
      companyId,
      name: "Clara",
      role: "general",
      status: "idle",
      title: "Ops Lead",
    });

    const res = await request(createTestApp())
      .patch(`/api/agents/${agentId}`)
      .send({ title: "Ops Lead" });

    expect(res.status).toBe(200);
    expect(mockSyncAgentAppDisplayName).not.toHaveBeenCalled();
  });

  it("syncs Slack app display name when name is explicitly re-saved unchanged", async () => {
    mockGetById.mockResolvedValue({
      id: agentId,
      companyId,
      name: "Clara",
      role: "general",
      status: "idle",
    });
    mockUpdate.mockResolvedValue({
      id: agentId,
      companyId,
      name: "Clara",
      role: "general",
      status: "idle",
    });
    mockSyncAgentAppDisplayName.mockResolvedValue({ synced: true });

    const res = await request(createTestApp())
      .patch(`/api/agents/${agentId}`)
      .send({ name: "Clara" });

    expect(res.status).toBe(200);
    expect(mockSyncAgentAppDisplayName).toHaveBeenCalledTimes(1);
    expect(mockSyncAgentAppDisplayName).toHaveBeenCalledWith(agentId);
  });
});

describe("agentRoutes GET /companies/:companyId/heartbeat-runs", () => {
  const companyId = "22222222-2222-4222-8222-222222222222";

  beforeEach(() => {
    mockHeartbeatList.mockReset();
  });

  it("applies a default capped limit when limit is omitted", async () => {
    mockHeartbeatList.mockResolvedValue([]);

    const res = await request(createTestApp()).get(`/api/companies/${companyId}/heartbeat-runs`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
    expect(mockHeartbeatList).toHaveBeenCalledTimes(1);
    expect(mockHeartbeatList).toHaveBeenCalledWith(companyId, undefined, 200);
  });

  it("preserves explicit limit requests within the cap", async () => {
    mockHeartbeatList.mockResolvedValue([]);

    const res = await request(createTestApp()).get(`/api/companies/${companyId}/heartbeat-runs?limit=25`);

    expect(res.status).toBe(200);
    expect(mockHeartbeatList).toHaveBeenCalledWith(companyId, undefined, 25);
  });
});
