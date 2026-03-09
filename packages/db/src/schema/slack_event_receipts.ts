import { index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";

export const slackEventReceipts = pgTable(
  "slack_event_receipts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").references(() => companies.id, { onDelete: "set null" }),
    eventId: text("event_id").notNull(),
    eventType: text("event_type"),
    apiAppId: text("api_app_id"),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyIdx: index("slack_event_receipts_company_idx").on(table.companyId),
    apiAppIdx: index("slack_event_receipts_api_app_idx").on(table.apiAppId),
    eventIdUq: uniqueIndex("slack_event_receipts_event_id_uq").on(table.eventId),
  }),
);
