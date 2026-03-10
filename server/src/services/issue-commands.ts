import type { Db } from "@orchestorai/db";
import { logger } from "../middleware/logger.js";
import { heartbeatService } from "./heartbeat.js";
import { issueService } from "./issues.js";
import { logActivity } from "./activity-log.js";

export interface IssueCommandActor {
  actorType: "user" | "agent" | "system";
  actorId: string;
  agentId?: string | null;
  runId?: string | null;
}

export interface IssueCommandMetadata {
  details?: Record<string, unknown> | null;
  mentionedAgentIds?: string[] | null;
}

function shouldWakeAssigneeOnCheckout(input: {
  actorType: IssueCommandActor["actorType"];
  actorAgentId: string | null;
  checkoutAgentId: string;
  checkoutRunId: string | null;
}) {
  if (input.actorType !== "agent") return true;
  if (!input.actorAgentId) return true;
  if (input.actorAgentId !== input.checkoutAgentId) return true;
  if (!input.checkoutRunId) return true;
  return false;
}

function dedupeAgentIds(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value))));
}

export function issueCommandService(db: Db) {
  const issuesSvc = issueService(db);
  const heartbeat = heartbeatService(db);

  return {
    async createIssue(
      companyId: string,
      data: Parameters<typeof issuesSvc.create>[1],
      actor: IssueCommandActor,
      metadata: IssueCommandMetadata = {},
    ) {
      const issue = await issuesSvc.create(companyId, data);

      await logActivity(db, {
        companyId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId ?? null,
        runId: actor.runId ?? null,
        action: "issue.created",
        entityType: "issue",
        entityId: issue.id,
        details: {
          title: issue.title,
          identifier: issue.identifier,
          ...(metadata.details ?? {}),
        },
      });

      if (issue.assigneeAgentId && issue.status !== "backlog") {
        void heartbeat
          .wakeup(issue.assigneeAgentId, {
            source: "assignment",
            triggerDetail: "system",
            reason: "issue_assigned",
            payload: { issueId: issue.id, mutation: "create" },
            requestedByActorType: actor.actorType,
            requestedByActorId: actor.actorId,
            contextSnapshot: { issueId: issue.id, source: "issue.create" },
          })
          .catch((err) => logger.warn({ err, issueId: issue.id }, "failed to wake assignee on issue create"));
      }

      return issue;
    },

    async updateIssue(
      issueId: string,
      updateFields: Record<string, unknown>,
      actor: IssueCommandActor,
      metadata: IssueCommandMetadata & { comment?: string | null } = {},
    ) {
      const existing = await issuesSvc.getById(issueId);
      if (!existing) return null;

      const issue = await issuesSvc.update(
        issueId,
        updateFields as Parameters<typeof issuesSvc.update>[1],
      );
      if (!issue) return null;

      const previous: Record<string, unknown> = {};
      for (const key of Object.keys(updateFields)) {
        if (
          key in existing &&
          (existing as Record<string, unknown>)[key] !== (updateFields as Record<string, unknown>)[key]
        ) {
          previous[key] = (existing as Record<string, unknown>)[key];
        }
      }

      await logActivity(db, {
        companyId: issue.companyId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId ?? null,
        runId: actor.runId ?? null,
        action: "issue.updated",
        entityType: "issue",
        entityId: issue.id,
        details: {
          ...updateFields,
          identifier: issue.identifier,
          _previous: Object.keys(previous).length > 0 ? previous : undefined,
          ...(metadata.details ?? {}),
        },
      });

      let comment = null;
      const commentBody = metadata.comment?.trim();
      if (commentBody) {
        comment = await issuesSvc.addComment(issueId, commentBody, {
          agentId: actor.agentId ?? undefined,
          userId: actor.actorType === "user" ? actor.actorId : undefined,
        });

        await logActivity(db, {
          companyId: issue.companyId,
          actorType: actor.actorType,
          actorId: actor.actorId,
          agentId: actor.agentId ?? null,
          runId: actor.runId ?? null,
          action: "issue.comment_added",
          entityType: "issue",
          entityId: issue.id,
          details: {
            commentId: comment.id,
            bodySnippet: comment.body.slice(0, 120),
            identifier: issue.identifier,
            issueTitle: issue.title,
            ...(metadata.details ?? {}),
          },
        });
      }

      const assigneeChanged =
        (Object.prototype.hasOwnProperty.call(updateFields, "assigneeAgentId") &&
          (updateFields as { assigneeAgentId?: string | null }).assigneeAgentId !== existing.assigneeAgentId) ||
        (Object.prototype.hasOwnProperty.call(updateFields, "assigneeUserId") &&
          (updateFields as { assigneeUserId?: string | null }).assigneeUserId !== existing.assigneeUserId);

      const wakeups = new Map<string, Parameters<typeof heartbeat.wakeup>[1]>();

      if (assigneeChanged && issue.assigneeAgentId && issue.status !== "backlog") {
        wakeups.set(issue.assigneeAgentId, {
          source: "assignment",
          triggerDetail: "system",
          reason: "issue_assigned",
          payload: { issueId: issue.id, mutation: "update" },
          requestedByActorType: actor.actorType,
          requestedByActorId: actor.actorId,
          contextSnapshot: { issueId: issue.id, source: "issue.update" },
        });
      }

      if (commentBody && comment) {
        for (const mentionedId of dedupeAgentIds(metadata.mentionedAgentIds ?? [])) {
          if (wakeups.has(mentionedId)) continue;
          if (actor.actorType === "agent" && actor.actorId === mentionedId) continue;
          wakeups.set(mentionedId, {
            source: "automation",
            triggerDetail: "system",
            reason: "issue_comment_mentioned",
            payload: { issueId, commentId: comment.id },
            requestedByActorType: actor.actorType,
            requestedByActorId: actor.actorId,
            contextSnapshot: {
              issueId,
              taskId: issueId,
              commentId: comment.id,
              wakeCommentId: comment.id,
              wakeReason: "issue_comment_mentioned",
              source: "comment.mention",
            },
          });
        }
      }

      for (const [agentId, wakeup] of wakeups.entries()) {
        heartbeat
          .wakeup(agentId, wakeup)
          .catch((err) => logger.warn({ err, issueId: issue.id, agentId }, "failed to wake agent on issue update"));
      }

      return { issue, comment };
    },

    async addComment(
      issueId: string,
      body: string,
      actor: IssueCommandActor,
      metadata: IssueCommandMetadata = {},
    ) {
      const issue = await issuesSvc.getById(issueId);
      if (!issue) return null;

      const comment = await issuesSvc.addComment(issueId, body, {
        agentId: actor.agentId ?? undefined,
        userId: actor.actorType === "user" ? actor.actorId : undefined,
      });

      await logActivity(db, {
        companyId: issue.companyId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId ?? null,
        runId: actor.runId ?? null,
        action: "issue.comment_added",
        entityType: "issue",
        entityId: issue.id,
        details: {
          commentId: comment.id,
          bodySnippet: comment.body.slice(0, 120),
          identifier: issue.identifier,
          issueTitle: issue.title,
          ...(metadata.details ?? {}),
        },
      });

      const wakeups = new Map<string, Parameters<typeof heartbeat.wakeup>[1]>();
      const assigneeId = issue.assigneeAgentId;
      const actorIsAgent = actor.actorType === "agent";
      const selfComment = actorIsAgent && actor.actorId === assigneeId;
      const isClosed = issue.status === "done" || issue.status === "cancelled";

      if (assigneeId && !selfComment && !isClosed) {
        wakeups.set(assigneeId, {
          source: "automation",
          triggerDetail: "system",
          reason: "issue_commented",
          payload: { issueId: issue.id, commentId: comment.id, mutation: "comment" },
          requestedByActorType: actor.actorType,
          requestedByActorId: actor.actorId,
          contextSnapshot: {
            issueId: issue.id,
            taskId: issue.id,
            commentId: comment.id,
            source: "issue.comment",
            wakeReason: "issue_commented",
          },
        });
      }

      for (const mentionedId of dedupeAgentIds(metadata.mentionedAgentIds ?? [])) {
        if (wakeups.has(mentionedId)) continue;
        if (actorIsAgent && actor.actorId === mentionedId) continue;
        wakeups.set(mentionedId, {
          source: "automation",
          triggerDetail: "system",
          reason: "issue_comment_mentioned",
          payload: { issueId, commentId: comment.id },
          requestedByActorType: actor.actorType,
          requestedByActorId: actor.actorId,
          contextSnapshot: {
            issueId,
            taskId: issueId,
            commentId: comment.id,
            wakeCommentId: comment.id,
            wakeReason: "issue_comment_mentioned",
            source: "comment.mention",
          },
        });
      }

      for (const [agentId, wakeup] of wakeups.entries()) {
        heartbeat
          .wakeup(agentId, wakeup)
          .catch((err) => logger.warn({ err, issueId: issue.id, agentId }, "failed to wake agent on issue comment"));
      }

      return comment;
    },

    async checkoutIssue(
      issueId: string,
      agentId: string,
      expectedStatuses: string[],
      actor: IssueCommandActor,
      checkoutRunId: string | null,
      metadata: IssueCommandMetadata = {},
    ) {
      const issue = await issuesSvc.getById(issueId);
      if (!issue) return null;

      const updated = await issuesSvc.checkout(issueId, agentId, expectedStatuses, checkoutRunId);

      await logActivity(db, {
        companyId: issue.companyId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId ?? null,
        runId: actor.runId ?? null,
        action: "issue.checked_out",
        entityType: "issue",
        entityId: issue.id,
        details: {
          agentId,
          ...(metadata.details ?? {}),
        },
      });

      if (
        shouldWakeAssigneeOnCheckout({
          actorType: actor.actorType,
          actorAgentId: actor.agentId ?? null,
          checkoutAgentId: agentId,
          checkoutRunId,
        })
      ) {
        void heartbeat
          .wakeup(agentId, {
            source: "assignment",
            triggerDetail: "system",
            reason: "issue_checked_out",
            payload: { issueId: issue.id, mutation: "checkout" },
            requestedByActorType: actor.actorType,
            requestedByActorId: actor.actorId,
            contextSnapshot: { issueId: issue.id, source: "issue.checkout" },
          })
          .catch((err) => logger.warn({ err, issueId: issue.id }, "failed to wake assignee on issue checkout"));
      }

      return updated;
    },

    async releaseIssue(
      issueId: string,
      actor: IssueCommandActor,
      actorRunId?: string | null,
      metadata: IssueCommandMetadata = {},
    ) {
      const existing = await issuesSvc.getById(issueId);
      if (!existing) return null;

      const released = await issuesSvc.release(
        issueId,
        actor.actorType === "agent" ? (actor.agentId ?? undefined) : undefined,
        actorRunId,
      );
      if (!released) return null;

      await logActivity(db, {
        companyId: released.companyId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId ?? null,
        runId: actor.runId ?? null,
        action: "issue.released",
        entityType: "issue",
        entityId: released.id,
        details: metadata.details ?? undefined,
      });

      return released;
    },
  };
}
