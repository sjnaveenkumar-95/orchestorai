import { Router } from "express";
import type { Db } from "@orchestorai/db";
import { createHostCommandFallbackSchema } from "@orchestorai/shared";
import { validate } from "../middleware/validate.js";
import { assertBoard, assertCompanyAccess } from "./authz.js";
import { hostCommandFallbackService, slackIntegrationService } from "../services/index.js";
import { logger } from "../middleware/logger.js";

export function hostCommandFallbackRoutes(db: Db) {
  const router = Router();
  const svc = hostCommandFallbackService(db);
  const slackSvc = slackIntegrationService(db);

  router.post(
    "/companies/:companyId/host-command-fallbacks",
    validate(createHostCommandFallbackSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      if (req.actor.type !== "agent" || !req.actor.agentId) {
        res.status(403).json({ error: "Only agents can request host command fallbacks" });
        return;
      }

      const created = await svc.create(companyId, req.body, {
        agentId: req.actor.agentId,
      });

      if (created.approval && created.request.projectId) {
        void slackSvc
          .postHostCommandFallbackApprovalMessage({
            approvalId: created.approval.id,
            projectId: created.request.projectId,
          })
          .catch((error) => {
            logger.warn(
              { err: error, approvalId: created.approval?.id, requestId: created.request.id },
              "failed to post Slack approval thread for host command fallback",
            );
          });
      }

      res.status(201).json(created.result);
    },
  );

  router.get("/host-command-fallbacks/:id", async (req, res) => {
    const id = req.params.id as string;
    const result = await svc.getById(id);
    assertCompanyAccess(req, result.companyId);
    res.json(result);
  });

  router.get("/companies/:companyId/host-command-allowlist", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    assertBoard(req);
    const result = await svc.listAllowlist(companyId);
    res.json(result);
  });

  router.delete("/host-command-allowlist/:entryId", async (req, res) => {
    assertBoard(req);
    const entryId = req.params.entryId as string;
    const result = await svc.revokeAllowlistEntry(entryId, req.actor.userId ?? "board");
    assertCompanyAccess(req, result.companyId);
    res.json(result);
  });

  return router;
}
