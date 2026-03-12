import { boolean, index, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { issues } from "./issues.js";
import { projects } from "./projects.js";
import { agents } from "./agents.js";
import { approvals } from "./approvals.js";

export const hostCommandRequests = pgTable(
  "host_command_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    issueId: uuid("issue_id").notNull().references(() => issues.id),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
    requestedByAgentId: uuid("requested_by_agent_id").notNull().references(() => agents.id),
    approvalId: uuid("approval_id").references(() => approvals.id, { onDelete: "set null" }),
    status: text("status").notNull().default("pending_approval"),
    binary: text("binary").notNull(),
    args: jsonb("args").$type<string[]>().notNull(),
    cwd: text("cwd").notNull(),
    reason: text("reason").notNull(),
    missingCommand: text("missing_command"),
    localErrorExcerpt: text("local_error_excerpt"),
    exitCode: integer("exit_code"),
    stdoutExcerpt: text("stdout_excerpt"),
    stderrExcerpt: text("stderr_excerpt"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    logStore: text("log_store"),
    logRef: text("log_ref"),
    logBytes: integer("log_bytes"),
    logSha256: text("log_sha256"),
    logCompressed: boolean("log_compressed").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyStatusCreatedIdx: index("host_command_requests_company_status_created_idx").on(
      table.companyId,
      table.status,
      table.createdAt,
    ),
    issueIdx: index("host_command_requests_issue_idx").on(table.issueId),
    approvalIdx: index("host_command_requests_approval_idx").on(table.approvalId),
    requestedByAgentIdx: index("host_command_requests_requested_by_agent_idx").on(table.requestedByAgentId),
  }),
);
