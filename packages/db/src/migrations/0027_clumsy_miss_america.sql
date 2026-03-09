CREATE TABLE "agent_slack_apps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"slack_app_id" text,
	"client_id" text,
	"bot_user_id" text,
	"team_id" text,
	"install_status" text DEFAULT 'not_configured' NOT NULL,
	"install_url" text,
	"oauth_state" text,
	"client_secret_secret_id" uuid,
	"bot_token_secret_id" uuid,
	"signing_secret_secret_id" uuid,
	"last_error" text,
	"disabled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"created_by_agent_id" uuid,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_slack_channels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"channel_id" text,
	"channel_name" text,
	"visibility" text DEFAULT 'public' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"last_error" text,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_slack_memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"project_slack_channel_id" uuid,
	"agent_id" uuid NOT NULL,
	"agent_slack_app_id" uuid,
	"sync_status" text DEFAULT 'pending' NOT NULL,
	"last_error" text,
	"synced_at" timestamp with time zone,
	"removed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "slack_thread_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"issue_id" uuid NOT NULL,
	"project_id" uuid,
	"project_slack_channel_id" uuid,
	"channel_id" text NOT NULL,
	"thread_ts" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "slack_channel_visibility" text DEFAULT 'public' NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_slack_apps" ADD CONSTRAINT "agent_slack_apps_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_slack_apps" ADD CONSTRAINT "agent_slack_apps_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_slack_apps" ADD CONSTRAINT "agent_slack_apps_client_secret_secret_id_company_secrets_id_fk" FOREIGN KEY ("client_secret_secret_id") REFERENCES "public"."company_secrets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_slack_apps" ADD CONSTRAINT "agent_slack_apps_bot_token_secret_id_company_secrets_id_fk" FOREIGN KEY ("bot_token_secret_id") REFERENCES "public"."company_secrets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_slack_apps" ADD CONSTRAINT "agent_slack_apps_signing_secret_secret_id_company_secrets_id_fk" FOREIGN KEY ("signing_secret_secret_id") REFERENCES "public"."company_secrets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_created_by_agent_id_agents_id_fk" FOREIGN KEY ("created_by_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_slack_channels" ADD CONSTRAINT "project_slack_channels_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_slack_channels" ADD CONSTRAINT "project_slack_channels_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_slack_memberships" ADD CONSTRAINT "project_slack_memberships_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_slack_memberships" ADD CONSTRAINT "project_slack_memberships_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_slack_memberships" ADD CONSTRAINT "project_slack_memberships_project_slack_channel_id_project_slack_channels_id_fk" FOREIGN KEY ("project_slack_channel_id") REFERENCES "public"."project_slack_channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_slack_memberships" ADD CONSTRAINT "project_slack_memberships_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_slack_memberships" ADD CONSTRAINT "project_slack_memberships_agent_slack_app_id_agent_slack_apps_id_fk" FOREIGN KEY ("agent_slack_app_id") REFERENCES "public"."agent_slack_apps"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slack_thread_links" ADD CONSTRAINT "slack_thread_links_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slack_thread_links" ADD CONSTRAINT "slack_thread_links_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slack_thread_links" ADD CONSTRAINT "slack_thread_links_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slack_thread_links" ADD CONSTRAINT "slack_thread_links_project_slack_channel_id_project_slack_channels_id_fk" FOREIGN KEY ("project_slack_channel_id") REFERENCES "public"."project_slack_channels"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_slack_apps_company_agent_idx" ON "agent_slack_apps" USING btree ("company_id","agent_id");--> statement-breakpoint
CREATE INDEX "agent_slack_apps_install_status_idx" ON "agent_slack_apps" USING btree ("install_status");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_slack_apps_agent_uq" ON "agent_slack_apps" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "project_members_company_project_idx" ON "project_members" USING btree ("company_id","project_id");--> statement-breakpoint
CREATE INDEX "project_members_company_agent_idx" ON "project_members" USING btree ("company_id","agent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "project_members_project_agent_uq" ON "project_members" USING btree ("project_id","agent_id");--> statement-breakpoint
CREATE INDEX "project_slack_channels_company_project_idx" ON "project_slack_channels" USING btree ("company_id","project_id");--> statement-breakpoint
CREATE INDEX "project_slack_channels_status_idx" ON "project_slack_channels" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "project_slack_channels_project_uq" ON "project_slack_channels" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "project_slack_channels_channel_id_uq" ON "project_slack_channels" USING btree ("channel_id");--> statement-breakpoint
CREATE INDEX "project_slack_memberships_company_project_idx" ON "project_slack_memberships" USING btree ("company_id","project_id");--> statement-breakpoint
CREATE INDEX "project_slack_memberships_company_agent_idx" ON "project_slack_memberships" USING btree ("company_id","agent_id");--> statement-breakpoint
CREATE INDEX "project_slack_memberships_sync_status_idx" ON "project_slack_memberships" USING btree ("sync_status");--> statement-breakpoint
CREATE UNIQUE INDEX "project_slack_memberships_project_agent_uq" ON "project_slack_memberships" USING btree ("project_id","agent_id");--> statement-breakpoint
CREATE INDEX "slack_thread_links_company_issue_idx" ON "slack_thread_links" USING btree ("company_id","issue_id");--> statement-breakpoint
CREATE INDEX "slack_thread_links_channel_thread_idx" ON "slack_thread_links" USING btree ("channel_id","thread_ts");