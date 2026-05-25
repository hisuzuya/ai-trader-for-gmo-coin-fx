CREATE TYPE "public"."ai_agent_knowledge_scope" AS ENUM('private', 'shared');--> statement-breakpoint
CREATE TYPE "public"."ai_agent_knowledge_status" AS ENUM('draft', 'active', 'archived');--> statement-breakpoint

CREATE TABLE "ai_agent_skills" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "agent_id" uuid NOT NULL,
  "scope" "ai_agent_knowledge_scope" DEFAULT 'private' NOT NULL,
  "title" text NOT NULL,
  "body" text NOT NULL,
  "tags" text[] DEFAULT '{}'::text[] NOT NULL,
  "source_refs_json" jsonb,
  "reason" text NOT NULL,
  "status" "ai_agent_knowledge_status" DEFAULT 'active' NOT NULL,
  "version" numeric(10, 0) DEFAULT '1' NOT NULL,
  "promoted_from_skill_id" uuid,
  "created_run_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

ALTER TABLE "ai_agent_skills" ADD CONSTRAINT "ai_agent_skills_agent_id_ai_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."ai_agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_agent_skills" ADD CONSTRAINT "ai_agent_skills_created_run_id_ai_agent_runs_id_fk" FOREIGN KEY ("created_run_id") REFERENCES "public"."ai_agent_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_agent_skills_agent_idx" ON "ai_agent_skills" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "ai_agent_skills_scope_status_idx" ON "ai_agent_skills" USING btree ("scope","status");--> statement-breakpoint
CREATE INDEX "ai_agent_skills_tags_idx" ON "ai_agent_skills" USING gin ("tags");
