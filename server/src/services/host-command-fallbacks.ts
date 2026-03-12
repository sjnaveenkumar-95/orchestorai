import { randomUUID } from "node:crypto";
import path from "node:path";
import { and, desc, eq, isNull } from "drizzle-orm";
import type { Db } from "@orchestorai/db";
import {
  approvalComments,
  approvals,
  hostCommandAllowlistEntries,
  hostCommandRequests,
  issueApprovals,
  issues,
  slackApprovalThreadLinks,
} from "@orchestorai/db";
import type {
  ApprovalResolutionMode,
  CreateHostCommandFallback,
  CreateHostCommandFallbackResult,
  HostCommandAllowlistEntry,
  HostCommandFallbackApprovalPayload,
  HostCommandRequest,
  HostCommandRequestDetail,
  SlackApprovalThreadLink,
} from "@orchestorai/shared";
import {
  MAX_EXCERPT_BYTES,
  appendWithCap,
  buildOrchestorAIEnv,
  ensureAbsoluteDirectory,
  runChildProcess,
} from "../adapters/utils.js";
import { badRequest, forbidden, notFound, unprocessable } from "../errors.js";
import { heartbeatService } from "./heartbeat.js";
import { logActivity } from "./activity-log.js";
import { getRunLogStore } from "./run-log-store.js";

const EXECUTION_TIMEOUT_SEC = 10 * 60;
const EXECUTION_GRACE_SEC = 15;
const HOST_COMMAND_DENYLIST = new Set([
  "bash",
  "cmd",
  "csh",
  "dash",
  "fish",
  "ksh",
  "osascript",
  "powershell",
  "pwsh",
  "scp",
  "sftp",
  "sh",
  "ssh",
  "sshpass",
  "sudo",
  "tcsh",
  "zsh",
]);
const ACTIONABLE_APPROVAL_STATUSES = new Set(["pending", "revision_requested"]);
const executionInFlight = new Map<string, Promise<void>>();

function normalizeBinary(rawBinary: string) {
  const binary = rawBinary.trim();
  if (!binary) {
    throw badRequest("binary is required");
  }
  if (binary.includes("/") || binary.includes("\\") || /\s/.test(binary)) {
    throw badRequest("binary must be a bare executable name without path separators or spaces");
  }
  if (HOST_COMMAND_DENYLIST.has(binary.toLowerCase())) {
    throw forbidden(`Host fallback is not allowed for binary "${binary}"`);
  }
  return binary;
}

function excerptOutput(value: string | null | undefined) {
  if (!value) return null;
  return appendWithCap("", value, MAX_EXCERPT_BYTES);
}

function summarizeExcerpt(value: string | null | undefined) {
  if (!value) return null;
  const firstLine = value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  if (!firstLine) return null;
  return firstLine.length > 240 ? `${firstLine.slice(0, 239)}…` : firstLine;
}

function toArgs(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function toRequest(row: typeof hostCommandRequests.$inferSelect): HostCommandRequest {
  return {
    id: row.id,
    companyId: row.companyId,
    issueId: row.issueId,
    projectId: row.projectId,
    requestedByAgentId: row.requestedByAgentId,
    approvalId: row.approvalId,
    status: row.status as HostCommandRequest["status"],
    binary: row.binary,
    args: toArgs(row.args),
    cwd: row.cwd,
    reason: row.reason,
    missingCommand: row.missingCommand,
    localErrorExcerpt: row.localErrorExcerpt,
    exitCode: row.exitCode,
    stdoutExcerpt: row.stdoutExcerpt,
    stderrExcerpt: row.stderrExcerpt,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    logStore: row.logStore,
    logRef: row.logRef,
    logBytes: row.logBytes,
    logSha256: row.logSha256,
    logCompressed: row.logCompressed,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toAllowlistEntry(
  row: typeof hostCommandAllowlistEntries.$inferSelect,
): HostCommandAllowlistEntry {
  return {
    id: row.id,
    companyId: row.companyId,
    projectId: row.projectId,
    binary: row.binary,
    createdByUserId: row.createdByUserId,
    createdFromApprovalId: row.createdFromApprovalId,
    revokedAt: row.revokedAt,
    revokedByUserId: row.revokedByUserId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toSlackApprovalThreadLink(
  row: typeof slackApprovalThreadLinks.$inferSelect,
): SlackApprovalThreadLink {
  return {
    id: row.id,
    companyId: row.companyId,
    approvalId: row.approvalId,
    projectId: row.projectId,
    projectSlackChannelId: row.projectSlackChannelId,
    channelId: row.channelId,
    threadTs: row.threadTs,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function hostCommandFallbackService(db: Db) {
  const heartbeat = heartbeatService(db);
  const runLogStore = getRunLogStore();

  async function getIssueSummary(issueId: string) {
    return db
      .select({
        id: issues.id,
        companyId: issues.companyId,
        projectId: issues.projectId,
        assigneeAgentId: issues.assigneeAgentId,
        identifier: issues.identifier,
        title: issues.title,
      })
      .from(issues)
      .where(eq(issues.id, issueId))
      .then((rows) => rows[0] ?? null);
  }

  async function getIssueOrThrow(issueId: string) {
    const issue = await getIssueSummary(issueId);
    if (!issue) throw notFound("Issue not found");
    return issue;
  }

  async function getRequestRow(requestId: string) {
    const row = await db
      .select()
      .from(hostCommandRequests)
      .where(eq(hostCommandRequests.id, requestId))
      .then((rows) => rows[0] ?? null);
    if (!row) throw notFound("Host command request not found");
    return row;
  }

  async function getRequestRowByApprovalId(approvalId: string) {
    return db
      .select()
      .from(hostCommandRequests)
      .where(eq(hostCommandRequests.approvalId, approvalId))
      .then((rows) => rows[0] ?? null);
  }

  async function getApprovalRow(approvalId: string) {
    const row = await db
      .select()
      .from(approvals)
      .where(eq(approvals.id, approvalId))
      .then((rows) => rows[0] ?? null);
    if (!row) throw notFound("Approval not found");
    return row;
  }

  async function getActiveAllowlistRow(projectId: string | null, binary: string) {
    if (!projectId) return null;
    return db
      .select()
      .from(hostCommandAllowlistEntries)
      .where(
        and(
          eq(hostCommandAllowlistEntries.projectId, projectId),
          eq(hostCommandAllowlistEntries.binary, binary),
          isNull(hostCommandAllowlistEntries.revokedAt),
        ),
      )
      .orderBy(desc(hostCommandAllowlistEntries.updatedAt), desc(hostCommandAllowlistEntries.createdAt))
      .then((rows) => rows[0] ?? null);
  }

  async function getApprovalThreadRow(approvalId: string | null) {
    if (!approvalId) return null;
    return db
      .select()
      .from(slackApprovalThreadLinks)
      .where(eq(slackApprovalThreadLinks.approvalId, approvalId))
      .then((rows) => rows[0] ?? null);
  }

  async function addApprovalComment(approvalId: string | null, companyId: string, body: string) {
    if (!approvalId) return;
    await db.insert(approvalComments).values({
      companyId,
      approvalId,
      authorAgentId: null,
      authorUserId: null,
      body,
    });
  }

  async function wakeRequesterAgent(
    requestRow: typeof hostCommandRequests.$inferSelect,
    reason: "host_command_request_completed" | "host_command_request_rejected",
    error: string | null = null,
  ) {
    try {
      const wakeRun = await heartbeat.wakeup(requestRow.requestedByAgentId, {
        source: "automation",
        triggerDetail: "system",
        reason,
        requestedByActorType: "system",
        requestedByActorId: "host_command_fallback",
        payload: {
          hostCommandRequestId: requestRow.id,
          approvalId: requestRow.approvalId,
          issueId: requestRow.issueId,
          taskId: requestRow.issueId,
          status: requestRow.status,
          binary: requestRow.binary,
          args: toArgs(requestRow.args),
          exitCode: requestRow.exitCode,
          stdoutExcerpt: requestRow.stdoutExcerpt,
          stderrExcerpt: requestRow.stderrExcerpt,
          error,
        },
        contextSnapshot: {
          source: "host_command_fallback",
          hostCommandRequestId: requestRow.id,
          approvalId: requestRow.approvalId,
          issueId: requestRow.issueId,
          taskId: requestRow.issueId,
          wakeReason: reason,
          hostCommandStatus: requestRow.status,
          exitCode: requestRow.exitCode,
        },
      });

      await logActivity(db, {
        companyId: requestRow.companyId,
        actorType: "system",
        actorId: "host_command_fallback",
        action: "host_command.requester_wakeup_queued",
        entityType: "host_command_request",
        entityId: requestRow.id,
        details: {
          requesterAgentId: requestRow.requestedByAgentId,
          wakeRunId: wakeRun?.id ?? null,
          reason,
          status: requestRow.status,
        },
      });
    } catch (err) {
      await logActivity(db, {
        companyId: requestRow.companyId,
        actorType: "system",
        actorId: "host_command_fallback",
        action: "host_command.requester_wakeup_failed",
        entityType: "host_command_request",
        entityId: requestRow.id,
        details: {
          requesterAgentId: requestRow.requestedByAgentId,
          reason,
          error: err instanceof Error ? err.message : String(err),
        },
      });
    }
  }

  async function buildDetail(requestRow: typeof hostCommandRequests.$inferSelect): Promise<HostCommandRequestDetail> {
    const [issue, allowlistRow, approvalThreadRow] = await Promise.all([
      getIssueSummary(requestRow.issueId),
      getActiveAllowlistRow(requestRow.projectId, requestRow.binary),
      getApprovalThreadRow(requestRow.approvalId),
    ]);

    return {
      ...toRequest(requestRow),
      allowlistEntry: allowlistRow ? toAllowlistEntry(allowlistRow) : null,
      approvalThread: approvalThreadRow ? toSlackApprovalThreadLink(approvalThreadRow) : null,
      issueIdentifier: issue?.identifier ?? null,
      issueTitle: issue?.title ?? null,
    };
  }

  async function executeRequest(requestId: string) {
    const request = await getRequestRow(requestId);
    if (request.status !== "queued") {
      return;
    }

    const logHandle = await runLogStore.begin({
      companyId: request.companyId,
      agentId: request.requestedByAgentId,
      runId: `host-command-${request.id}`,
    });
    const startedAt = new Date();
    await runLogStore.append(logHandle, {
      stream: "system",
      chunk: `Executing ${request.binary} ${toArgs(request.args).join(" ")} in ${request.cwd}\n`,
      ts: startedAt.toISOString(),
    });

    const running = await db
      .update(hostCommandRequests)
      .set({
        status: "running",
        startedAt,
        finishedAt: null,
        logStore: logHandle.store,
        logRef: logHandle.logRef,
        updatedAt: startedAt,
      })
      .where(eq(hostCommandRequests.id, request.id))
      .returning()
      .then((rows) => rows[0] ?? null);

    if (!running) {
      return;
    }

    await addApprovalComment(
      running.approvalId,
      running.companyId,
      `Host command started: \`${running.binary}${toArgs(running.args).length > 0 ? ` ${toArgs(running.args).join(" ")}` : ""}\``,
    );
    await logActivity(db, {
      companyId: running.companyId,
      actorType: "system",
      actorId: "host_command_fallback",
      action: "host_command.execution_started",
      entityType: "host_command_request",
      entityId: running.id,
      details: {
        issueId: running.issueId,
        approvalId: running.approvalId,
        binary: running.binary,
        cwd: running.cwd,
      },
    });

    let stdout = "";
    let stderr = "";

    try {
      await ensureAbsoluteDirectory(running.cwd);

      const result = await runChildProcess(
        `host-command-${running.id}`,
        running.binary,
        toArgs(running.args),
        {
          cwd: running.cwd,
          env: {
            ...buildOrchestorAIEnv({
              id: running.requestedByAgentId,
              companyId: running.companyId,
            }),
            ORCHESTORAI_HOST_COMMAND_REQUEST_ID: running.id,
            ORCHESTORAI_TASK_ID: running.issueId,
          },
          timeoutSec: EXECUTION_TIMEOUT_SEC,
          graceSec: EXECUTION_GRACE_SEC,
          onLog: async (stream, chunk) => {
            if (stream === "stdout") {
              stdout = appendWithCap(stdout, chunk, MAX_EXCERPT_BYTES);
            } else {
              stderr = appendWithCap(stderr, chunk, MAX_EXCERPT_BYTES);
            }
            await runLogStore.append(logHandle, {
              stream,
              chunk,
              ts: new Date().toISOString(),
            });
          },
        },
      );

      const finalized = await runLogStore.finalize(logHandle);
      const finishedAt = new Date();
      const status =
        result.timedOut || (result.exitCode ?? 0) !== 0 || result.signal ? "failed" : "succeeded";
      const updated = await db
        .update(hostCommandRequests)
        .set({
          status,
          exitCode: result.exitCode,
          stdoutExcerpt: excerptOutput(stdout || result.stdout),
          stderrExcerpt: excerptOutput(
            result.timedOut
              ? `${stderr || result.stderr}\nTimed out after ${EXECUTION_TIMEOUT_SEC}s`
              : (stderr || result.stderr),
          ),
          finishedAt,
          updatedAt: finishedAt,
          logStore: logHandle.store,
          logRef: logHandle.logRef,
          logBytes: finalized.bytes,
          logSha256: finalized.sha256 ?? null,
          logCompressed: finalized.compressed,
        })
        .where(eq(hostCommandRequests.id, running.id))
        .returning()
        .then((rows) => rows[0] ?? null);

      if (!updated) {
        return;
      }

      await addApprovalComment(
        updated.approvalId,
        updated.companyId,
        updated.status === "succeeded"
          ? `Host command completed successfully${updated.exitCode != null ? ` (exit ${updated.exitCode})` : ""}.`
          : `Host command failed${updated.exitCode != null ? ` (exit ${updated.exitCode})` : ""}.`,
      );
      await logActivity(db, {
        companyId: updated.companyId,
        actorType: "system",
        actorId: "host_command_fallback",
        action:
          updated.status === "succeeded"
            ? "host_command.execution_succeeded"
            : "host_command.execution_failed",
        entityType: "host_command_request",
        entityId: updated.id,
        details: {
          issueId: updated.issueId,
          approvalId: updated.approvalId,
          binary: updated.binary,
          exitCode: updated.exitCode,
          timedOut: result.timedOut,
          signal: result.signal,
        },
      });
      await wakeRequesterAgent(updated, "host_command_request_completed");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const finalized = await runLogStore.finalize(logHandle);
      const finishedAt = new Date();
      const updated = await db
        .update(hostCommandRequests)
        .set({
          status: "failed",
          exitCode: null,
          stdoutExcerpt: excerptOutput(stdout),
          stderrExcerpt: excerptOutput(`${stderr}${stderr ? "\n" : ""}${message}`),
          finishedAt,
          updatedAt: finishedAt,
          logStore: logHandle.store,
          logRef: logHandle.logRef,
          logBytes: finalized.bytes,
          logSha256: finalized.sha256 ?? null,
          logCompressed: finalized.compressed,
        })
        .where(eq(hostCommandRequests.id, running.id))
        .returning()
        .then((rows) => rows[0] ?? null);

      if (!updated) {
        return;
      }

      await addApprovalComment(
        updated.approvalId,
        updated.companyId,
        `Host command failed: ${summarizeExcerpt(message) ?? "Execution failed."}`,
      );
      await logActivity(db, {
        companyId: updated.companyId,
        actorType: "system",
        actorId: "host_command_fallback",
        action: "host_command.execution_failed",
        entityType: "host_command_request",
        entityId: updated.id,
        details: {
          issueId: updated.issueId,
          approvalId: updated.approvalId,
          binary: updated.binary,
          error: summarizeExcerpt(message),
        },
      });
      await wakeRequesterAgent(updated, "host_command_request_completed", message);
    }
  }

  function queueExecution(requestId: string) {
    const existing = executionInFlight.get(requestId);
    if (existing) return existing;

    const promise = executeRequest(requestId).finally(() => {
      if (executionInFlight.get(requestId) === promise) {
        executionInFlight.delete(requestId);
      }
    });
    executionInFlight.set(requestId, promise);
    return promise;
  }

  return {
    async create(
      companyId: string,
      input: CreateHostCommandFallback,
      actor: { agentId: string },
    ): Promise<{
      request: HostCommandRequest;
      approval: typeof approvals.$inferSelect | null;
      result: CreateHostCommandFallbackResult;
    }> {
      const binary = normalizeBinary(input.binary);
      if (!path.isAbsolute(input.cwd)) {
        throw badRequest("cwd must be an absolute path");
      }

      const args = toArgs(input.args);
      const issue = await getIssueOrThrow(input.issueId);
      if (issue.companyId !== companyId) {
        throw forbidden("Issue does not belong to this company");
      }
      if (issue.assigneeAgentId !== actor.agentId) {
        throw forbidden("Only the assignee agent can request host command fallback");
      }

      const allowlistRow = await getActiveAllowlistRow(issue.projectId, binary);
      const now = new Date();

      if (allowlistRow) {
        const created = await db
          .insert(hostCommandRequests)
          .values({
            companyId,
            issueId: issue.id,
            projectId: issue.projectId,
            requestedByAgentId: actor.agentId,
            approvalId: null,
            status: "queued",
            binary,
            args,
            cwd: input.cwd,
            reason: input.reason,
            missingCommand: input.missingCommand ?? null,
            localErrorExcerpt: input.localErrorExcerpt ?? null,
            updatedAt: now,
          })
          .returning()
          .then((rows) => rows[0] ?? null);

        if (!created) {
          throw badRequest("Failed to create host command request");
        }

        await logActivity(db, {
          companyId,
          actorType: "agent",
          actorId: actor.agentId,
          agentId: actor.agentId,
          action: "host_command.requested",
          entityType: "host_command_request",
          entityId: created.id,
          details: {
            issueId: issue.id,
            projectId: issue.projectId,
            binary,
            viaAllowlist: true,
          },
        });

        void queueExecution(created.id);
        return {
          request: toRequest(created),
          approval: null,
          result: {
            status: "queued",
            requestId: created.id,
            approvalId: null,
          },
        };
      }

      const requestId = randomUUID();
      const payload: HostCommandFallbackApprovalPayload = {
        requestId,
        issueId: issue.id,
        projectId: issue.projectId,
        binary,
        args,
        cwd: input.cwd,
        reason: input.reason,
        missingCommand: input.missingCommand ?? null,
        localErrorExcerpt: input.localErrorExcerpt ?? null,
      };

      const created = await db.transaction(async (tx) => {
        const [requestRow] = await tx
          .insert(hostCommandRequests)
          .values({
            id: requestId,
            companyId,
            issueId: issue.id,
            projectId: issue.projectId,
            requestedByAgentId: actor.agentId,
            approvalId: null,
            status: "pending_approval",
            binary,
            args,
            cwd: input.cwd,
            reason: input.reason,
            missingCommand: input.missingCommand ?? null,
            localErrorExcerpt: input.localErrorExcerpt ?? null,
            updatedAt: now,
          })
          .returning();

        const [approval] = await tx
          .insert(approvals)
          .values({
            companyId,
            type: "host_command_fallback",
            requestedByAgentId: actor.agentId,
            requestedByUserId: null,
            status: "pending",
            payload: payload as unknown as Record<string, unknown>,
            decisionNote: null,
            decidedByUserId: null,
            decidedAt: null,
            updatedAt: now,
          })
          .returning();

        await tx
          .update(hostCommandRequests)
          .set({
            approvalId: approval.id,
            updatedAt: now,
          })
          .where(eq(hostCommandRequests.id, requestRow.id));

        await tx.insert(issueApprovals).values({
          companyId,
          issueId: issue.id,
          approvalId: approval.id,
          linkedByAgentId: actor.agentId,
          linkedByUserId: null,
        });

        return {
          request: {
            ...requestRow,
            approvalId: approval.id,
            updatedAt: now,
          },
          approval,
        };
      });

      await logActivity(db, {
        companyId,
        actorType: "agent",
        actorId: actor.agentId,
        agentId: actor.agentId,
        action: "host_command.requested",
        entityType: "host_command_request",
        entityId: created.request.id,
        details: {
          issueId: issue.id,
          projectId: issue.projectId,
          binary,
          approvalId: created.approval.id,
        },
      });
      await logActivity(db, {
        companyId,
        actorType: "agent",
        actorId: actor.agentId,
        agentId: actor.agentId,
        action: "approval.created",
        entityType: "approval",
        entityId: created.approval.id,
        details: {
          type: "host_command_fallback",
          issueIds: [issue.id],
        },
      });

      return {
        request: toRequest(created.request),
        approval: created.approval,
        result: {
          status: "approval_required",
          requestId: created.request.id,
          approvalId: created.approval.id,
        },
      };
    },

    async getById(requestId: string) {
      const requestRow = await getRequestRow(requestId);
      return buildDetail(requestRow);
    },

    async getByApprovalId(approvalId: string) {
      const requestRow = await getRequestRowByApprovalId(approvalId);
      return requestRow ? buildDetail(requestRow) : null;
    },

    async listAllowlist(companyId: string) {
      const rows = await db
        .select()
        .from(hostCommandAllowlistEntries)
        .where(eq(hostCommandAllowlistEntries.companyId, companyId))
        .orderBy(desc(hostCommandAllowlistEntries.updatedAt), desc(hostCommandAllowlistEntries.createdAt));
      return rows.map(toAllowlistEntry);
    },

    async revokeAllowlistEntry(entryId: string, decidedByUserId: string) {
      const existing = await db
        .select()
        .from(hostCommandAllowlistEntries)
        .where(eq(hostCommandAllowlistEntries.id, entryId))
        .then((rows) => rows[0] ?? null);
      if (!existing) {
        throw notFound("Host command allowlist entry not found");
      }
      if (existing.revokedAt) {
        return toAllowlistEntry(existing);
      }

      const now = new Date();
      const updated = await db
        .update(hostCommandAllowlistEntries)
        .set({
          revokedAt: now,
          revokedByUserId: decidedByUserId,
          updatedAt: now,
        })
        .where(eq(hostCommandAllowlistEntries.id, entryId))
        .returning()
        .then((rows) => rows[0] ?? null);

      if (!updated) {
        throw notFound("Host command allowlist entry not found");
      }

      await logActivity(db, {
        companyId: updated.companyId,
        actorType: "user",
        actorId: decidedByUserId,
        action: "host_command.allowlist_revoked",
        entityType: "host_command_allowlist_entry",
        entityId: updated.id,
        details: {
          projectId: updated.projectId,
          binary: updated.binary,
        },
      });
      return toAllowlistEntry(updated);
    },

    async assertCanApprove(approvalId: string, resolutionMode: ApprovalResolutionMode = "once") {
      const approval = await getApprovalRow(approvalId);
      if (approval.type !== "host_command_fallback") {
        throw unprocessable("Approval is not a host command fallback");
      }
      if (!ACTIONABLE_APPROVAL_STATUSES.has(approval.status)) {
        throw unprocessable("Only pending or revision requested approvals can be approved");
      }

      const requestRow = await getRequestRowByApprovalId(approvalId);
      if (!requestRow) {
        throw notFound("Host command request not found");
      }
      if (requestRow.status !== "pending_approval") {
        throw unprocessable("Host command request is not awaiting approval");
      }
      if (resolutionMode === "always" && !requestRow.projectId) {
        throw unprocessable("Approve always requires the linked issue to belong to a project");
      }

      return toRequest(requestRow);
    },

    async handleApprovalApproved(
      approvalId: string,
      decidedByUserId: string,
      resolutionMode: ApprovalResolutionMode = "once",
    ) {
      const requestRow = await getRequestRowByApprovalId(approvalId);
      if (!requestRow) {
        throw notFound("Host command request not found");
      }
      if (requestRow.status !== "pending_approval") {
        throw unprocessable("Host command request is not awaiting approval");
      }
      if (resolutionMode === "always" && !requestRow.projectId) {
        throw unprocessable("Approve always requires the linked issue to belong to a project");
      }

      const now = new Date();
      const updatedRequest = await db.transaction(async (tx) => {
        if (resolutionMode === "always" && requestRow.projectId) {
          const existingEntry = await tx
            .select()
            .from(hostCommandAllowlistEntries)
            .where(
              and(
                eq(hostCommandAllowlistEntries.projectId, requestRow.projectId),
                eq(hostCommandAllowlistEntries.binary, requestRow.binary),
              ),
            )
            .orderBy(desc(hostCommandAllowlistEntries.updatedAt), desc(hostCommandAllowlistEntries.createdAt))
            .then((rows) => rows[0] ?? null);

          if (existingEntry) {
            await tx
              .update(hostCommandAllowlistEntries)
              .set({
                companyId: requestRow.companyId,
                createdByUserId: decidedByUserId,
                createdFromApprovalId: approvalId,
                revokedAt: null,
                revokedByUserId: null,
                updatedAt: now,
              })
              .where(eq(hostCommandAllowlistEntries.id, existingEntry.id));
          } else {
            await tx.insert(hostCommandAllowlistEntries).values({
              companyId: requestRow.companyId,
              projectId: requestRow.projectId,
              binary: requestRow.binary,
              createdByUserId: decidedByUserId,
              createdFromApprovalId: approvalId,
              revokedAt: null,
              revokedByUserId: null,
              updatedAt: now,
            });
          }
        }

        return tx
          .update(hostCommandRequests)
          .set({
            status: "queued",
            updatedAt: now,
          })
          .where(eq(hostCommandRequests.id, requestRow.id))
          .returning()
          .then((rows) => rows[0] ?? null);
      });

      if (!updatedRequest) {
        throw notFound("Host command request not found");
      }

      await addApprovalComment(
        approvalId,
        requestRow.companyId,
        resolutionMode === "always"
          ? "Approved always. Future requests for this binary in the same project will bypass approval."
          : "Approved for now. This request will execute once on the host.",
      );
      if (resolutionMode === "always" && requestRow.projectId) {
        await logActivity(db, {
          companyId: requestRow.companyId,
          actorType: "user",
          actorId: decidedByUserId,
          action: "host_command.allowlist_granted",
          entityType: "host_command_request",
          entityId: requestRow.id,
          details: {
            projectId: requestRow.projectId,
            binary: requestRow.binary,
            approvalId,
          },
        });
      }

      void queueExecution(requestRow.id);
      return buildDetail(updatedRequest);
    },

    async handleApprovalRejected(approvalId: string, decidedByUserId: string) {
      const requestRow = await getRequestRowByApprovalId(approvalId);
      if (!requestRow) {
        throw notFound("Host command request not found");
      }
      if (requestRow.status === "rejected") {
        return buildDetail(requestRow);
      }
      if (requestRow.status !== "pending_approval") {
        throw unprocessable("Host command request is not awaiting approval");
      }

      const now = new Date();
      const updated = await db
        .update(hostCommandRequests)
        .set({
          status: "rejected",
          finishedAt: now,
          updatedAt: now,
        })
        .where(eq(hostCommandRequests.id, requestRow.id))
        .returning()
        .then((rows) => rows[0] ?? null);

      if (!updated) {
        throw notFound("Host command request not found");
      }

      await addApprovalComment(approvalId, updated.companyId, "Host command request rejected.");
      await logActivity(db, {
        companyId: updated.companyId,
        actorType: "user",
        actorId: decidedByUserId,
        action: "host_command.request_rejected",
        entityType: "host_command_request",
        entityId: updated.id,
        details: {
          issueId: updated.issueId,
          approvalId,
          binary: updated.binary,
        },
      });
      await wakeRequesterAgent(updated, "host_command_request_rejected");
      return buildDetail(updated);
    },
  };
}
