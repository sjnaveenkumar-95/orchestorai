import { index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { agents } from "./agents.js";
import { companies } from "./companies.js";
import { companySecrets } from "./company_secrets.js";

export const agentSlackApps = pgTable(
  "agent_slack_apps",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    agentId: uuid("agent_id").notNull().references(() => agents.id, { onDelete: "cascade" }),
    slackAppId: text("slack_app_id"),
    clientId: text("client_id"),
    botUserId: text("bot_user_id"),
    teamId: text("team_id"),
    installStatus: text("install_status").notNull().default("not_configured"),
    installUrl: text("install_url"),
    oauthState: text("oauth_state"),
    clientSecretSecretId: uuid("client_secret_secret_id").references(() => companySecrets.id, { onDelete: "set null" }),
    botTokenSecretId: uuid("bot_token_secret_id").references(() => companySecrets.id, { onDelete: "set null" }),
    signingSecretSecretId: uuid("signing_secret_secret_id").references(() => companySecrets.id, { onDelete: "set null" }),
    lastError: text("last_error"),
    disabledAt: timestamp("disabled_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyAgentIdx: index("agent_slack_apps_company_agent_idx").on(table.companyId, table.agentId),
    installStatusIdx: index("agent_slack_apps_install_status_idx").on(table.installStatus),
    agentUq: uniqueIndex("agent_slack_apps_agent_uq").on(table.agentId),
  }),
);
