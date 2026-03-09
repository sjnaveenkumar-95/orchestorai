import { Router, type Request } from "express";
import type { Db } from "@orchestorai/db";
import { updateInstanceRuntimeSettingsSchema } from "@orchestorai/shared";
import { forbidden, unauthorized } from "../errors.js";
import { validate } from "../middleware/validate.js";
import { accessService } from "../services/index.js";
import { createInstanceSettingsService } from "../services/instance-settings.js";

function isLocalImplicit(req: Request) {
  return req.actor.type === "board" && req.actor.source === "local_implicit";
}

export function instanceRoutes(db: Db) {
  const router = Router();
  const access = accessService(db);
  const instanceSettings = createInstanceSettingsService();

  async function assertInstanceAdmin(req: Request) {
    if (req.actor.type !== "board") throw unauthorized();
    if (isLocalImplicit(req)) return;
    const allowed = await access.isInstanceAdmin(req.actor.userId);
    if (!allowed) throw forbidden("Instance admin required");
  }

  router.get("/instance/runtime-settings", async (req, res) => {
    await assertInstanceAdmin(req);
    res.json(instanceSettings.getRuntimeSettings());
  });

  router.patch(
    "/instance/runtime-settings",
    validate(updateInstanceRuntimeSettingsSchema),
    async (req, res) => {
      await assertInstanceAdmin(req);
      res.json(instanceSettings.updateRuntimeSettings(req.body));
    },
  );

  return router;
}
