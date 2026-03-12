import { index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { projects } from "./projects.js";
import { approvals } from "./approvals.js";

export const hostCommandAllowlistEntries = pgTable(
  "host_command_allowlist_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    projectId: uuid("project_id").notNull().references(() => projects.id),
    binary: text("binary").notNull(),
    createdByUserId: text("created_by_user_id").notNull(),
    createdFromApprovalId: uuid("created_from_approval_id").references(() => approvals.id, {
      onDelete: "set null",
    }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revokedByUserId: text("revoked_by_user_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    projectBinaryUq: uniqueIndex("host_command_allowlist_entries_project_binary_uq").on(
      table.projectId,
      table.binary,
    ),
    companyProjectIdx: index("host_command_allowlist_entries_company_project_idx").on(
      table.companyId,
      table.projectId,
    ),
  }),
);
