-- Align the seeded crew cadence with the role split:
-- traders and the news analyst run hourly, the skill curator runs twice daily,
-- and the risk auditor is manual/event-driven by default.
UPDATE "ai_agents"
SET "run_interval_sec" = 43200, "status" = 'active', "paused_reason" = NULL
WHERE "id" = 'c0000000-0000-4000-8000-000000000001';--> statement-breakpoint

UPDATE "ai_agents"
SET "run_interval_sec" = 3600, "status" = 'active', "paused_reason" = NULL
WHERE "id" = 'c0000000-0000-4000-8000-000000000002';--> statement-breakpoint

UPDATE "ai_agents"
SET "run_interval_sec" = 3600, "status" = 'active', "paused_reason" = NULL
WHERE "id" = 'c0000000-0000-4000-8000-000000000003';--> statement-breakpoint

UPDATE "ai_agents"
SET
  "run_interval_sec" = 86400,
  "status" = 'paused',
  "paused_reason" = 'Default crew cadence: run manually or by risk event.'
WHERE "id" = 'c0000000-0000-4000-8000-000000000004';--> statement-breakpoint

UPDATE "ai_agents"
SET "run_interval_sec" = 3600, "status" = 'active', "paused_reason" = NULL
WHERE "id" = 'c0000000-0000-4000-8000-000000000005';--> statement-breakpoint

UPDATE "ai_agents"
SET "run_interval_sec" = 3600, "status" = 'active', "paused_reason" = NULL
WHERE "id" = 'c0000000-0000-4000-8000-000000000006';--> statement-breakpoint

-- Remove the two retired legacy research seeds so the canonical seeded crew is
-- the six character agents only.
UPDATE "strategy_runs"
SET "source_agent_id" = NULL, "source_proposal_id" = NULL
WHERE
  "source_agent_id" IN (
    '11111111-1111-4111-8111-111111111111',
    '33333333-3333-4333-8333-333333333333'
  )
  OR "source_proposal_id" IN (
    SELECT "id"
    FROM "ai_agent_strategy_proposals"
    WHERE "agent_id" IN (
      '11111111-1111-4111-8111-111111111111',
      '33333333-3333-4333-8333-333333333333'
    )
  );--> statement-breakpoint

UPDATE "paper_accounts"
SET "agent_id" = NULL
WHERE "agent_id" IN (
  '11111111-1111-4111-8111-111111111111',
  '33333333-3333-4333-8333-333333333333'
);--> statement-breakpoint

DELETE FROM "ai_agent_skill_curations"
WHERE
  "curator_agent_id" IN (
    '11111111-1111-4111-8111-111111111111',
    '33333333-3333-4333-8333-333333333333'
  )
  OR "skill_id" IN (
    SELECT "id"
    FROM "ai_agent_skills"
    WHERE "agent_id" IN (
      '11111111-1111-4111-8111-111111111111',
      '33333333-3333-4333-8333-333333333333'
    )
  )
  OR "result_skill_id" IN (
    SELECT "id"
    FROM "ai_agent_skills"
    WHERE "agent_id" IN (
      '11111111-1111-4111-8111-111111111111',
      '33333333-3333-4333-8333-333333333333'
    )
  );--> statement-breakpoint

DELETE FROM "ai_agent_prompt_optimizations"
WHERE "agent_id" IN (
  '11111111-1111-4111-8111-111111111111',
  '33333333-3333-4333-8333-333333333333'
);--> statement-breakpoint

DELETE FROM "ai_agent_memories"
WHERE "agent_id" IN (
  '11111111-1111-4111-8111-111111111111',
  '33333333-3333-4333-8333-333333333333'
);--> statement-breakpoint

DELETE FROM "ai_agent_candidate_reviews"
WHERE "agent_id" IN (
  '11111111-1111-4111-8111-111111111111',
  '33333333-3333-4333-8333-333333333333'
);--> statement-breakpoint

DELETE FROM "ai_agent_observations"
WHERE "agent_id" IN (
  '11111111-1111-4111-8111-111111111111',
  '33333333-3333-4333-8333-333333333333'
);--> statement-breakpoint

DELETE FROM "ai_agent_strategy_proposals"
WHERE "agent_id" IN (
  '11111111-1111-4111-8111-111111111111',
  '33333333-3333-4333-8333-333333333333'
);--> statement-breakpoint

UPDATE "ai_agent_skills"
SET "created_run_id" = NULL
WHERE "created_run_id" IN (
  SELECT "id"
  FROM "ai_agent_runs"
  WHERE "agent_id" IN (
    '11111111-1111-4111-8111-111111111111',
    '33333333-3333-4333-8333-333333333333'
  )
);--> statement-breakpoint

DELETE FROM "ai_agent_skills"
WHERE "agent_id" IN (
  '11111111-1111-4111-8111-111111111111',
  '33333333-3333-4333-8333-333333333333'
);--> statement-breakpoint

DELETE FROM "ai_agent_runs"
WHERE "agent_id" IN (
  '11111111-1111-4111-8111-111111111111',
  '33333333-3333-4333-8333-333333333333'
);--> statement-breakpoint

DELETE FROM "ai_agent_versions"
WHERE "agent_id" IN (
  '11111111-1111-4111-8111-111111111111',
  '33333333-3333-4333-8333-333333333333'
);--> statement-breakpoint

DELETE FROM "ai_agents"
WHERE "id" IN (
  '11111111-1111-4111-8111-111111111111',
  '33333333-3333-4333-8333-333333333333'
);
