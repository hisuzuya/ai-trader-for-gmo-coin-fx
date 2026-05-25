CREATE TYPE "public"."job_control_status" AS ENUM('queued', 'running', 'succeeded', 'failed', 'skipped');--> statement-breakpoint
CREATE TABLE "job_control" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_name" text NOT NULL,
	"target_key" text NOT NULL,
	"scheduled_for" timestamp with time zone NOT NULL,
	"status" "job_control_status" DEFAULT 'queued' NOT NULL,
	"locked_by" text,
	"locked_until" timestamp with time zone,
	"attempt" numeric(10, 0) DEFAULT '0' NOT NULL,
	"max_attempts" numeric(10, 0) DEFAULT '3' NOT NULL,
	"checkpoint_json" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "features_symbol_timeframe_opened_at_version_idx";--> statement-breakpoint
ALTER TABLE "features" ADD COLUMN "price_type" "candle_price_type" DEFAULT 'mid' NOT NULL;--> statement-breakpoint
ALTER TABLE "features" ADD COLUMN "input_source_version" text DEFAULT 'phase0' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "job_control_job_target_scheduled_for_idx" ON "job_control" USING btree ("job_name","target_key","scheduled_for");--> statement-breakpoint
CREATE INDEX "job_control_status_locked_until_idx" ON "job_control" USING btree ("status","locked_until");--> statement-breakpoint
CREATE UNIQUE INDEX "features_symbol_timeframe_price_type_opened_at_versions_idx" ON "features" USING btree ("symbol","timeframe","price_type","opened_at","feature_set_version","input_source_version");