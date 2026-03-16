import { boolean, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { agents } from "./agents.js";
import { authUsers } from "./auth.js";
import { companies } from "./companies.js";
import { companyChatRooms } from "./company_chat_rooms.js";

export const companyChatThreads = pgTable(
  "company_chat_threads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    roomId: uuid("room_id").notNull().references(() => companyChatRooms.id, { onDelete: "cascade" }),
    topic: text("topic"),
    origin: text("origin").notNull(),
    autonomous: boolean("autonomous").notNull().default(false),
    initiatedByAgentId: uuid("initiated_by_agent_id").references(() => agents.id, { onDelete: "set null" }),
    initiatedByUserId: text("initiated_by_user_id").references(() => authUsers.id, { onDelete: "set null" }),
    slackChannelId: text("slack_channel_id"),
    slackThreadTs: text("slack_thread_ts"),
    status: text("status").notNull().default("active"),
    completionAssessment: text("completion_assessment").notNull().default("unclear"),
    lastActivityAt: timestamp("last_activity_at", { withTimezone: true }).notNull().defaultNow(),
    followOnDueAt: timestamp("follow_on_due_at", { withTimezone: true }),
    followOnGeneration: integer("follow_on_generation").notNull().default(0),
    messageCount: integer("message_count").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    roomStatusIdx: index("company_chat_threads_room_status_idx").on(table.roomId, table.status, table.lastActivityAt),
    roomAutonomousIdx: index("company_chat_threads_room_autonomous_idx").on(table.roomId, table.autonomous, table.status),
    followOnDueIdx: index("company_chat_threads_follow_on_due_idx").on(table.status, table.followOnDueAt),
    slackThreadUq: uniqueIndex("company_chat_threads_slack_thread_uq").on(table.roomId, table.slackThreadTs),
  }),
);
