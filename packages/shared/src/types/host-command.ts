import type { HostCommandRequestStatus } from "../constants.js";
import type { SlackApprovalThreadLink } from "./slack.js";

export interface HostCommandRequest {
  id: string;
  companyId: string;
  issueId: string;
  projectId: string | null;
  requestedByAgentId: string;
  approvalId: string | null;
  status: HostCommandRequestStatus;
  binary: string;
  args: string[];
  cwd: string;
  reason: string;
  missingCommand: string | null;
  localErrorExcerpt: string | null;
  exitCode: number | null;
  stdoutExcerpt: string | null;
  stderrExcerpt: string | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  logStore: string | null;
  logRef: string | null;
  logBytes: number | null;
  logSha256: string | null;
  logCompressed: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface HostCommandAllowlistEntry {
  id: string;
  companyId: string;
  projectId: string;
  binary: string;
  createdByUserId: string;
  createdFromApprovalId: string | null;
  revokedAt: Date | null;
  revokedByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface HostCommandRequestDetail extends HostCommandRequest {
  allowlistEntry: HostCommandAllowlistEntry | null;
  approvalThread: SlackApprovalThreadLink | null;
  issueIdentifier: string | null;
  issueTitle: string | null;
}

export interface HostCommandFallbackApprovalPayload {
  requestId: string;
  issueId: string;
  projectId: string | null;
  binary: string;
  args: string[];
  cwd: string;
  reason: string;
  missingCommand: string | null;
  localErrorExcerpt: string | null;
}

export type CreateHostCommandFallbackResult =
  | {
      status: "approval_required";
      requestId: string;
      approvalId: string;
    }
  | {
      status: "queued";
      requestId: string;
      approvalId: string | null;
    };
