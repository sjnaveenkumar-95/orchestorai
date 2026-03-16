CREATE TABLE "company_chat_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"room_id" uuid NOT NULL,
	"thread_id" uuid NOT NULL,
	"author_type" text NOT NULL,
	"author_agent_id" uuid,
	"author_user_id" text,
	"source" text DEFAULT 'api' NOT NULL,
	"slack_channel_id" text,
	"slack_message_ts" text,
	"text" text NOT NULL,
	"internet_backed" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "company_chat_participation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"room_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"message_count" integer DEFAULT 0 NOT NULL,
	"autonomous_starts_count" integer DEFAULT 0 NOT NULL,
	"last_participated_at" timestamp with time zone,
	"last_autonomous_started_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "company_chat_rooms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"display_name" text NOT NULL,
	"slack_channel_id" text,
	"slack_channel_name" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"idle_threshold_hours" integer DEFAULT 3 NOT NULL,
	"max_autonomous_threads" integer DEFAULT 3 NOT NULL,
	"autonomous_start_enabled" boolean DEFAULT true NOT NULL,
	"allowed_topics" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"chat_budget_monthly_cents" integer DEFAULT 0 NOT NULL,
	"chat_spent_monthly_cents" integer DEFAULT 0 NOT NULL,
	"prompt_pack_dir" text,
	"prompt_system_path" text,
	"prompt_agents_path" text,
	"prompt_soul_path" text,
	"last_room_activity_at" timestamp with time zone,
	"last_error" text,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "company_chat_threads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"room_id" uuid NOT NULL,
	"topic" text,
	"origin" text NOT NULL,
	"autonomous" boolean DEFAULT false NOT NULL,
	"initiated_by_agent_id" uuid,
	"initiated_by_user_id" text,
	"slack_channel_id" text,
	"slack_thread_ts" text,
	"status" text DEFAULT 'active' NOT NULL,
	"completion_assessment" text DEFAULT 'unclear' NOT NULL,
	"last_activity_at" timestamp with time zone DEFAULT now() NOT NULL,
	"message_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "company_chat_messages" ADD CONSTRAINT "company_chat_messages_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_chat_messages" ADD CONSTRAINT "company_chat_messages_room_id_company_chat_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."company_chat_rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_chat_messages" ADD CONSTRAINT "company_chat_messages_thread_id_company_chat_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."company_chat_threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_chat_messages" ADD CONSTRAINT "company_chat_messages_author_agent_id_agents_id_fk" FOREIGN KEY ("author_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_chat_messages" ADD CONSTRAINT "company_chat_messages_author_user_id_user_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_chat_participation" ADD CONSTRAINT "company_chat_participation_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_chat_participation" ADD CONSTRAINT "company_chat_participation_room_id_company_chat_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."company_chat_rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_chat_participation" ADD CONSTRAINT "company_chat_participation_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_chat_rooms" ADD CONSTRAINT "company_chat_rooms_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_chat_threads" ADD CONSTRAINT "company_chat_threads_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_chat_threads" ADD CONSTRAINT "company_chat_threads_room_id_company_chat_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."company_chat_rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_chat_threads" ADD CONSTRAINT "company_chat_threads_initiated_by_agent_id_agents_id_fk" FOREIGN KEY ("initiated_by_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_chat_threads" ADD CONSTRAINT "company_chat_threads_initiated_by_user_id_user_id_fk" FOREIGN KEY ("initiated_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "company_chat_messages_thread_created_idx" ON "company_chat_messages" USING btree ("thread_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "company_chat_messages_slack_message_uq" ON "company_chat_messages" USING btree ("thread_id","slack_message_ts");--> statement-breakpoint
CREATE UNIQUE INDEX "company_chat_participation_room_agent_uq" ON "company_chat_participation" USING btree ("room_id","agent_id");--> statement-breakpoint
CREATE INDEX "company_chat_participation_room_last_participated_idx" ON "company_chat_participation" USING btree ("room_id","last_participated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "company_chat_rooms_company_uq" ON "company_chat_rooms" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX "company_chat_rooms_channel_id_uq" ON "company_chat_rooms" USING btree ("slack_channel_id");--> statement-breakpoint
CREATE INDEX "company_chat_rooms_company_status_idx" ON "company_chat_rooms" USING btree ("company_id","status");--> statement-breakpoint
CREATE INDEX "company_chat_threads_room_status_idx" ON "company_chat_threads" USING btree ("room_id","status","last_activity_at");--> statement-breakpoint
CREATE INDEX "company_chat_threads_room_autonomous_idx" ON "company_chat_threads" USING btree ("room_id","autonomous","status");--> statement-breakpoint
CREATE UNIQUE INDEX "company_chat_threads_slack_thread_uq" ON "company_chat_threads" USING btree ("room_id","slack_thread_ts");