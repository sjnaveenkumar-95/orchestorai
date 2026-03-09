import { boolean, index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { issues } from "./issues.js";
import { projects } from "./projects.js";
import { projectSlackChannels } from "./project_slack_channels.js";

export const slackThreadLinks = pgTable(
  "slack_thread_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    issueId: uuid("issue_id").notNull().references(() => issues.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
    projectSlackChannelId: uuid("project_slack_channel_id")
      .references(() => projectSlackChannels.id, { onDelete: "set null" }),
    channelId: text("channel_id").notNull(),
    threadTs: text("thread_ts").notNull(),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyIssueIdx: index("slack_thread_links_company_issue_idx").on(table.companyId, table.issueId),
    channelThreadIdx: index("slack_thread_links_channel_thread_idx").on(table.channelId, table.threadTs),
  }),
);
