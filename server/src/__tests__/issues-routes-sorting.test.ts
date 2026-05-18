import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@orchestorai/db";
import type { StorageService } from "../storage/types.js";

const mockIssueList = vi.fn();

vi.mock("../services/index.js", () => ({
  accessService: () => ({
    canUser: vi.fn(),
    hasPermission: vi.fn(),
  }),
  agentService: () => ({
    getById: vi.fn(),
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
    updateIssue: vi.fn(),
    createIssue: vi.fn(),
  }),
  issueService: () => ({
    list: mockIssueList,
    getByIdentifier: vi.fn(),
  }),
  logActivity: vi.fn(),
  projectService: () => ({}),
}));

const { issueRoutes } = await import("../routes/issues.ts");

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

describe("issueRoutes sorting filters", () => {
  const companyId = "22222222-2222-4222-8222-222222222222";

  beforeEach(() => {
    mockIssueList.mockReset();
    mockIssueList.mockResolvedValue([]);
  });

  it("passes explicit ETA urgency sort through to issueService.list", async () => {
    const res = await request(createTestApp())
      .get(`/api/companies/${companyId}/issues?status=todo&q=eta&sort=eta_urgency`);

    expect(res.status).toBe(200);
    expect(mockIssueList).toHaveBeenCalledWith(companyId, expect.objectContaining({
      status: "todo",
      q: "eta",
      sort: "eta_urgency",
    }));
  });

  it("preserves search relevance defaults when q is present without sort", async () => {
    const res = await request(createTestApp())
      .get(`/api/companies/${companyId}/issues?q=eta`);

    expect(res.status).toBe(200);
    expect(mockIssueList).toHaveBeenCalledTimes(1);
    expect((mockIssueList.mock.calls[0] ?? [])[1]).not.toHaveProperty("sort");
  });

  it("rejects invalid sort values", async () => {
    const res = await request(createTestApp())
      .get(`/api/companies/${companyId}/issues?sort=deadline`);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/sort/i);
    expect(mockIssueList).not.toHaveBeenCalled();
  });
});
