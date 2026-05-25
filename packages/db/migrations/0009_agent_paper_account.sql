-- 既存のペーパー口座データをリセット (開発中、FK 依存順で削除)
DELETE FROM "paper_trades";--> statement-breakpoint
DELETE FROM "paper_orders";--> statement-breakpoint
DELETE FROM "paper_positions";--> statement-breakpoint
DELETE FROM "paper_accounts";--> statement-breakpoint

-- ai_agents に initial_balance_jpy 追加
ALTER TABLE "ai_agents" ADD COLUMN "initial_balance_jpy" numeric(18, 6) DEFAULT '100000' NOT NULL;--> statement-breakpoint

-- paper_accounts に agent_id 追加 (1 エージェント = 1 専用口座)
ALTER TABLE "paper_accounts" ADD COLUMN "agent_id" uuid;--> statement-breakpoint
ALTER TABLE "paper_accounts" ADD CONSTRAINT "paper_accounts_agent_id_ai_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."ai_agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "paper_accounts_agent_id_idx" ON "paper_accounts" USING btree ("agent_id");--> statement-breakpoint

-- ポジション unique index を (account_id, strategy_run_id) ベースに緩和し、複数戦略の並行ポジションを許可
DROP INDEX IF EXISTS "paper_positions_one_open_position_per_account_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "paper_positions_one_open_position_per_strategy_run_idx" ON "paper_positions" USING btree ("account_id","strategy_run_id") WHERE "paper_positions"."status" = 'open';
