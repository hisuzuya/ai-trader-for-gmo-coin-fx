CREATE TYPE "public"."ai_agent_candidate_confidence" AS ENUM('low', 'medium', 'high');--> statement-breakpoint
CREATE TYPE "public"."ai_agent_candidate_recommendation" AS ENUM('continue', 'retire', 'promote');--> statement-breakpoint
CREATE TYPE "public"."ai_agent_memory_type" AS ENUM('market_observation', 'strategy_hypothesis', 'proposal_review', 'rejection_learning');--> statement-breakpoint
CREATE TYPE "public"."ai_agent_observation_kind" AS ENUM('market', 'candidate_performance', 'risk', 'operations');--> statement-breakpoint
CREATE TYPE "public"."ai_agent_proposal_validation_status" AS ENUM('accepted', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."ai_agent_run_status" AS ENUM('succeeded', 'failed', 'timeout', 'rejected_output');--> statement-breakpoint
CREATE TYPE "public"."ai_agent_status" AS ENUM('active', 'paused');--> statement-breakpoint
CREATE TABLE "ai_agent_candidate_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"strategy_name" text NOT NULL,
	"recommendation" "ai_agent_candidate_recommendation" NOT NULL,
	"confidence" "ai_agent_candidate_confidence" NOT NULL,
	"reason" text NOT NULL,
	"evidence_json" jsonb NOT NULL,
	"applied" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_agent_memories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"type" "ai_agent_memory_type" NOT NULL,
	"content" text NOT NULL,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"source_refs_json" jsonb,
	"search_vector" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_agent_observations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"kind" "ai_agent_observation_kind" NOT NULL,
	"summary" text NOT NULL,
	"evidence_json" jsonb NOT NULL,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_agent_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"agent_version" numeric(10, 0) NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"status" "ai_agent_run_status" NOT NULL,
	"input_summary_json" jsonb,
	"output_summary_json" jsonb,
	"tool_calls_json" jsonb,
	"token_usage_json" jsonb,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "ai_agent_strategy_proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"strategy_name" text NOT NULL,
	"proposal_json" jsonb NOT NULL,
	"validation_status" "ai_agent_proposal_validation_status" NOT NULL,
	"rejection_reasons_json" jsonb,
	"inserted_strategy_run_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_agent_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"version" numeric(10, 0) NOT NULL,
	"system_prompt" text NOT NULL,
	"allowed_tools_json" jsonb NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_agents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"persona" text NOT NULL,
	"system_prompt" text NOT NULL,
	"allowed_tools_json" jsonb NOT NULL,
	"status" "ai_agent_status" DEFAULT 'active' NOT NULL,
	"current_version" numeric(10, 0) DEFAULT '1' NOT NULL,
	"run_interval_sec" numeric(10, 0) NOT NULL,
	"model" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "strategy_runs" ADD COLUMN "source_agent_id" uuid;--> statement-breakpoint
ALTER TABLE "strategy_runs" ADD COLUMN "source_proposal_id" uuid;--> statement-breakpoint
ALTER TABLE "ai_agent_candidate_reviews" ADD CONSTRAINT "ai_agent_candidate_reviews_run_id_ai_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."ai_agent_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_agent_candidate_reviews" ADD CONSTRAINT "ai_agent_candidate_reviews_agent_id_ai_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."ai_agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_agent_memories" ADD CONSTRAINT "ai_agent_memories_agent_id_ai_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."ai_agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_agent_observations" ADD CONSTRAINT "ai_agent_observations_run_id_ai_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."ai_agent_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_agent_observations" ADD CONSTRAINT "ai_agent_observations_agent_id_ai_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."ai_agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_agent_runs" ADD CONSTRAINT "ai_agent_runs_agent_id_ai_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."ai_agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_agent_strategy_proposals" ADD CONSTRAINT "ai_agent_strategy_proposals_run_id_ai_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."ai_agent_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_agent_strategy_proposals" ADD CONSTRAINT "ai_agent_strategy_proposals_agent_id_ai_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."ai_agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_agent_versions" ADD CONSTRAINT "ai_agent_versions_agent_id_ai_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."ai_agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_agent_candidate_reviews_agent_created_at_idx" ON "ai_agent_candidate_reviews" USING btree ("agent_id","created_at");--> statement-breakpoint
CREATE INDEX "ai_agent_memories_agent_idx" ON "ai_agent_memories" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "ai_agent_memories_agent_type_idx" ON "ai_agent_memories" USING btree ("agent_id","type");--> statement-breakpoint
CREATE INDEX "ai_agent_memories_tags_idx" ON "ai_agent_memories" USING gin ("tags");--> statement-breakpoint
CREATE INDEX "ai_agent_runs_agent_started_at_idx" ON "ai_agent_runs" USING btree ("agent_id","started_at");--> statement-breakpoint
CREATE INDEX "ai_agent_strategy_proposals_agent_created_at_idx" ON "ai_agent_strategy_proposals" USING btree ("agent_id","created_at");--> statement-breakpoint
CREATE INDEX "ai_agent_strategy_proposals_validation_idx" ON "ai_agent_strategy_proposals" USING btree ("validation_status");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_agent_versions_agent_version_idx" ON "ai_agent_versions" USING btree ("agent_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_agents_name_idx" ON "ai_agents" USING btree ("name");--> statement-breakpoint
ALTER TABLE "strategy_runs" ADD CONSTRAINT "strategy_runs_source_agent_id_ai_agents_id_fk" FOREIGN KEY ("source_agent_id") REFERENCES "public"."ai_agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "strategy_runs" ADD CONSTRAINT "strategy_runs_source_proposal_id_ai_agent_strategy_proposals_id_fk" FOREIGN KEY ("source_proposal_id") REFERENCES "public"."ai_agent_strategy_proposals"("id") ON DELETE no action ON UPDATE no action;
