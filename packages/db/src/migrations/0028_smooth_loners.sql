CREATE TABLE "slack_event_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid,
	"event_id" text NOT NULL,
	"event_type" text,
	"api_app_id" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "slack_event_receipts" ADD CONSTRAINT "slack_event_receipts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "slack_event_receipts_company_idx" ON "slack_event_receipts" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "slack_event_receipts_api_app_idx" ON "slack_event_receipts" USING btree ("api_app_id");--> statement-breakpoint
CREATE UNIQUE INDEX "slack_event_receipts_event_id_uq" ON "slack_event_receipts" USING btree ("event_id");