import { sql } from "drizzle-orm";
import {
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const candlePriceType = pgEnum("candle_price_type", ["bid", "ask", "mid"]);

export const candleSource = pgEnum("candle_source", ["websocket", "rest_klines", "derived"]);

export const jobRunStatus = pgEnum("job_run_status", ["running", "succeeded", "failed", "skipped"]);

export const candles = pgTable(
  "candles",
  {
    id: uuid("id").defaultRandom().notNull(),
    symbol: text("symbol").notNull(),
    timeframe: text("timeframe").notNull(),
    priceType: candlePriceType("price_type").notNull(),
    openedAt: timestamp("opened_at", { withTimezone: true }).notNull(),
    open: numeric("open", { precision: 18, scale: 6 }).notNull(),
    high: numeric("high", { precision: 18, scale: 6 }).notNull(),
    low: numeric("low", { precision: 18, scale: 6 }).notNull(),
    close: numeric("close", { precision: 18, scale: 6 }).notNull(),
    source: candleSource("source").notNull(),
    sourceVersion: text("source_version").notNull().default("phase0"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (table) => [
    uniqueIndex("candles_symbol_timeframe_price_type_opened_at_idx").on(
      table.symbol,
      table.timeframe,
      table.priceType,
      table.openedAt,
    ),
  ],
);

export const features = pgTable(
  "features",
  {
    id: uuid("id").defaultRandom().notNull(),
    symbol: text("symbol").notNull(),
    timeframe: text("timeframe").notNull(),
    openedAt: timestamp("opened_at", { withTimezone: true }).notNull(),
    featureSetVersion: text("feature_set_version").notNull().default("fx-core-v1"),
    values: jsonb("values").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (table) => [
    uniqueIndex("features_symbol_timeframe_opened_at_version_idx").on(
      table.symbol,
      table.timeframe,
      table.openedAt,
      table.featureSetVersion,
    ),
  ],
);

export const jobRuns = pgTable("job_runs", {
  id: uuid("id").defaultRandom().primaryKey(),
  jobName: text("job_name").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().default(sql`now()`),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  status: jobRunStatus("status").notNull(),
  errorSummary: text("error_summary"),
  metadata: jsonb("metadata_json"),
});
