import { boolean, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";

export const companyChatRooms = pgTable(
  "company_chat_rooms",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    displayName: text("display_name").notNull(),
    slackChannelId: text("slack_channel_id"),
    slackChannelName: text("slack_channel_name"),
    status: text("status").notNull().default("pending"),
    enabled: boolean("enabled").notNull().default(false),
    idleThresholdHours: integer("idle_threshold_hours").notNull().default(3),
    maxAutonomousThreads: integer("max_autonomous_threads").notNull().default(3),
    autonomousStartEnabled: boolean("autonomous_start_enabled").notNull().default(true),
    allowedTopics: jsonb("allowed_topics").$type<Array<Record<string, unknown>>>().notNull().default([]),
    chatBudgetMonthlyCents: integer("chat_budget_monthly_cents").notNull().default(0),
    chatSpentMonthlyCents: integer("chat_spent_monthly_cents").notNull().default(0),
    promptPackDir: text("prompt_pack_dir"),
    promptSystemPath: text("prompt_system_path"),
    promptAgentsPath: text("prompt_agents_path"),
    promptSoulPath: text("prompt_soul_path"),
    lastRoomActivityAt: timestamp("last_room_activity_at", { withTimezone: true }),
    lastError: text("last_error"),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyUq: uniqueIndex("company_chat_rooms_company_uq").on(table.companyId),
    channelIdUq: uniqueIndex("company_chat_rooms_channel_id_uq").on(table.slackChannelId),
    companyStatusIdx: index("company_chat_rooms_company_status_idx").on(table.companyId, table.status),
  }),
);
