ALTER TABLE "ai_agents" ADD COLUMN "max_consecutive_failures" numeric(10, 0) DEFAULT '3' NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_agents" ADD COLUMN "consecutive_failures" numeric(10, 0) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_agents" ADD COLUMN "token_budget_per_run" numeric(10, 0) DEFAULT '200000' NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_agents" ADD COLUMN "cost_budget_per_run_usd" numeric(12, 6) DEFAULT '5' NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_agents" ADD COLUMN "paused_reason" text;--> statement-breakpoint
ALTER TABLE "ai_agents" ADD COLUMN "shared_memory_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX "ai_agent_memories_search_vector_fts_idx" ON "ai_agent_memories" USING gin (to_tsvector('simple', coalesce("search_vector", "content")));
