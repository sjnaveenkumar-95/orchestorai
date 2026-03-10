CREATE TABLE "slack_action_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"project_id" uuid,
	"issue_id" uuid,
	"event_id" text,
	"channel_id" text NOT NULL,
	"thread_ts" text NOT NULL,
	"message_ts" text NOT NULL,
	"slack_user_id" text,
	"slack_user_name" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"action_type" text,
	"confidence" text,
	"request_text" text NOT NULL,
	"normalized_text" text NOT NULL,
	"interpreter_result" jsonb,
	"execution_result" jsonb,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "slack_action_runs" ADD CONSTRAINT "slack_action_runs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slack_action_runs" ADD CONSTRAINT "slack_action_runs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slack_action_runs" ADD CONSTRAINT "slack_action_runs_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "slack_action_runs_company_created_idx" ON "slack_action_runs" USING btree ("company_id","created_at");--> statement-breakpoint
CREATE INDEX "slack_action_runs_company_project_idx" ON "slack_action_runs" USING btree ("company_id","project_id");--> statement-breakpoint
CREATE INDEX "slack_action_runs_company_issue_idx" ON "slack_action_runs" USING btree ("company_id","issue_id");--> statement-breakpoint
CREATE INDEX "slack_action_runs_channel_thread_idx" ON "slack_action_runs" USING btree ("channel_id","thread_ts");--> statement-breakpoint
CREATE INDEX "slack_action_runs_event_idx" ON "slack_action_runs" USING btree ("event_id");