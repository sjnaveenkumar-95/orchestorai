import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams, useSearchParams } from "@/lib/router";
import { CheckCircle2, ChevronRight, Sparkles } from "lucide-react";
import type { ApprovalComment, HostCommandRequestDetail } from "@orchestorai/shared";
import { approvalsApi } from "../api/approvals";
import { agentsApi } from "../api/agents";
import { hostCommandFallbacksApi } from "../api/host-command-fallbacks";
import { MarkdownBody } from "../components/MarkdownBody";
import { typeLabel, typeIcon, defaultTypeIcon, ApprovalPayloadRenderer } from "../components/ApprovalPayload";
import { Identity } from "../components/Identity";
import { PageSkeleton } from "../components/PageSkeleton";
import { StatusBadge } from "../components/StatusBadge";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { useCompany } from "../context/CompanyContext";
import { queryKeys } from "../lib/queryKeys";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

function HostCommandRequestPanel({
  request,
  isLoading,
  onRevokeAllowlist,
  isRevokingAllowlist,
}: {
  request: HostCommandRequestDetail | undefined;
  isLoading: boolean;
  onRevokeAllowlist: () => void;
  isRevokingAllowlist: boolean;
}) {
  if (isLoading) {
    return (
      <div className="border border-border rounded-lg p-4">
        <p className="text-sm text-muted-foreground">Loading host command request details...</p>
      </div>
    );
  }

  if (!request) {
    return (
      <div className="border border-border rounded-lg p-4">
        <p className="text-sm text-muted-foreground">Host command request details are unavailable.</p>
      </div>
    );
  }

  const commandText = [request.binary, ...request.args].join(" ").trim();

  return (
    <div className="border border-border rounded-lg p-4 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-medium">Host Command Request</h3>
          <p className="text-xs text-muted-foreground font-mono">{request.id}</p>
        </div>
        <StatusBadge status={request.status} />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">Command</p>
          <p className="text-xs font-mono rounded-md bg-muted/40 px-2 py-1 break-all">{commandText}</p>
        </div>
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">Working directory</p>
          <p className="text-xs font-mono rounded-md bg-muted/40 px-2 py-1 break-all">{request.cwd}</p>
        </div>
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">Linked issue</p>
          <p className="text-sm">
            {request.issueIdentifier ? `${request.issueIdentifier} ` : ""}
            {request.issueTitle ?? request.issueId}
          </p>
        </div>
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">Approval thread</p>
          {request.approvalThread ? (
            <p className="text-xs font-mono rounded-md bg-muted/40 px-2 py-1 break-all">
              {request.approvalThread.channelId} / {request.approvalThread.threadTs}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">Inbox only or Slack thread not posted.</p>
          )}
        </div>
        <div className="space-y-1 sm:col-span-2">
          <p className="text-xs text-muted-foreground">Reason</p>
          <p className="text-sm">{request.reason}</p>
        </div>
      </div>

      {request.missingCommand && (
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">Missing command</p>
          <p className="text-xs font-mono rounded-md bg-muted/40 px-2 py-1 inline-block">
            {request.missingCommand}
          </p>
        </div>
      )}

      {request.localErrorExcerpt && (
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">Local failure excerpt</p>
          <pre className="text-xs bg-muted/40 rounded-md p-3 overflow-x-auto whitespace-pre-wrap">
            {request.localErrorExcerpt}
          </pre>
        </div>
      )}

      {request.stdoutExcerpt && (
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">Stdout excerpt</p>
          <pre className="text-xs bg-muted/40 rounded-md p-3 overflow-x-auto whitespace-pre-wrap">
            {request.stdoutExcerpt}
          </pre>
        </div>
      )}

      {request.stderrExcerpt && (
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">Stderr excerpt</p>
          <pre className="text-xs bg-muted/40 rounded-md p-3 overflow-x-auto whitespace-pre-wrap">
            {request.stderrExcerpt}
          </pre>
        </div>
      )}

      <div className="rounded-md border border-border/60 p-3 space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-xs text-muted-foreground">Allowlist</p>
            <p className="text-sm">
              {request.allowlistEntry
                ? "Active for this project and binary."
                : "No active project allowlist entry."}
            </p>
          </div>
          {request.allowlistEntry && !request.allowlistEntry.revokedAt && (
            <Button
              size="sm"
              variant="outline"
              className="text-destructive border-destructive/40"
              onClick={onRevokeAllowlist}
              disabled={isRevokingAllowlist}
            >
              {isRevokingAllowlist ? "Revoking..." : "Revoke allowlist"}
            </Button>
          )}
        </div>
        {request.allowlistEntry && (
          <p className="text-xs text-muted-foreground font-mono break-all">
            {request.allowlistEntry.projectId} / {request.allowlistEntry.binary}
          </p>
        )}
      </div>

      {(request.logStore || request.logRef || request.startedAt || request.finishedAt) && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">Started</p>
            <p className="text-sm">{request.startedAt ? new Date(request.startedAt).toLocaleString() : "—"}</p>
          </div>
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">Finished</p>
            <p className="text-sm">{request.finishedAt ? new Date(request.finishedAt).toLocaleString() : "—"}</p>
          </div>
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">Log store</p>
            <p className="text-xs font-mono break-all">{request.logStore ?? "—"}</p>
          </div>
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">Log reference</p>
            <p className="text-xs font-mono break-all">{request.logRef ?? "—"}</p>
          </div>
        </div>
      )}
    </div>
  );
}

export function ApprovalDetail() {
  const { approvalId } = useParams<{ approvalId: string }>();
  const { selectedCompanyId, setSelectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const [commentBody, setCommentBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [showRawPayload, setShowRawPayload] = useState(false);

  const { data: approval, isLoading } = useQuery({
    queryKey: queryKeys.approvals.detail(approvalId!),
    queryFn: () => approvalsApi.get(approvalId!),
    enabled: !!approvalId,
  });
  const resolvedCompanyId = approval?.companyId ?? selectedCompanyId;
  const payload = (approval?.payload ?? {}) as Record<string, unknown>;
  const isHostCommandApproval = approval?.type === "host_command_fallback";
  const hostCommandRequestId =
    isHostCommandApproval && typeof payload.requestId === "string" ? payload.requestId : null;

  const { data: comments } = useQuery({
    queryKey: queryKeys.approvals.comments(approvalId!),
    queryFn: () => approvalsApi.listComments(approvalId!),
    enabled: !!approvalId,
  });

  const { data: linkedIssues } = useQuery({
    queryKey: queryKeys.approvals.issues(approvalId!),
    queryFn: () => approvalsApi.listIssues(approvalId!),
    enabled: !!approvalId,
  });

  const { data: agents } = useQuery({
    queryKey: queryKeys.agents.list(resolvedCompanyId ?? ""),
    queryFn: () => agentsApi.list(resolvedCompanyId ?? ""),
    enabled: !!resolvedCompanyId,
  });

  const { data: hostCommandRequest, isLoading: isHostCommandRequestLoading } = useQuery({
    queryKey: queryKeys.hostCommand.detail(hostCommandRequestId ?? ""),
    queryFn: () => hostCommandFallbacksApi.get(hostCommandRequestId!),
    enabled: !!hostCommandRequestId,
  });

  useEffect(() => {
    if (!approval?.companyId || approval.companyId === selectedCompanyId) return;
    setSelectedCompanyId(approval.companyId, { source: "route_sync" });
  }, [approval?.companyId, selectedCompanyId, setSelectedCompanyId]);

  const agentNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const agent of agents ?? []) map.set(agent.id, agent.name);
    return map;
  }, [agents]);

  useEffect(() => {
    setBreadcrumbs([
      { label: "Approvals", href: "/approvals" },
      { label: approval?.id?.slice(0, 8) ?? approvalId ?? "Approval" },
    ]);
  }, [setBreadcrumbs, approval, approvalId]);

  const refresh = () => {
    if (!approvalId) return;
    queryClient.invalidateQueries({ queryKey: queryKeys.approvals.detail(approvalId) });
    queryClient.invalidateQueries({ queryKey: queryKeys.approvals.comments(approvalId) });
    queryClient.invalidateQueries({ queryKey: queryKeys.approvals.issues(approvalId) });
    if (hostCommandRequestId) {
      queryClient.invalidateQueries({ queryKey: queryKeys.hostCommand.detail(hostCommandRequestId) });
    }
    if (approval?.companyId) {
      queryClient.invalidateQueries({ queryKey: queryKeys.approvals.list(approval.companyId) });
      queryClient.invalidateQueries({
        queryKey: queryKeys.approvals.list(approval.companyId, "pending"),
      });
      queryClient.invalidateQueries({ queryKey: queryKeys.agents.list(approval.companyId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.hostCommand.allowlist(approval.companyId) });
    }
  };

  const approveMutation = useMutation({
    mutationFn: (resolutionMode?: "once" | "always") =>
      approvalsApi.approve(approvalId!, undefined, resolutionMode),
    onSuccess: () => {
      setError(null);
      refresh();
      navigate(`/approvals/${approvalId}?resolved=approved`, { replace: true });
    },
    onError: (err) => setError(err instanceof Error ? err.message : "Approve failed"),
  });

  const rejectMutation = useMutation({
    mutationFn: () => approvalsApi.reject(approvalId!),
    onSuccess: () => {
      setError(null);
      refresh();
    },
    onError: (err) => setError(err instanceof Error ? err.message : "Reject failed"),
  });

  const revisionMutation = useMutation({
    mutationFn: () => approvalsApi.requestRevision(approvalId!),
    onSuccess: () => {
      setError(null);
      refresh();
    },
    onError: (err) => setError(err instanceof Error ? err.message : "Revision request failed"),
  });

  const resubmitMutation = useMutation({
    mutationFn: () => approvalsApi.resubmit(approvalId!),
    onSuccess: () => {
      setError(null);
      refresh();
    },
    onError: (err) => setError(err instanceof Error ? err.message : "Resubmit failed"),
  });

  const addCommentMutation = useMutation({
    mutationFn: () => approvalsApi.addComment(approvalId!, commentBody.trim()),
    onSuccess: () => {
      setCommentBody("");
      setError(null);
      refresh();
    },
    onError: (err) => setError(err instanceof Error ? err.message : "Comment failed"),
  });

  const deleteAgentMutation = useMutation({
    mutationFn: (agentId: string) => agentsApi.remove(agentId),
    onSuccess: () => {
      setError(null);
      refresh();
      navigate("/approvals");
    },
    onError: (err) => setError(err instanceof Error ? err.message : "Delete failed"),
  });

  const revokeAllowlistMutation = useMutation({
    mutationFn: (entryId: string) => hostCommandFallbacksApi.revokeAllowlist(entryId),
    onSuccess: () => {
      setError(null);
      refresh();
    },
    onError: (err) => setError(err instanceof Error ? err.message : "Allowlist revoke failed"),
  });

  if (isLoading) return <PageSkeleton variant="detail" />;
  if (!approval) return <p className="text-sm text-muted-foreground">Approval not found.</p>;

  const linkedAgentId = typeof payload.agentId === "string" ? payload.agentId : null;
  const isActionable = approval.status === "pending" || approval.status === "revision_requested";
  const TypeIcon = typeIcon[approval.type] ?? defaultTypeIcon;
  const showApprovedBanner = searchParams.get("resolved") === "approved" && approval.status === "approved";
  const primaryLinkedIssue = linkedIssues?.[0] ?? null;
  const resolvedCta =
    primaryLinkedIssue
      ? {
          label:
            (linkedIssues?.length ?? 0) > 1
              ? "Review linked issues"
              : "Review linked issue",
          to: `/issues/${primaryLinkedIssue.identifier ?? primaryLinkedIssue.id}`,
        }
      : linkedAgentId
        ? {
            label: "Open hired agent",
            to: `/agents/${linkedAgentId}`,
          }
        : {
            label: "Back to approvals",
            to: "/approvals",
          };

  return (
    <div className="space-y-6 max-w-3xl">
      {showApprovedBanner && (
        <div className="border border-green-300 dark:border-green-700/40 bg-green-50 dark:bg-green-900/20 rounded-lg px-4 py-3 animate-in fade-in zoom-in-95 duration-300">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-2">
              <div className="relative mt-0.5">
                <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-300" />
                <Sparkles className="h-3 w-3 text-green-500 dark:text-green-200 absolute -right-2 -top-1 animate-pulse" />
              </div>
              <div>
                <p className="text-sm text-green-800 dark:text-green-100 font-medium">Approval confirmed</p>
                <p className="text-xs text-green-700 dark:text-green-200/90">
                  {isHostCommandApproval
                    ? "Host execution was queued. The requesting agent will be resumed after the command finishes."
                    : "Requesting agent was notified to review this approval and linked issues."}
                </p>
              </div>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="border-green-400 dark:border-green-600/50 text-green-800 dark:text-green-100 hover:bg-green-100 dark:hover:bg-green-900/30"
              onClick={() => navigate(resolvedCta.to)}
            >
              {resolvedCta.label}
            </Button>
          </div>
        </div>
      )}

      <div className="border border-border rounded-lg p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <TypeIcon className="h-5 w-5 text-muted-foreground shrink-0" />
            <div>
              <h2 className="text-lg font-semibold">{typeLabel[approval.type] ?? approval.type.replace(/_/g, " ")}</h2>
              <p className="text-xs text-muted-foreground font-mono">{approval.id}</p>
            </div>
          </div>
          <StatusBadge status={approval.status} />
        </div>

        <div className="text-sm space-y-1">
          {approval.requestedByAgentId && (
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground text-xs">Requested by</span>
              <Identity
                name={agentNameById.get(approval.requestedByAgentId) ?? approval.requestedByAgentId.slice(0, 8)}
                size="sm"
              />
            </div>
          )}
          <ApprovalPayloadRenderer type={approval.type} payload={payload} />
          <button
            type="button"
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors mt-2"
            onClick={() => setShowRawPayload((value) => !value)}
          >
            <ChevronRight className={`h-3 w-3 transition-transform ${showRawPayload ? "rotate-90" : ""}`} />
            See full request
          </button>
          {showRawPayload && (
            <pre className="text-xs bg-muted/40 rounded-md p-3 overflow-x-auto">
              {JSON.stringify(payload, null, 2)}
            </pre>
          )}
          {approval.decisionNote && (
            <p className="text-xs text-muted-foreground">Decision note: {approval.decisionNote}</p>
          )}
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        {linkedIssues && linkedIssues.length > 0 && (
          <div className="pt-2 border-t border-border/60">
            <p className="text-xs text-muted-foreground mb-1.5">Linked Issues</p>
            <div className="space-y-1.5">
              {linkedIssues.map((issue) => (
                <Link
                  key={issue.id}
                  to={`/issues/${issue.identifier ?? issue.id}`}
                  className="block text-xs rounded border border-border/70 px-2 py-1.5 hover:bg-accent/20"
                >
                  <span className="font-mono text-muted-foreground mr-2">
                    {issue.identifier ?? issue.id.slice(0, 8)}
                  </span>
                  <span>{issue.title}</span>
                </Link>
              ))}
            </div>
            <p className="text-[11px] text-muted-foreground mt-2">
              Linked issues remain open until the requesting agent follows up and closes them.
            </p>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          {isActionable && isHostCommandApproval && (
            <>
              <Button
                size="sm"
                className="bg-green-700 hover:bg-green-600 text-white"
                onClick={() => approveMutation.mutate("once")}
                disabled={approveMutation.isPending || rejectMutation.isPending}
              >
                Approve Once
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => approveMutation.mutate("always")}
                disabled={approveMutation.isPending || rejectMutation.isPending}
              >
                Approve Always
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => rejectMutation.mutate()}
                disabled={approveMutation.isPending || rejectMutation.isPending}
              >
                Reject
              </Button>
            </>
          )}

          {isActionable && !isHostCommandApproval && (
            <>
              <Button
                size="sm"
                className="bg-green-700 hover:bg-green-600 text-white"
                onClick={() => approveMutation.mutate(undefined)}
                disabled={approveMutation.isPending || rejectMutation.isPending}
              >
                Approve
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => rejectMutation.mutate()}
                disabled={approveMutation.isPending || rejectMutation.isPending}
              >
                Reject
              </Button>
            </>
          )}

          {approval.status === "pending" && !isHostCommandApproval && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => revisionMutation.mutate()}
              disabled={revisionMutation.isPending}
            >
              Request revision
            </Button>
          )}
          {approval.status === "revision_requested" && !isHostCommandApproval && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => resubmitMutation.mutate()}
              disabled={resubmitMutation.isPending}
            >
              Mark resubmitted
            </Button>
          )}
          {approval.status === "rejected" && approval.type === "hire_agent" && linkedAgentId && (
            <Button
              size="sm"
              variant="outline"
              className="text-destructive border-destructive/40"
              onClick={() => {
                if (!window.confirm("Delete this disapproved agent? This cannot be undone.")) return;
                deleteAgentMutation.mutate(linkedAgentId);
              }}
              disabled={deleteAgentMutation.isPending}
            >
              Delete disapproved agent
            </Button>
          )}
        </div>
      </div>

      {isHostCommandApproval && (
        <HostCommandRequestPanel
          request={hostCommandRequest}
          isLoading={isHostCommandRequestLoading}
          onRevokeAllowlist={() => {
            if (!hostCommandRequest?.allowlistEntry) return;
            revokeAllowlistMutation.mutate(hostCommandRequest.allowlistEntry.id);
          }}
          isRevokingAllowlist={revokeAllowlistMutation.isPending}
        />
      )}

      <div className="border border-border rounded-lg p-4 space-y-3">
        <h3 className="text-sm font-medium">Comments ({comments?.length ?? 0})</h3>
        <div className="space-y-2">
          {(comments ?? []).map((comment: ApprovalComment) => (
            <div key={comment.id} className="border border-border/60 rounded-md p-3">
              <div className="flex items-center justify-between mb-1">
                {comment.authorAgentId ? (
                  <Link to={`/agents/${comment.authorAgentId}`} className="hover:underline">
                    <Identity
                      name={agentNameById.get(comment.authorAgentId) ?? comment.authorAgentId.slice(0, 8)}
                      size="sm"
                    />
                  </Link>
                ) : (
                  <Identity name="Board" size="sm" />
                )}
                <span className="text-xs text-muted-foreground">
                  {new Date(comment.createdAt).toLocaleString()}
                </span>
              </div>
              <MarkdownBody className="text-sm">{comment.body}</MarkdownBody>
            </div>
          ))}
        </div>
        <Textarea
          value={commentBody}
          onChange={(e) => setCommentBody(e.target.value)}
          placeholder="Add a comment..."
          rows={3}
        />
        <div className="flex justify-end">
          <Button
            size="sm"
            onClick={() => addCommentMutation.mutate()}
            disabled={!commentBody.trim() || addCommentMutation.isPending}
          >
            {addCommentMutation.isPending ? "Posting..." : "Post comment"}
          </Button>
        </div>
      </div>
    </div>
  );
}
