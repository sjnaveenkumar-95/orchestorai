ALTER TABLE "company_chat_threads" ADD COLUMN "follow_on_due_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "company_chat_threads" ADD COLUMN "follow_on_generation" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX "company_chat_threads_follow_on_due_idx" ON "company_chat_threads" USING btree ("status","follow_on_due_at");