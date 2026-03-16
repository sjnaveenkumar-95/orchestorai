CREATE TABLE "company_chat_reactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"room_id" uuid NOT NULL,
	"thread_id" uuid NOT NULL,
	"message_id" uuid NOT NULL,
	"author_type" text NOT NULL,
	"author_agent_id" uuid,
	"author_user_id" text,
	"source" text DEFAULT 'api' NOT NULL,
	"slack_channel_id" text,
	"slack_message_ts" text,
	"emoji" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "company_chat_reactions" ADD CONSTRAINT "company_chat_reactions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_chat_reactions" ADD CONSTRAINT "company_chat_reactions_room_id_company_chat_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."company_chat_rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_chat_reactions" ADD CONSTRAINT "company_chat_reactions_thread_id_company_chat_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."company_chat_threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_chat_reactions" ADD CONSTRAINT "company_chat_reactions_message_id_company_chat_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."company_chat_messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_chat_reactions" ADD CONSTRAINT "company_chat_reactions_author_agent_id_agents_id_fk" FOREIGN KEY ("author_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_chat_reactions" ADD CONSTRAINT "company_chat_reactions_author_user_id_user_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "company_chat_reactions_message_created_idx" ON "company_chat_reactions" USING btree ("message_id","created_at");--> statement-breakpoint
CREATE INDEX "company_chat_reactions_thread_created_idx" ON "company_chat_reactions" USING btree ("thread_id","created_at");