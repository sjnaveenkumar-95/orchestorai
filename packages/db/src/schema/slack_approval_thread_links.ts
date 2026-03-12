import { index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { approvals } from "./approvals.js";
import { projects } from "./projects.js";
import { projectSlackChannels } from "./project_slack_channels.js";

export const slackApprovalThreadLinks = pgTable(
  "slack_approval_thread_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    approvalId: uuid("approval_id").notNull().references(() => approvals.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
    projectSlackChannelId: uuid("project_slack_channel_id").references(() => projectSlackChannels.id, {
      onDelete: "set null",
    }),
    channelId: text("channel_id").notNull(),
    threadTs: text("thread_ts").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    approvalUq: uniqueIndex("slack_approval_thread_links_approval_uq").on(table.approvalId),
    channelThreadUq: uniqueIndex("slack_approval_thread_links_channel_thread_uq").on(
      table.channelId,
      table.threadTs,
    ),
    companyIdx: index("slack_approval_thread_links_company_idx").on(table.companyId),
  }),
);
