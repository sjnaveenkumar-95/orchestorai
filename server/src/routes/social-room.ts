import { Router } from "express";
import type { Db } from "@orchestorai/db";
import {
  createCompanyChatMessageSchema,
  createCompanyChatReactionSchema,
  createCompanyChatThreadSchema,
  updateCompanyChatPromptPackSchema,
  updateCompanyChatRoomSchema,
} from "@orchestorai/shared";
import { logger } from "../middleware/logger.js";
import { validate } from "../middleware/validate.js";
import { logActivity, slackIntegrationService, socialRoomService } from "../services/index.js";
import { assertBoard, assertCompanyAccess, getActorInfo } from "./authz.js";

function toSocialRoomActor(req: Parameters<typeof getActorInfo>[0]) {
  const actor = getActorInfo(req);
  if (actor.actorType === "agent") {
    return {
      actorType: "agent" as const,
      actorId: actor.actorId,
      agentId: actor.agentId,
      userId: null,
      runId: req.actor.runId ?? null,
    };
  }
  return {
    actorType: "user" as const,
    actorId: actor.actorId,
    agentId: null,
    userId: req.actor.type === "board" ? (req.actor.userId ?? null) : null,
    runId: req.actor.runId ?? null,
  };
}

export function socialRoomRoutes(db: Db) {
  const router = Router();
  const svc = socialRoomService(db);
  const slackSvc = slackIntegrationService(db);

  router.get("/companies/:companyId/chat-room", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const room = await svc.getRoomByCompanyId(companyId);
    res.json(room);
  });

  router.post("/companies/:companyId/chat-room/provision", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertBoard(req);
    assertCompanyAccess(req, companyId);
    await svc.provisionRoom(companyId);
    const room = (await slackSvc.syncCompanyChatRoom(companyId)) ?? (await svc.getRoomByCompanyId(companyId));
    if (!room) {
      res.status(404).json({ error: "Company chat room not found" });
      return;
    }

    const actor = getActorInfo(req);
    await logActivity(db, {
      companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      action: "company_chat_room.provisioned",
      entityType: "company_chat_room",
      entityId: room.id,
      details: {
        displayName: room.displayName,
        slackChannelName: room.slackChannelName,
      },
    });

    res.status(201).json(room);
  });

  router.put("/companies/:companyId/chat-room", validate(updateCompanyChatRoomSchema), async (req, res) => {
    const companyId = req.params.companyId as string;
    assertBoard(req);
    assertCompanyAccess(req, companyId);
    await svc.updateRoom(companyId, req.body);
    const room = (await slackSvc.syncCompanyChatRoom(companyId)) ?? (await svc.getRoomByCompanyId(companyId));
    if (!room) {
      res.status(404).json({ error: "Company chat room not found" });
      return;
    }

    const actor = getActorInfo(req);
    await logActivity(db, {
      companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      action: "company_chat_room.updated",
      entityType: "company_chat_room",
      entityId: room.id,
      details: req.body,
    });

    res.json(room);
  });

  router.get("/companies/:companyId/chat-room/prompt-pack", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const promptPack = await svc.getPromptPack(companyId);
    res.json(promptPack);
  });

  router.put(
    "/companies/:companyId/chat-room/prompt-pack",
    validate(updateCompanyChatPromptPackSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertBoard(req);
      assertCompanyAccess(req, companyId);
      const promptPack = await svc.updatePromptPack(companyId, req.body);

      const actor = getActorInfo(req);
      await logActivity(db, {
        companyId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId,
        action: "company_chat_room.prompt_pack_updated",
        entityType: "company_chat_room",
        entityId: promptPack.roomId,
        details: {
          updatedFiles: Object.keys(req.body),
        },
      });

      res.json(promptPack);
    },
  );

  router.get("/companies/:companyId/chat-room/threads", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const threads = await svc.listThreads(companyId);
    res.json(threads);
  });

  router.post(
    "/companies/:companyId/chat-room/threads",
    validate(createCompanyChatThreadSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const actor = toSocialRoomActor(req);
      const created = await svc.createThread(companyId, req.body, actor);
      const room = await svc.getRoomByCompanyId(companyId);
      if (room?.slackChannelId && room.status === "active" && !created.thread.slackThreadTs) {
        try {
          const posted = await slackSvc.postCompanyChatMessage({
            companyId,
            channelId: room.slackChannelId,
            text: req.body.text,
            agentId: actor.agentId ?? null,
          });
          await svc.attachThreadSlackMetadata({
            threadId: created.thread.id,
            threadTs: posted.threadTs,
            channelId: posted.channel,
            rootMessageId: created.message.id,
            rootMessageTs: posted.ts,
          });
          created.thread.slackChannelId = posted.channel;
          created.thread.slackThreadTs = posted.threadTs;
          created.message.slackChannelId = posted.channel;
          created.message.slackMessageTs = posted.ts;
        } catch (error) {
          logger.warn(
            { err: error, companyId, threadId: created.thread.id },
            "failed to mirror social-room root thread to Slack",
          );
        }
      }
      if (created.thread.slackChannelId && created.thread.slackThreadTs) {
        await slackSvc.refreshCompanyChatThreadStatus({
          threadId: created.thread.id,
          fallbackStatus:
            created.wakeSelection?.selectedAgentIds.length === 0 ? "No responders selected yet." : null,
        });
      }
      res.status(201).json(created);
    },
  );

  router.get("/chat-threads/:threadId/messages", async (req, res) => {
    const threadId = req.params.threadId as string;
    const thread = await svc.getThreadById(threadId);
    if (!thread) {
      res.status(404).json({ error: "Company chat thread not found" });
      return;
    }
    assertCompanyAccess(req, thread.companyId);
    const messages = await svc.listMessages(threadId);
    res.json(messages);
  });

  router.post(
    "/chat-threads/:threadId/messages",
    validate(createCompanyChatMessageSchema),
    async (req, res) => {
      const threadId = req.params.threadId as string;
      const thread = await svc.getThreadById(threadId);
      if (!thread) {
        res.status(404).json({ error: "Company chat thread not found" });
        return;
      }
      assertCompanyAccess(req, thread.companyId);
      const actor = toSocialRoomActor(req);
      const created = await svc.createMessage(threadId, req.body, actor);
      if (
        thread.slackChannelId &&
        thread.slackThreadTs &&
        (!created.deduplicated || !created.message.slackMessageTs)
      ) {
        try {
          const posted = await slackSvc.postCompanyChatMessage({
            companyId: thread.companyId,
            channelId: thread.slackChannelId,
            threadTs: thread.slackThreadTs,
            text: req.body.text,
            agentId: actor.agentId ?? null,
          });
          await svc.attachMessageSlackMetadata({
            messageId: created.message.id,
            channelId: posted.channel,
            messageTs: posted.ts,
          });
          created.message.slackChannelId = posted.channel;
          created.message.slackMessageTs = posted.ts;
        } catch (error) {
          logger.warn(
            { err: error, companyId: thread.companyId, threadId },
            "failed to mirror social-room reply to Slack",
          );
        }
      }
      if (created.thread.slackChannelId && created.thread.slackThreadTs) {
        await slackSvc.refreshCompanyChatThreadStatus({
          threadId: created.thread.id,
          fallbackStatus:
            created.wakeSelection?.selectedAgentIds.length === 0 ? "No responders selected yet." : null,
        });
      }
      res.status(created.deduplicated ? 200 : 201).json({
        thread: created.thread,
        message: created.message,
      });
    },
  );

  router.get("/chat-messages/:messageId/reactions", async (req, res) => {
    const messageId = req.params.messageId as string;
    const message = await svc.getMessageById(messageId);
    if (!message) {
      res.status(404).json({ error: "Company chat message not found" });
      return;
    }
    assertCompanyAccess(req, message.companyId);
    const reactions = await svc.listReactions(messageId);
    res.json(reactions);
  });

  router.post(
    "/chat-messages/:messageId/reactions",
    validate(createCompanyChatReactionSchema),
    async (req, res) => {
      const messageId = req.params.messageId as string;
      const message = await svc.getMessageById(messageId);
      if (!message) {
        res.status(404).json({ error: "Company chat message not found" });
        return;
      }
      assertCompanyAccess(req, message.companyId);
      const actor = toSocialRoomActor(req);
      const created = await svc.createReaction(messageId, req.body, actor);
      if (created.message.slackChannelId && created.message.slackMessageTs) {
        try {
          await slackSvc.postCompanyChatReaction({
            companyId: created.message.companyId,
            channelId: created.message.slackChannelId,
            messageTs: created.message.slackMessageTs,
            emoji: req.body.emoji,
            agentId: actor.agentId ?? null,
          });
        } catch (error) {
          logger.warn(
            { err: error, companyId: created.message.companyId, messageId },
            "failed to mirror social-room reaction to Slack",
          );
        }
      }
      res.status(201).json(created.reaction);
    },
  );

  return router;
}
