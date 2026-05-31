CREATE TYPE "public"."ai_agent_skill_curation_action" AS ENUM('promote', 'retire');--> statement-breakpoint
CREATE TYPE "public"."ai_agent_skill_curation_status" AS ENUM('applied', 'skipped', 'rejected');--> statement-breakpoint

CREATE TABLE "ai_agent_skill_curations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "curator_agent_id" uuid NOT NULL,
  "action" "ai_agent_skill_curation_action" NOT NULL,
  "status" "ai_agent_skill_curation_status" NOT NULL,
  "skill_id" uuid NOT NULL,
  "result_skill_id" uuid,
  "confidence" "ai_agent_candidate_confidence" NOT NULL,
  "reason" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

ALTER TABLE "ai_agent_skill_curations" ADD CONSTRAINT "ai_agent_skill_curations_curator_agent_id_ai_agents_id_fk" FOREIGN KEY ("curator_agent_id") REFERENCES "public"."ai_agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_agent_skill_curations" ADD CONSTRAINT "ai_agent_skill_curations_skill_id_ai_agent_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."ai_agent_skills"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_agent_skill_curations" ADD CONSTRAINT "ai_agent_skill_curations_result_skill_id_ai_agent_skills_id_fk" FOREIGN KEY ("result_skill_id") REFERENCES "public"."ai_agent_skills"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_agent_skill_curations_curator_created_at_idx" ON "ai_agent_skill_curations" USING btree ("curator_agent_id","created_at");--> statement-breakpoint
CREATE INDEX "ai_agent_skill_curations_skill_idx" ON "ai_agent_skill_curations" USING btree ("skill_id");
