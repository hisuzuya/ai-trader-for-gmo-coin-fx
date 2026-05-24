CREATE TYPE "public"."ai_daily_review_status" AS ENUM('accepted', 'rejected', 'failed');--> statement-breakpoint
CREATE TABLE "ai_daily_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invocation_id" uuid,
	"review_date" text NOT NULL,
	"status" "ai_daily_review_status" NOT NULL,
	"summary" text,
	"baseline_promotion_candidates_json" jsonb,
	"candidate_retirement_candidates_json" jsonb,
	"warnings_json" jsonb,
	"next_actions_json" jsonb,
	"reject_reasons_json" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_daily_reviews" ADD CONSTRAINT "ai_daily_reviews_invocation_id_ai_invocations_id_fk" FOREIGN KEY ("invocation_id") REFERENCES "public"."ai_invocations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_daily_reviews_created_at_idx" ON "ai_daily_reviews" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "ai_daily_reviews_review_date_idx" ON "ai_daily_reviews" USING btree ("review_date");--> statement-breakpoint
CREATE INDEX "ai_daily_reviews_status_idx" ON "ai_daily_reviews" USING btree ("status");