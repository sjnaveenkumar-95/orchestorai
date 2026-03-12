CREATE TABLE "host_command_allowlist_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"binary" text NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_from_approval_id" uuid,
	"revoked_at" timestamp with time zone,
	"revoked_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "host_command_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"issue_id" uuid NOT NULL,
	"project_id" uuid,
	"requested_by_agent_id" uuid NOT NULL,
	"approval_id" uuid,
	"status" text DEFAULT 'pending_approval' NOT NULL,
	"binary" text NOT NULL,
	"args" jsonb NOT NULL,
	"cwd" text NOT NULL,
	"reason" text NOT NULL,
	"missing_command" text,
	"local_error_excerpt" text,
	"exit_code" integer,
	"stdout_excerpt" text,
	"stderr_excerpt" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"log_store" text,
	"log_ref" text,
	"log_bytes" integer,
	"log_sha256" text,
	"log_compressed" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "slack_approval_thread_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"approval_id" uuid NOT NULL,
	"project_id" uuid,
	"project_slack_channel_id" uuid,
	"channel_id" text NOT NULL,
	"thread_ts" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "host_command_allowlist_entries" ADD CONSTRAINT "host_command_allowlist_entries_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "host_command_allowlist_entries" ADD CONSTRAINT "host_command_allowlist_entries_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "host_command_allowlist_entries" ADD CONSTRAINT "host_command_allowlist_entries_created_from_approval_id_approvals_id_fk" FOREIGN KEY ("created_from_approval_id") REFERENCES "public"."approvals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "host_command_requests" ADD CONSTRAINT "host_command_requests_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "host_command_requests" ADD CONSTRAINT "host_command_requests_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "host_command_requests" ADD CONSTRAINT "host_command_requests_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "host_command_requests" ADD CONSTRAINT "host_command_requests_requested_by_agent_id_agents_id_fk" FOREIGN KEY ("requested_by_agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "host_command_requests" ADD CONSTRAINT "host_command_requests_approval_id_approvals_id_fk" FOREIGN KEY ("approval_id") REFERENCES "public"."approvals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slack_approval_thread_links" ADD CONSTRAINT "slack_approval_thread_links_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slack_approval_thread_links" ADD CONSTRAINT "slack_approval_thread_links_approval_id_approvals_id_fk" FOREIGN KEY ("approval_id") REFERENCES "public"."approvals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slack_approval_thread_links" ADD CONSTRAINT "slack_approval_thread_links_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slack_approval_thread_links" ADD CONSTRAINT "slack_approval_thread_links_project_slack_channel_id_project_slack_channels_id_fk" FOREIGN KEY ("project_slack_channel_id") REFERENCES "public"."project_slack_channels"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "host_command_allowlist_entries_project_binary_uq" ON "host_command_allowlist_entries" USING btree ("project_id","binary");--> statement-breakpoint
CREATE INDEX "host_command_allowlist_entries_company_project_idx" ON "host_command_allowlist_entries" USING btree ("company_id","project_id");--> statement-breakpoint
CREATE INDEX "host_command_requests_company_status_created_idx" ON "host_command_requests" USING btree ("company_id","status","created_at");--> statement-breakpoint
CREATE INDEX "host_command_requests_issue_idx" ON "host_command_requests" USING btree ("issue_id");--> statement-breakpoint
CREATE INDEX "host_command_requests_approval_idx" ON "host_command_requests" USING btree ("approval_id");--> statement-breakpoint
CREATE INDEX "host_command_requests_requested_by_agent_idx" ON "host_command_requests" USING btree ("requested_by_agent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "slack_approval_thread_links_approval_uq" ON "slack_approval_thread_links" USING btree ("approval_id");--> statement-breakpoint
CREATE UNIQUE INDEX "slack_approval_thread_links_channel_thread_uq" ON "slack_approval_thread_links" USING btree ("channel_id","thread_ts");--> statement-breakpoint
CREATE INDEX "slack_approval_thread_links_company_idx" ON "slack_approval_thread_links" USING btree ("company_id");