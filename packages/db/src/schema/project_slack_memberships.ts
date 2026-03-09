import { index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { agents } from "./agents.js";
import { agentSlackApps } from "./agent_slack_apps.js";
import { companies } from "./companies.js";
import { projectSlackChannels } from "./project_slack_channels.js";
import { projects } from "./projects.js";

export const projectSlackMemberships = pgTable(
  "project_slack_memberships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    projectSlackChannelId: uuid("project_slack_channel_id")
      .references(() => projectSlackChannels.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id").notNull().references(() => agents.id, { onDelete: "cascade" }),
    agentSlackAppId: uuid("agent_slack_app_id").references(() => agentSlackApps.id, { onDelete: "set null" }),
    syncStatus: text("sync_status").notNull().default("pending"),
    lastError: text("last_error"),
    syncedAt: timestamp("synced_at", { withTimezone: true }),
    removedAt: timestamp("removed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyProjectIdx: index("project_slack_memberships_company_project_idx").on(table.companyId, table.projectId),
    companyAgentIdx: index("project_slack_memberships_company_agent_idx").on(table.companyId, table.agentId),
    syncStatusIdx: index("project_slack_memberships_sync_status_idx").on(table.syncStatus),
    projectAgentUq: uniqueIndex("project_slack_memberships_project_agent_uq").on(table.projectId, table.agentId),
  }),
);
