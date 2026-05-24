CREATE EXTENSION IF NOT EXISTS timescaledb;--> statement-breakpoint
CREATE TYPE "public"."candle_price_type" AS ENUM('bid', 'ask', 'mid');--> statement-breakpoint
CREATE TYPE "public"."candle_source" AS ENUM('websocket', 'rest_klines', 'derived');--> statement-breakpoint
CREATE TYPE "public"."job_run_status" AS ENUM('running', 'succeeded', 'failed', 'skipped');--> statement-breakpoint
CREATE TABLE "candles" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"symbol" text NOT NULL,
	"timeframe" text NOT NULL,
	"price_type" "candle_price_type" NOT NULL,
	"opened_at" timestamp with time zone NOT NULL,
	"open" numeric(18, 6) NOT NULL,
	"high" numeric(18, 6) NOT NULL,
	"low" numeric(18, 6) NOT NULL,
	"close" numeric(18, 6) NOT NULL,
	"source" "candle_source" NOT NULL,
	"source_version" text DEFAULT 'phase0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "features" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"symbol" text NOT NULL,
	"timeframe" text NOT NULL,
	"opened_at" timestamp with time zone NOT NULL,
	"feature_set_version" text DEFAULT 'fx-core-v1' NOT NULL,
	"values" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_name" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"status" "job_run_status" NOT NULL,
	"error_summary" text,
	"metadata_json" jsonb
);
--> statement-breakpoint
CREATE UNIQUE INDEX "candles_symbol_timeframe_price_type_opened_at_idx" ON "candles" USING btree ("symbol","timeframe","price_type","opened_at");--> statement-breakpoint
CREATE UNIQUE INDEX "features_symbol_timeframe_opened_at_version_idx" ON "features" USING btree ("symbol","timeframe","opened_at","feature_set_version");--> statement-breakpoint
SELECT create_hypertable('candles', 'opened_at', if_not_exists => TRUE);--> statement-breakpoint
SELECT create_hypertable('features', 'opened_at', if_not_exists => TRUE);
