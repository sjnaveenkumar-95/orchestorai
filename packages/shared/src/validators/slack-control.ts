import { z } from "zod";
import { ISSUE_PRIORITIES, ISSUE_STATUSES } from "../constants.js";

export const SLACK_CONTROL_ACTION_TYPES = [
  "create_issue",
  "create_child_issue",
  "update_issue",
  "add_comment",
  "checkout_issue",
  "release_issue",
  "query",
  "clarify",
  "noop",
] as const;

export const slackControlInterpreterMutationSchema = z.object({
  title: z.string().trim().min(1).optional().nullable(),
  description: z.string().trim().min(1).optional().nullable(),
  commentBody: z.string().trim().min(1).optional().nullable(),
  status: z.enum(ISSUE_STATUSES).optional().nullable(),
  priority: z.enum(ISSUE_PRIORITIES).optional().nullable(),
  assigneeAgentRef: z.string().trim().min(1).optional().nullable(),
  projectRef: z.string().trim().min(1).optional().nullable(),
  goalRef: z.string().trim().min(1).optional().nullable(),
  parentIssueRef: z.string().trim().min(1).optional().nullable(),
  issueRef: z.string().trim().min(1).optional().nullable(),
  expectedStatuses: z.array(z.enum(ISSUE_STATUSES)).optional(),
  persistOriginalMessage: z.boolean().optional(),
  confirmed: z.boolean().optional(),
}).strict();

export const slackControlInterpreterResultSchema = z.object({
  actionType: z.enum(SLACK_CONTROL_ACTION_TYPES),
  targetIssueRef: z.string().trim().min(1).nullable(),
  targetProjectRef: z.string().trim().min(1).nullable(),
  targetAgentRef: z.string().trim().min(1).nullable(),
  normalizedMutation: slackControlInterpreterMutationSchema.nullable(),
  commentaryToPersist: z.string().trim().min(1).nullable(),
  slackReply: z.string().trim().min(1),
  confidence: z.number().min(0).max(1),
  needsClarification: z.boolean(),
  reasons: z.array(z.string().trim().min(1)).default([]),
}).strict();

export const slackControlMessageContextSchema = z.object({
  companyId: z.string().uuid(),
  projectId: z.string().uuid().nullable(),
  issueId: z.string().uuid().nullable(),
  channelId: z.string().trim().min(1),
  channelName: z.string().trim().min(1).nullable(),
  threadTs: z.string().trim().min(1),
  messageTs: z.string().trim().min(1),
  authorSlackUserId: z.string().trim().min(1).nullable(),
  authorSlackUserName: z.string().trim().min(1).nullable(),
  originalText: z.string(),
  normalizedText: z.string(),
  isThreadReply: z.boolean(),
  isLinkedIssueThread: z.boolean(),
  isRootProjectMessage: z.boolean(),
}).strict();

export type SlackControlInterpreterResult = z.infer<
  typeof slackControlInterpreterResultSchema
>;

export type SlackControlInterpreterMutation = z.infer<
  typeof slackControlInterpreterMutationSchema
>;

export type SlackControlMessageContext = z.infer<
  typeof slackControlMessageContextSchema
>;
