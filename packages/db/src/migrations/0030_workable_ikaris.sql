ALTER TABLE "projects" ADD COLUMN "issue_prefix" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "issue_counter" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "projects_issue_prefix_idx" ON "projects" USING btree ("issue_prefix");