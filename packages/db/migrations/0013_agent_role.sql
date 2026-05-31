ALTER TABLE "ai_agents" ADD COLUMN "role" text DEFAULT 'trader' NOT NULL;--> statement-breakpoint

-- Backfill role from the seeded character ids so existing crew rows pick up
-- their specialised role instead of the generic "trader" default.
UPDATE "ai_agents" SET "role" = 'skill_curator' WHERE "character_id" = 'ceres';--> statement-breakpoint
UPDATE "ai_agents" SET "role" = 'risk_auditor' WHERE "character_id" = 'iris';--> statement-breakpoint
UPDATE "ai_agents" SET "role" = 'news_analyst' WHERE "character_id" = 'chloe';
