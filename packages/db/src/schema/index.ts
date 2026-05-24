import { sql } from "drizzle-orm";
import {
  boolean,
  index,
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

export const strategyRunStatus = pgEnum("strategy_run_status", [
  "proposed",
  "validated",
  "running_paper",
  "promoted_to_baseline",
  "retired",
]);

export const paperAccountStatus = pgEnum("paper_account_status", ["active", "stopped"]);

export const paperPositionSide = pgEnum("paper_position_side", ["long", "short"]);

export const paperPositionStatus = pgEnum("paper_position_status", ["open", "closed"]);

export const paperOrderAction = pgEnum("paper_order_action", ["entry", "exit"]);

export const paperOrderSide = pgEnum("paper_order_side", ["BUY", "SELL"]);

export const paperOrderStatus = pgEnum("paper_order_status", ["filled", "rejected"]);

export const aiInvocationStatus = pgEnum("ai_invocation_status", [
  "succeeded",
  "failed",
  "timeout",
]);

export const aiTuningProposalStatus = pgEnum("ai_tuning_proposal_status", [
  "accepted",
  "rejected",
  "failed",
]);

export const aiDailyReviewStatus = pgEnum("ai_daily_review_status", [
  "accepted",
  "rejected",
  "failed",
]);

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

export const strategyRuns = pgTable("strategy_runs", {
  id: uuid("id").defaultRandom().primaryKey(),
  strategyName: text("strategy_name").notNull(),
  symbol: text("symbol").notNull(),
  timeframe: text("timeframe").notNull(),
  status: strategyRunStatus("status").notNull(),
  strategyDefinition: jsonb("strategy_definition_json").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().default(sql`now()`),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  metadata: jsonb("metadata_json"),
});

export const paperAccounts = pgTable("paper_accounts", {
  id: uuid("id").defaultRandom().primaryKey(),
  strategyRunId: uuid("strategy_run_id").references(() => strategyRuns.id),
  name: text("name").notNull(),
  currency: text("currency").notNull().default("JPY"),
  initialBalanceJpy: numeric("initial_balance_jpy", { precision: 18, scale: 6 }).notNull(),
  balanceJpy: numeric("balance_jpy", { precision: 18, scale: 6 }).notNull(),
  leverage: numeric("leverage", { precision: 10, scale: 2 }).notNull(),
  status: paperAccountStatus("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
});

export const paperPositions = pgTable(
  "paper_positions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => paperAccounts.id),
    strategyRunId: uuid("strategy_run_id").references(() => strategyRuns.id),
    symbol: text("symbol").notNull(),
    side: paperPositionSide("side").notNull(),
    status: paperPositionStatus("status").notNull().default("open"),
    quantity: numeric("quantity", { precision: 18, scale: 6 }).notNull(),
    entryPrice: numeric("entry_price", { precision: 18, scale: 6 }).notNull(),
    openedAt: timestamp("opened_at", { withTimezone: true }).notNull(),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    stopLossPrice: numeric("stop_loss_price", { precision: 18, scale: 6 }).notNull(),
    takeProfitPrice: numeric("take_profit_price", { precision: 18, scale: 6 }).notNull(),
    trailingStopPrice: numeric("trailing_stop_price", { precision: 18, scale: 6 }),
    breakEvenStopPrice: numeric("break_even_stop_price", { precision: 18, scale: 6 }),
    bestPriceSinceOpen: numeric("best_price_since_open", { precision: 18, scale: 6 }).notNull(),
    spreadPips: numeric("spread_pips", { precision: 10, scale: 4 }).notNull(),
    spreadSource: text("spread_source").notNull(),
    realizedPnlJpy: numeric("realized_pnl_jpy", { precision: 18, scale: 6 }),
    metadata: jsonb("metadata_json"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (table) => [
    uniqueIndex("paper_positions_one_open_position_per_account_idx")
      .on(table.accountId)
      .where(sql`${table.status} = 'open'`),
  ],
);

export const paperOrders = pgTable(
  "paper_orders",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => paperAccounts.id),
    strategyRunId: uuid("strategy_run_id").references(() => strategyRuns.id),
    positionId: uuid("position_id").references(() => paperPositions.id),
    symbol: text("symbol").notNull(),
    action: paperOrderAction("action").notNull(),
    side: paperOrderSide("side").notNull(),
    status: paperOrderStatus("status").notNull(),
    quantity: numeric("quantity", { precision: 18, scale: 6 }).notNull(),
    requestedAt: timestamp("requested_at", { withTimezone: true }).notNull(),
    executedAt: timestamp("executed_at", { withTimezone: true }),
    executionPrice: numeric("execution_price", { precision: 18, scale: 6 }),
    executionReason: text("execution_reason").notNull(),
    spreadPips: numeric("spread_pips", { precision: 10, scale: 4 }).notNull(),
    spreadSource: text("spread_source").notNull(),
    rejectionReason: text("rejection_reason"),
    metadata: jsonb("metadata_json"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (table) => [
    index("paper_orders_account_requested_at_idx").on(table.accountId, table.requestedAt),
  ],
);

export const paperTrades = pgTable(
  "paper_trades",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => paperAccounts.id),
    strategyRunId: uuid("strategy_run_id").references(() => strategyRuns.id),
    positionId: uuid("position_id")
      .notNull()
      .references(() => paperPositions.id),
    entryOrderId: uuid("entry_order_id").references(() => paperOrders.id),
    exitOrderId: uuid("exit_order_id").references(() => paperOrders.id),
    symbol: text("symbol").notNull(),
    side: paperPositionSide("side").notNull(),
    quantity: numeric("quantity", { precision: 18, scale: 6 }).notNull(),
    entryPrice: numeric("entry_price", { precision: 18, scale: 6 }).notNull(),
    exitPrice: numeric("exit_price", { precision: 18, scale: 6 }).notNull(),
    openedAt: timestamp("opened_at", { withTimezone: true }).notNull(),
    closedAt: timestamp("closed_at", { withTimezone: true }).notNull(),
    pnlJpy: numeric("pnl_jpy", { precision: 18, scale: 6 }).notNull(),
    closeReason: text("close_reason").notNull(),
    metadata: jsonb("metadata_json"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (table) => [index("paper_trades_account_closed_at_idx").on(table.accountId, table.closedAt)],
);

export const aiInvocations = pgTable(
  "ai_invocations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    provider: text("provider").notNull(),
    purpose: text("purpose").notNull(),
    promptHash: text("prompt_hash").notNull(),
    promptRedacted: text("prompt_redacted").notNull(),
    stdoutRaw: text("stdout_raw"),
    stderrSummary: text("stderr_summary"),
    parsedJson: jsonb("parsed_json"),
    status: aiInvocationStatus("status").notNull(),
    timeoutMs: numeric("timeout_ms", { precision: 18, scale: 0 }).notNull(),
    cliVersion: text("cli_version"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    finishedAt: timestamp("finished_at", { withTimezone: true }).notNull(),
    errorSummary: text("error_summary"),
  },
  (table) => [index("ai_invocations_started_at_idx").on(table.startedAt)],
);

export const aiTuningProposals = pgTable(
  "ai_tuning_proposals",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    invocationId: uuid("invocation_id").references(() => aiInvocations.id),
    sourceStrategyName: text("source_strategy_name").notNull(),
    candidateStrategyName: text("candidate_strategy_name"),
    symbol: text("symbol").notNull(),
    timeframe: text("timeframe").notNull(),
    status: aiTuningProposalStatus("status").notNull(),
    rationale: text("rationale"),
    strategyDefinition: jsonb("strategy_definition_json"),
    rejectReasons: jsonb("reject_reasons_json"),
    insertedIntoPaper: boolean("inserted_into_paper").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (table) => [
    index("ai_tuning_proposals_created_at_idx").on(table.createdAt),
    index("ai_tuning_proposals_status_idx").on(table.status),
  ],
);

export const aiDailyReviews = pgTable(
  "ai_daily_reviews",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    invocationId: uuid("invocation_id").references(() => aiInvocations.id),
    reviewDate: text("review_date").notNull(),
    status: aiDailyReviewStatus("status").notNull(),
    summary: text("summary"),
    baselinePromotionCandidates: jsonb("baseline_promotion_candidates_json"),
    candidateRetirementCandidates: jsonb("candidate_retirement_candidates_json"),
    warnings: jsonb("warnings_json"),
    nextActions: jsonb("next_actions_json"),
    rejectReasons: jsonb("reject_reasons_json"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (table) => [
    index("ai_daily_reviews_created_at_idx").on(table.createdAt),
    index("ai_daily_reviews_review_date_idx").on(table.reviewDate),
    index("ai_daily_reviews_status_idx").on(table.status),
  ],
);
