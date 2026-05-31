CREATE TYPE "public"."ai_agent_prompt_optimization_status" AS ENUM('optimized', 'rolled_back', 'rejected', 'skipped');--> statement-breakpoint

CREATE TABLE "ai_agent_prompt_optimizations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "agent_id" uuid NOT NULL,
  "status" "ai_agent_prompt_optimization_status" NOT NULL,
  "from_version" numeric(10, 0) NOT NULL,
  "to_version" numeric(10, 0),
  "baseline_score" numeric(18, 6) NOT NULL,
  "observed_score" numeric(18, 6),
  "scorecard_json" jsonb NOT NULL,
  "reasoning" text NOT NULL,
  "prompt_hash" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

ALTER TABLE "ai_agent_prompt_optimizations" ADD CONSTRAINT "ai_agent_prompt_optimizations_agent_id_ai_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."ai_agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_agent_prompt_optimizations_agent_created_at_idx" ON "ai_agent_prompt_optimizations" USING btree ("agent_id","created_at");
