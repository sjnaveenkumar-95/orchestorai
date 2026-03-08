import { Router } from "express";
import type { Db } from "@paperclipai/db";
import { and, eq, isNull, sql } from "drizzle-orm";
import { issues, joinRequests } from "@paperclipai/db";
import { sidebarBadgeService } from "../services/sidebar-badges.js";
import { accessService } from "../services/access.js";
import { dashboardService } from "../services/dashboard.js";
import { assertCompanyAccess } from "./authz.js";

function parseDismissedIds(value: unknown): string[] {
  const rawValues = Array.isArray(value) ? value : value == null ? [] : [value];
  return Array.from(
    new Set(
      rawValues
        .flatMap((entry) => String(entry).split(","))
        .map((entry) => entry.trim())
        .filter(Boolean),
    ),
  );
}

export function sidebarBadgeRoutes(db: Db) {
  const router = Router();
  const svc = sidebarBadgeService(db);
  const access = accessService(db);
  const dashboard = dashboardService(db);

  router.get("/companies/:companyId/sidebar-badges", async (req, res) => {
    const companyId = req.params.companyId as string;
    const dismissedIds = new Set(parseDismissedIds(req.query.dismissed));
    assertCompanyAccess(req, companyId);
    let canApproveJoins = false;
    if (req.actor.type === "board") {
      canApproveJoins =
        req.actor.source === "local_implicit" ||
        Boolean(req.actor.isInstanceAdmin) ||
        (await access.canUser(companyId, req.actor.userId, "joins:approve"));
    } else if (req.actor.type === "agent" && req.actor.agentId) {
      canApproveJoins = await access.hasPermission(companyId, "agent", req.actor.agentId, "joins:approve");
    }

    const joinRequestCount = canApproveJoins
      ? await db
        .select({ count: sql<number>`count(*)` })
        .from(joinRequests)
        .where(and(eq(joinRequests.companyId, companyId), eq(joinRequests.status, "pending_approval")))
        .then((rows) => Number(rows[0]?.count ?? 0))
      : 0;

    const badges = await svc.get(companyId, {
      joinRequests: joinRequestCount,
      dismissedIds,
    });
    const summary = await dashboard.summary(companyId);
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const staleIssueRows = await db
      .select({ id: issues.id })
      .from(issues)
      .where(
        and(
          eq(issues.companyId, companyId),
          eq(issues.status, "in_progress"),
          isNull(issues.hiddenAt),
          sql`${issues.startedAt} < ${cutoff.toISOString()}`,
        ),
      );
    const staleIssueCount = staleIssueRows.filter(
      (row) => !dismissedIds.has(`stale:${row.id}`),
    ).length;
    const hasFailedRuns = badges.failedRuns > 0;
    const alertsCount =
      (summary.agents.error > 0 &&
      !hasFailedRuns &&
      !dismissedIds.has("alert:agent-errors")
        ? 1
        : 0) +
      (summary.costs.monthBudgetCents > 0 &&
      summary.costs.monthUtilizationPercent >= 80 &&
      !dismissedIds.has("alert:budget")
        ? 1
        : 0);
    badges.inbox = badges.failedRuns + alertsCount + staleIssueCount + joinRequestCount;

    res.json(badges);
  });

  return router;
}
