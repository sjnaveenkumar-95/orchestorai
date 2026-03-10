import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { issues } from "./issues.js";
import { projects } from "./projects.js";

export const slackActionRuns = pgTable(
  "slack_action_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
    issueId: uuid("issue_id").references(() => issues.id, { onDelete: "set null" }),
    eventId: text("event_id"),
    channelId: text("channel_id").notNull(),
    threadTs: text("thread_ts").notNull(),
    messageTs: text("message_ts").notNull(),
    slackUserId: text("slack_user_id"),
    slackUserName: text("slack_user_name"),
    status: text("status").notNull().default("pending"),
    actionType: text("action_type"),
    confidence: text("confidence"),
    requestText: text("request_text").notNull(),
    normalizedText: text("normalized_text").notNull(),
    interpreterResult: jsonb("interpreter_result").$type<Record<string, unknown>>(),
    executionResult: jsonb("execution_result").$type<Record<string, unknown>>(),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyCreatedIdx: index("slack_action_runs_company_created_idx").on(table.companyId, table.createdAt),
    companyProjectIdx: index("slack_action_runs_company_project_idx").on(table.companyId, table.projectId),
    companyIssueIdx: index("slack_action_runs_company_issue_idx").on(table.companyId, table.issueId),
    channelThreadIdx: index("slack_action_runs_channel_thread_idx").on(table.channelId, table.threadTs),
    eventIdx: index("slack_action_runs_event_idx").on(table.eventId),
  }),
);
