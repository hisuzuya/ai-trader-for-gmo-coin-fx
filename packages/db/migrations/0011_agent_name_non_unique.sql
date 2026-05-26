-- Allow multiple agents to share the same name (e.g., multiple agents from the same character).
-- The previous uniqueIndex prevented "ユラ — USDJPY" being used for >1 agent.
DROP INDEX IF EXISTS "ai_agents_name_idx";--> statement-breakpoint
CREATE INDEX "ai_agents_name_idx" ON "ai_agents" USING btree ("name");
