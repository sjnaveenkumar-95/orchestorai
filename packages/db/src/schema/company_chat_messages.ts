import { boolean, index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { agents } from "./agents.js";
import { authUsers } from "./auth.js";
import { companies } from "./companies.js";
import { companyChatRooms } from "./company_chat_rooms.js";
import { companyChatThreads } from "./company_chat_threads.js";

export const companyChatMessages = pgTable(
  "company_chat_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    roomId: uuid("room_id").notNull().references(() => companyChatRooms.id, { onDelete: "cascade" }),
    threadId: uuid("thread_id").notNull().references(() => companyChatThreads.id, { onDelete: "cascade" }),
    authorType: text("author_type").notNull(),
    authorAgentId: uuid("author_agent_id").references(() => agents.id, { onDelete: "set null" }),
    authorUserId: text("author_user_id").references(() => authUsers.id, { onDelete: "set null" }),
    source: text("source").notNull().default("api"),
    slackChannelId: text("slack_channel_id"),
    slackMessageTs: text("slack_message_ts"),
    text: text("text").notNull(),
    internetBacked: boolean("internet_backed").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    threadCreatedIdx: index("company_chat_messages_thread_created_idx").on(table.threadId, table.createdAt),
    slackMessageUq: uniqueIndex("company_chat_messages_slack_message_uq").on(table.threadId, table.slackMessageTs),
  }),
);
