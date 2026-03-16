import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { agents } from "./agents.js";
import { authUsers } from "./auth.js";
import { companies } from "./companies.js";
import { companyChatMessages } from "./company_chat_messages.js";
import { companyChatRooms } from "./company_chat_rooms.js";
import { companyChatThreads } from "./company_chat_threads.js";

export const companyChatReactions = pgTable(
  "company_chat_reactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    roomId: uuid("room_id").notNull().references(() => companyChatRooms.id, { onDelete: "cascade" }),
    threadId: uuid("thread_id").notNull().references(() => companyChatThreads.id, { onDelete: "cascade" }),
    messageId: uuid("message_id").notNull().references(() => companyChatMessages.id, { onDelete: "cascade" }),
    authorType: text("author_type").notNull(),
    authorAgentId: uuid("author_agent_id").references(() => agents.id, { onDelete: "set null" }),
    authorUserId: text("author_user_id").references(() => authUsers.id, { onDelete: "set null" }),
    source: text("source").notNull().default("api"),
    slackChannelId: text("slack_channel_id"),
    slackMessageTs: text("slack_message_ts"),
    emoji: text("emoji").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    messageCreatedIdx: index("company_chat_reactions_message_created_idx").on(table.messageId, table.createdAt),
    threadCreatedIdx: index("company_chat_reactions_thread_created_idx").on(table.threadId, table.createdAt),
  }),
);
