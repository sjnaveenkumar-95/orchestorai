import { pgTable, uuid, text, timestamp, date, index, jsonb, integer, uniqueIndex } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { goals } from "./goals.js";
import { agents } from "./agents.js";

export const projects = pgTable(
  "projects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    goalId: uuid("goal_id").references(() => goals.id),
    name: text("name").notNull(),
    description: text("description"),
    issuePrefix: text("issue_prefix"),
    issueCounter: integer("issue_counter").notNull().default(0),
    status: text("status").notNull().default("backlog"),
    leadAgentId: uuid("lead_agent_id").references(() => agents.id),
    targetDate: date("target_date"),
    color: text("color"),
    slackChannelVisibility: text("slack_channel_visibility").notNull().default("public"),
    slackChannelName: text("slack_channel_name"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyIdx: index("projects_company_idx").on(table.companyId),
    issuePrefixUniqueIdx: uniqueIndex("projects_issue_prefix_idx").on(table.issuePrefix),
  }),
);
