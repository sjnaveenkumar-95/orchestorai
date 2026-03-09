import { index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { projects } from "./projects.js";

export const projectSlackChannels = pgTable(
  "project_slack_channels",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    channelId: text("channel_id"),
    channelName: text("channel_name"),
    visibility: text("visibility").notNull().default("public"),
    status: text("status").notNull().default("pending"),
    lastError: text("last_error"),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyProjectIdx: index("project_slack_channels_company_project_idx").on(table.companyId, table.projectId),
    statusIdx: index("project_slack_channels_status_idx").on(table.status),
    projectUq: uniqueIndex("project_slack_channels_project_uq").on(table.projectId),
    channelIdUq: uniqueIndex("project_slack_channels_channel_id_uq").on(table.channelId),
  }),
);
