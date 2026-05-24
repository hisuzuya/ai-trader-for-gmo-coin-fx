CREATE TYPE "public"."ai_invocation_status" AS ENUM('succeeded', 'failed', 'timeout');--> statement-breakpoint
CREATE TYPE "public"."ai_tuning_proposal_status" AS ENUM('accepted', 'rejected', 'failed');--> statement-breakpoint
CREATE TABLE "ai_invocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"purpose" text NOT NULL,
	"prompt_hash" text NOT NULL,
	"prompt_redacted" text NOT NULL,
	"stdout_raw" text,
	"stderr_summary" text,
	"parsed_json" jsonb,
	"status" "ai_invocation_status" NOT NULL,
	"timeout_ms" numeric(18, 0) NOT NULL,
	"cli_version" text,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone NOT NULL,
	"error_summary" text
);
--> statement-breakpoint
CREATE TABLE "ai_tuning_proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invocation_id" uuid,
	"source_strategy_name" text NOT NULL,
	"candidate_strategy_name" text,
	"symbol" text NOT NULL,
	"timeframe" text NOT NULL,
	"status" "ai_tuning_proposal_status" NOT NULL,
	"rationale" text,
	"strategy_definition_json" jsonb,
	"reject_reasons_json" jsonb,
	"inserted_into_paper" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_tuning_proposals" ADD CONSTRAINT "ai_tuning_proposals_invocation_id_ai_invocations_id_fk" FOREIGN KEY ("invocation_id") REFERENCES "public"."ai_invocations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_invocations_started_at_idx" ON "ai_invocations" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "ai_tuning_proposals_created_at_idx" ON "ai_tuning_proposals" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "ai_tuning_proposals_status_idx" ON "ai_tuning_proposals" USING btree ("status");