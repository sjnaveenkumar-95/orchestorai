import { index, integer, pgTable, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { agents } from "./agents.js";
import { companies } from "./companies.js";
import { companyChatRooms } from "./company_chat_rooms.js";

export const companyChatParticipation = pgTable(
  "company_chat_participation",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    roomId: uuid("room_id").notNull().references(() => companyChatRooms.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id").notNull().references(() => agents.id, { onDelete: "cascade" }),
    messageCount: integer("message_count").notNull().default(0),
    autonomousStartsCount: integer("autonomous_starts_count").notNull().default(0),
    lastParticipatedAt: timestamp("last_participated_at", { withTimezone: true }),
    lastAutonomousStartedAt: timestamp("last_autonomous_started_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    roomAgentUq: uniqueIndex("company_chat_participation_room_agent_uq").on(table.roomId, table.agentId),
    roomLastParticipatedIdx: index("company_chat_participation_room_last_participated_idx").on(
      table.roomId,
      table.lastParticipatedAt,
    ),
  }),
);
