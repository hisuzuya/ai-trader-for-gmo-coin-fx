CREATE TYPE "public"."paper_account_status" AS ENUM('active', 'stopped');--> statement-breakpoint
CREATE TYPE "public"."paper_order_action" AS ENUM('entry', 'exit');--> statement-breakpoint
CREATE TYPE "public"."paper_order_side" AS ENUM('BUY', 'SELL');--> statement-breakpoint
CREATE TYPE "public"."paper_order_status" AS ENUM('filled', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."paper_position_side" AS ENUM('long', 'short');--> statement-breakpoint
CREATE TYPE "public"."paper_position_status" AS ENUM('open', 'closed');--> statement-breakpoint
CREATE TYPE "public"."strategy_run_status" AS ENUM('proposed', 'validated', 'running_paper', 'promoted_to_baseline', 'retired');--> statement-breakpoint
CREATE TABLE "paper_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"strategy_run_id" uuid,
	"name" text NOT NULL,
	"currency" text DEFAULT 'JPY' NOT NULL,
	"initial_balance_jpy" numeric(18, 6) NOT NULL,
	"balance_jpy" numeric(18, 6) NOT NULL,
	"leverage" numeric(10, 2) NOT NULL,
	"status" "paper_account_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "paper_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"strategy_run_id" uuid,
	"position_id" uuid,
	"symbol" text NOT NULL,
	"action" "paper_order_action" NOT NULL,
	"side" "paper_order_side" NOT NULL,
	"status" "paper_order_status" NOT NULL,
	"quantity" numeric(18, 6) NOT NULL,
	"requested_at" timestamp with time zone NOT NULL,
	"executed_at" timestamp with time zone,
	"execution_price" numeric(18, 6),
	"execution_reason" text NOT NULL,
	"spread_pips" numeric(10, 4) NOT NULL,
	"spread_source" text NOT NULL,
	"rejection_reason" text,
	"metadata_json" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "paper_positions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"strategy_run_id" uuid,
	"symbol" text NOT NULL,
	"side" "paper_position_side" NOT NULL,
	"status" "paper_position_status" DEFAULT 'open' NOT NULL,
	"quantity" numeric(18, 6) NOT NULL,
	"entry_price" numeric(18, 6) NOT NULL,
	"opened_at" timestamp with time zone NOT NULL,
	"closed_at" timestamp with time zone,
	"stop_loss_price" numeric(18, 6) NOT NULL,
	"take_profit_price" numeric(18, 6) NOT NULL,
	"trailing_stop_price" numeric(18, 6),
	"break_even_stop_price" numeric(18, 6),
	"best_price_since_open" numeric(18, 6) NOT NULL,
	"spread_pips" numeric(10, 4) NOT NULL,
	"spread_source" text NOT NULL,
	"realized_pnl_jpy" numeric(18, 6),
	"metadata_json" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "paper_trades" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"strategy_run_id" uuid,
	"position_id" uuid NOT NULL,
	"entry_order_id" uuid,
	"exit_order_id" uuid,
	"symbol" text NOT NULL,
	"side" "paper_position_side" NOT NULL,
	"quantity" numeric(18, 6) NOT NULL,
	"entry_price" numeric(18, 6) NOT NULL,
	"exit_price" numeric(18, 6) NOT NULL,
	"opened_at" timestamp with time zone NOT NULL,
	"closed_at" timestamp with time zone NOT NULL,
	"pnl_jpy" numeric(18, 6) NOT NULL,
	"close_reason" text NOT NULL,
	"metadata_json" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "strategy_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"strategy_name" text NOT NULL,
	"symbol" text NOT NULL,
	"timeframe" text NOT NULL,
	"status" "strategy_run_status" NOT NULL,
	"strategy_definition_json" jsonb NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"metadata_json" jsonb
);
--> statement-breakpoint
ALTER TABLE "paper_accounts" ADD CONSTRAINT "paper_accounts_strategy_run_id_strategy_runs_id_fk" FOREIGN KEY ("strategy_run_id") REFERENCES "public"."strategy_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paper_orders" ADD CONSTRAINT "paper_orders_account_id_paper_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."paper_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paper_orders" ADD CONSTRAINT "paper_orders_strategy_run_id_strategy_runs_id_fk" FOREIGN KEY ("strategy_run_id") REFERENCES "public"."strategy_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paper_orders" ADD CONSTRAINT "paper_orders_position_id_paper_positions_id_fk" FOREIGN KEY ("position_id") REFERENCES "public"."paper_positions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paper_positions" ADD CONSTRAINT "paper_positions_account_id_paper_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."paper_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paper_positions" ADD CONSTRAINT "paper_positions_strategy_run_id_strategy_runs_id_fk" FOREIGN KEY ("strategy_run_id") REFERENCES "public"."strategy_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paper_trades" ADD CONSTRAINT "paper_trades_account_id_paper_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."paper_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paper_trades" ADD CONSTRAINT "paper_trades_strategy_run_id_strategy_runs_id_fk" FOREIGN KEY ("strategy_run_id") REFERENCES "public"."strategy_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paper_trades" ADD CONSTRAINT "paper_trades_position_id_paper_positions_id_fk" FOREIGN KEY ("position_id") REFERENCES "public"."paper_positions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paper_trades" ADD CONSTRAINT "paper_trades_entry_order_id_paper_orders_id_fk" FOREIGN KEY ("entry_order_id") REFERENCES "public"."paper_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paper_trades" ADD CONSTRAINT "paper_trades_exit_order_id_paper_orders_id_fk" FOREIGN KEY ("exit_order_id") REFERENCES "public"."paper_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "paper_orders_account_requested_at_idx" ON "paper_orders" USING btree ("account_id","requested_at");--> statement-breakpoint
CREATE UNIQUE INDEX "paper_positions_one_open_position_per_account_idx" ON "paper_positions" USING btree ("account_id") WHERE "paper_positions"."status" = 'open';--> statement-breakpoint
CREATE INDEX "paper_trades_account_closed_at_idx" ON "paper_trades" USING btree ("account_id","closed_at");