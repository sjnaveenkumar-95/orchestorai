import { z } from "zod";
import { APPROVAL_RESOLUTION_MODES, APPROVAL_TYPES } from "../constants.js";
import { createHostCommandFallbackSchema } from "./host-command.js";

export const createApprovalSchema = z.union([
  z.object({
    type: z.literal("host_command_fallback"),
    requestedByAgentId: z.string().uuid().optional().nullable(),
    payload: createHostCommandFallbackSchema.extend({
      projectId: z.string().uuid().optional().nullable(),
      requestId: z.string().uuid().optional(),
    }),
    issueIds: z.array(z.string().uuid()).optional(),
  }),
  z.object({
    type: z.enum(["hire_agent", "approve_ceo_strategy"]),
    requestedByAgentId: z.string().uuid().optional().nullable(),
    payload: z.record(z.unknown()),
    issueIds: z.array(z.string().uuid()).optional(),
  }),
]);

export type CreateApproval = z.infer<typeof createApprovalSchema>;

export const resolveApprovalSchema = z.object({
  decisionNote: z.string().optional().nullable(),
  decidedByUserId: z.string().optional().default("board"),
  resolutionMode: z.enum(APPROVAL_RESOLUTION_MODES).optional(),
});

export type ResolveApproval = z.infer<typeof resolveApprovalSchema>;

export const requestApprovalRevisionSchema = z.object({
  decisionNote: z.string().optional().nullable(),
  decidedByUserId: z.string().optional().default("board"),
});

export type RequestApprovalRevision = z.infer<typeof requestApprovalRevisionSchema>;

export const resubmitApprovalSchema = z.object({
  payload: z.record(z.unknown()).optional(),
});

export type ResubmitApproval = z.infer<typeof resubmitApprovalSchema>;

export const addApprovalCommentSchema = z.object({
  body: z.string().min(1),
});

export type AddApprovalComment = z.infer<typeof addApprovalCommentSchema>;
