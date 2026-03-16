import { z } from "zod";
import {
  COMPANY_CHAT_MESSAGE_AUTHOR_TYPES,
  COMPANY_CHAT_ROOM_STATUSES,
  COMPANY_CHAT_THREAD_ORIGINS,
  COMPANY_CHAT_THREAD_STATUSES,
} from "../constants.js";
import { normalizeSlackChannelName } from "../slack-channel-name.js";

function normalizeTopicSlug(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-");
}

export const companyChatTopicSchema = z.object({
  slug: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .transform((value) => normalizeTopicSlug(value))
    .refine((value) => value.length > 0, "Topic slug is required"),
  label: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).optional().nullable(),
  autonomousAllowed: z.boolean().optional().default(true),
  internetAllowed: z.boolean().optional().default(true),
});

export type CompanyChatTopicInput = z.infer<typeof companyChatTopicSchema>;

export const updateCompanyChatRoomSchema = z.object({
  displayName: z.string().trim().min(1).max(120).optional(),
  slackChannelName: z
    .string()
    .trim()
    .max(120)
    .transform((value) => normalizeSlackChannelName(value))
    .optional()
    .nullable(),
  status: z.enum(COMPANY_CHAT_ROOM_STATUSES).optional(),
  enabled: z.boolean().optional(),
  idleThresholdHours: z.number().int().min(1).max(168).optional(),
  maxAutonomousThreads: z.number().int().min(1).max(20).optional(),
  autonomousStartEnabled: z.boolean().optional(),
  allowedTopics: z.array(companyChatTopicSchema).max(50).optional(),
  chatBudgetMonthlyCents: z.number().int().nonnegative().optional(),
  chatSpentMonthlyCents: z.number().int().nonnegative().optional(),
});

export type UpdateCompanyChatRoom = z.infer<typeof updateCompanyChatRoomSchema>;

export const updateCompanyChatPromptPackSchema = z
  .object({
    system: z.string().trim().min(1).optional(),
    agents: z.string().trim().min(1).optional(),
    soul: z.string().trim().min(1).optional(),
  })
  .refine((value) => Object.values(value).some((entry) => typeof entry === "string"), {
    message: "At least one prompt-pack file must be provided",
  });

export type UpdateCompanyChatPromptPack = z.infer<typeof updateCompanyChatPromptPackSchema>;

export const createCompanyChatThreadSchema = z.object({
  topic: z.string().trim().min(1).max(80).optional().nullable(),
  text: z.string().trim().min(1).max(8000),
  autonomous: z.boolean().optional().default(false),
  internetBacked: z.boolean().optional().default(false),
});

export type CreateCompanyChatThread = z.infer<typeof createCompanyChatThreadSchema>;

export const createCompanyChatMessageSchema = z.object({
  text: z.string().trim().min(1).max(8000),
  internetBacked: z.boolean().optional().default(false),
});

export type CreateCompanyChatMessage = z.infer<typeof createCompanyChatMessageSchema>;

export const createCompanyChatReactionSchema = z.object({
  emoji: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .regex(/^[a-z0-9_+-]+$/i, "Emoji must be a valid Slack reaction name"),
});

export type CreateCompanyChatReaction = z.infer<typeof createCompanyChatReactionSchema>;

export const companyChatThreadStatusSchema = z.enum(COMPANY_CHAT_THREAD_STATUSES);
export const companyChatThreadOriginSchema = z.enum(COMPANY_CHAT_THREAD_ORIGINS);
export const companyChatMessageAuthorTypeSchema = z.enum(COMPANY_CHAT_MESSAGE_AUTHOR_TYPES);
