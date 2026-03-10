import type { IssuePriority, IssueStatus } from "../constants.js";

export type SlackControlActionType =
  | "create_issue"
  | "create_child_issue"
  | "update_issue"
  | "add_comment"
  | "checkout_issue"
  | "release_issue"
  | "query"
  | "clarify"
  | "noop";

export interface SlackControlInterpreterMutation {
  title?: string | null;
  description?: string | null;
  commentBody?: string | null;
  status?: IssueStatus | null;
  priority?: IssuePriority | null;
  assigneeAgentRef?: string | null;
  projectRef?: string | null;
  goalRef?: string | null;
  parentIssueRef?: string | null;
  issueRef?: string | null;
  expectedStatuses?: IssueStatus[];
  persistOriginalMessage?: boolean;
  confirmed?: boolean;
}

export interface SlackControlInterpreterResult {
  actionType: SlackControlActionType;
  targetIssueRef: string | null;
  targetProjectRef: string | null;
  targetAgentRef: string | null;
  normalizedMutation: SlackControlInterpreterMutation | null;
  commentaryToPersist: string | null;
  slackReply: string;
  confidence: number;
  needsClarification: boolean;
  reasons: string[];
}

export interface SlackControlMessageContext {
  companyId: string;
  projectId: string | null;
  issueId: string | null;
  channelId: string;
  channelName: string | null;
  threadTs: string;
  messageTs: string;
  authorSlackUserId: string | null;
  authorSlackUserName: string | null;
  originalText: string;
  normalizedText: string;
  isThreadReply: boolean;
  isLinkedIssueThread: boolean;
  isRootProjectMessage: boolean;
}
