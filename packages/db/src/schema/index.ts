import { sql } from "drizzle-orm";
import {
  boolean,
  foreignKey,
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

export const jobControlStatus = pgEnum("job_control_status", [
  "queued",
  "running",
  "succeeded",
  "failed",
  "skipped",
]);

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

export const aiAgentStatus = pgEnum("ai_agent_status", ["active", "paused"]);

export const aiAgentRunStatus = pgEnum("ai_agent_run_status", [
  "succeeded",
  "failed",
  "timeout",
  "rejected_output",
]);

export const aiAgentMemoryType = pgEnum("ai_agent_memory_type", [
  "market_observation",
  "strategy_hypothesis",
  "proposal_review",
  "rejection_learning",
]);

export const aiAgentKnowledgeScope = pgEnum("ai_agent_knowledge_scope", ["private", "shared"]);

export const aiAgentKnowledgeStatus = pgEnum("ai_agent_knowledge_status", [
  "draft",
  "active",
  "archived",
]);

export const aiAgentObservationKind = pgEnum("ai_agent_observation_kind", [
  "market",
  "candidate_performance",
  "risk",
  "operations",
]);

export const aiAgentProposalValidationStatus = pgEnum("ai_agent_proposal_validation_status", [
  "accepted",
  "rejected",
]);

export const aiAgentCandidateRecommendation = pgEnum("ai_agent_candidate_recommendation", [
  "continue",
  "retire",
  "promote",
]);

export const aiAgentCandidateConfidence = pgEnum("ai_agent_candidate_confidence", [
  "low",
  "medium",
  "high",
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
    priceType: candlePriceType("price_type").notNull().default("mid"),
    openedAt: timestamp("opened_at", { withTimezone: true }).notNull(),
    featureSetVersion: text("feature_set_version").notNull().default("fx-core-v1"),
    inputSourceVersion: text("input_source_version").notNull().default("phase0"),
    values: jsonb("values").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (table) => [
    uniqueIndex("features_symbol_timeframe_price_type_opened_at_versions_idx").on(
      table.symbol,
      table.timeframe,
      table.priceType,
      table.openedAt,
      table.featureSetVersion,
      table.inputSourceVersion,
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

export const jobControl = pgTable(
  "job_control",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    jobName: text("job_name").notNull(),
    targetKey: text("target_key").notNull(),
    scheduledFor: timestamp("scheduled_for", { withTimezone: true }).notNull(),
    status: jobControlStatus("status").notNull().default("queued"),
    lockedBy: text("locked_by"),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    attempt: numeric("attempt", { precision: 10, scale: 0 }).notNull().default("0"),
    maxAttempts: numeric("max_attempts", { precision: 10, scale: 0 }).notNull().default("3"),
    checkpoint: jsonb("checkpoint_json"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (table) => [
    uniqueIndex("job_control_job_target_scheduled_for_idx").on(
      table.jobName,
      table.targetKey,
      table.scheduledFor,
    ),
    index("job_control_status_locked_until_idx").on(table.status, table.lockedUntil),
  ],
);

export const aiAgents = pgTable(
  "ai_agents",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    persona: text("persona").notNull(),
    systemPrompt: text("system_prompt").notNull(),
    allowedTools: jsonb("allowed_tools_json").notNull(),
    status: aiAgentStatus("status").notNull().default("active"),
    currentVersion: numeric("current_version", { precision: 10, scale: 0 }).notNull().default("1"),
    runIntervalSec: numeric("run_interval_sec", { precision: 10, scale: 0 }).notNull(),
    model: text("model").notNull(),
    maxConsecutiveFailures: numeric("max_consecutive_failures", { precision: 10, scale: 0 })
      .notNull()
      .default("3"),
    consecutiveFailures: numeric("consecutive_failures", { precision: 10, scale: 0 })
      .notNull()
      .default("0"),
    tokenBudgetPerRun: numeric("token_budget_per_run", { precision: 10, scale: 0 })
      .notNull()
      .default("200000"),
    costBudgetPerRunUsd: numeric("cost_budget_per_run_usd", { precision: 12, scale: 6 })
      .notNull()
      .default("5"),
    pausedReason: text("paused_reason"),
    sharedMemoryEnabled: boolean("shared_memory_enabled").notNull().default(false),
    characterId: text("character_id"),
    role: text("role").notNull().default("trader"),
    initialBalanceJpy: numeric("initial_balance_jpy", { precision: 18, scale: 6 })
      .notNull()
      .default("100000"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (table) => [index("ai_agents_name_idx").on(table.name)],
);

export const aiAgentVersions = pgTable(
  "ai_agent_versions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => aiAgents.id),
    version: numeric("version", { precision: 10, scale: 0 }).notNull(),
    systemPrompt: text("system_prompt").notNull(),
    allowedTools: jsonb("allowed_tools_json").notNull(),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (table) => [uniqueIndex("ai_agent_versions_agent_version_idx").on(table.agentId, table.version)],
);

export const aiAgentRuns = pgTable(
  "ai_agent_runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => aiAgents.id),
    agentVersion: numeric("agent_version", { precision: 10, scale: 0 }).notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().default(sql`now()`),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    status: aiAgentRunStatus("status").notNull(),
    inputSummary: jsonb("input_summary_json"),
    outputSummary: jsonb("output_summary_json"),
    toolCalls: jsonb("tool_calls_json"),
    tokenUsage: jsonb("token_usage_json"),
    error: text("error"),
  },
  (table) => [
    index("ai_agent_runs_agent_started_at_idx").on(table.agentId, table.startedAt),
    foreignKey({
      columns: [table.agentId, table.agentVersion],
      foreignColumns: [aiAgentVersions.agentId, aiAgentVersions.version],
      name: "ai_agent_runs_agent_version_fk",
    }),
  ],
);

export const aiAgentMemories = pgTable(
  "ai_agent_memories",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => aiAgents.id),
    type: aiAgentMemoryType("type").notNull(),
    content: text("content").notNull(),
    tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
    sourceRefs: jsonb("source_refs_json"),
    searchVector: text("search_vector"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (table) => [
    index("ai_agent_memories_agent_idx").on(table.agentId),
    index("ai_agent_memories_agent_type_idx").on(table.agentId, table.type),
    index("ai_agent_memories_tags_idx").using("gin", table.tags),
  ],
);

export const aiAgentSkills = pgTable(
  "ai_agent_skills",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => aiAgents.id),
    scope: aiAgentKnowledgeScope("scope").notNull().default("private"),
    title: text("title").notNull(),
    body: text("body").notNull(),
    tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
    sourceRefs: jsonb("source_refs_json"),
    reason: text("reason").notNull(),
    status: aiAgentKnowledgeStatus("status").notNull().default("active"),
    version: numeric("version", { precision: 10, scale: 0 }).notNull().default("1"),
    promotedFromSkillId: uuid("promoted_from_skill_id"),
    createdRunId: uuid("created_run_id").references(() => aiAgentRuns.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (table) => [
    index("ai_agent_skills_agent_idx").on(table.agentId),
    index("ai_agent_skills_scope_status_idx").on(table.scope, table.status),
    index("ai_agent_skills_tags_idx").using("gin", table.tags),
  ],
);

export const aiAgentObservations = pgTable("ai_agent_observations", {
  id: uuid("id").defaultRandom().primaryKey(),
  runId: uuid("run_id")
    .notNull()
    .references(() => aiAgentRuns.id),
  agentId: uuid("agent_id")
    .notNull()
    .references(() => aiAgents.id),
  kind: aiAgentObservationKind("kind").notNull(),
  summary: text("summary").notNull(),
  evidence: jsonb("evidence_json").notNull(),
  tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
});

export const aiAgentStrategyProposals = pgTable(
  "ai_agent_strategy_proposals",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    runId: uuid("run_id")
      .notNull()
      .references(() => aiAgentRuns.id),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => aiAgents.id),
    strategyName: text("strategy_name").notNull(),
    proposalJson: jsonb("proposal_json").notNull(),
    validationStatus: aiAgentProposalValidationStatus("validation_status").notNull(),
    rejectionReasons: jsonb("rejection_reasons_json"),
    insertedStrategyRunId: uuid("inserted_strategy_run_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (table) => [
    index("ai_agent_strategy_proposals_agent_created_at_idx").on(table.agentId, table.createdAt),
    index("ai_agent_strategy_proposals_validation_idx").on(table.validationStatus),
  ],
);

export const aiAgentCandidateReviews = pgTable(
  "ai_agent_candidate_reviews",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    runId: uuid("run_id")
      .notNull()
      .references(() => aiAgentRuns.id),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => aiAgents.id),
    strategyName: text("strategy_name").notNull(),
    recommendation: aiAgentCandidateRecommendation("recommendation").notNull(),
    confidence: aiAgentCandidateConfidence("confidence").notNull(),
    reason: text("reason").notNull(),
    evidence: jsonb("evidence_json").notNull(),
    applied: boolean("applied").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (table) => [
    index("ai_agent_candidate_reviews_agent_created_at_idx").on(table.agentId, table.createdAt),
  ],
);

export const aiAgentPromptOptimizationStatus = pgEnum("ai_agent_prompt_optimization_status", [
  "optimized",
  "rolled_back",
  "rejected",
  "skipped",
]);

export const aiAgentPromptOptimizations = pgTable(
  "ai_agent_prompt_optimizations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => aiAgents.id),
    status: aiAgentPromptOptimizationStatus("status").notNull(),
    fromVersion: numeric("from_version", { precision: 10, scale: 0 }).notNull(),
    toVersion: numeric("to_version", { precision: 10, scale: 0 }),
    baselineScore: numeric("baseline_score", { precision: 18, scale: 6 }).notNull(),
    observedScore: numeric("observed_score", { precision: 18, scale: 6 }),
    scorecard: jsonb("scorecard_json").notNull(),
    reasoning: text("reasoning").notNull(),
    promptHash: text("prompt_hash"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (table) => [
    index("ai_agent_prompt_optimizations_agent_created_at_idx").on(table.agentId, table.createdAt),
  ],
);

export const aiAgentSkillCurationAction = pgEnum("ai_agent_skill_curation_action", [
  "promote",
  "retire",
]);

export const aiAgentSkillCurationStatus = pgEnum("ai_agent_skill_curation_status", [
  "applied",
  "skipped",
  "rejected",
]);

/**
 * Audit log of skill-curation decisions made by the knowledge curator. One row
 * per applied/skipped/rejected decision. Promotions record the new shared skill
 * in `resultSkillId`; retirements (status -> archived) leave it null. All
 * mutations are reversible, so this table is the source of truth for "what the
 * curator did and why".
 */
export const aiAgentSkillCurations = pgTable(
  "ai_agent_skill_curations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    curatorAgentId: uuid("curator_agent_id")
      .notNull()
      .references(() => aiAgents.id),
    action: aiAgentSkillCurationAction("action").notNull(),
    status: aiAgentSkillCurationStatus("status").notNull(),
    skillId: uuid("skill_id")
      .notNull()
      .references(() => aiAgentSkills.id),
    resultSkillId: uuid("result_skill_id").references(() => aiAgentSkills.id),
    confidence: aiAgentCandidateConfidence("confidence").notNull(),
    reason: text("reason").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (table) => [
    index("ai_agent_skill_curations_curator_created_at_idx").on(
      table.curatorAgentId,
      table.createdAt,
    ),
    index("ai_agent_skill_curations_skill_idx").on(table.skillId),
  ],
);

export const strategyRuns = pgTable("strategy_runs", {
  id: uuid("id").defaultRandom().primaryKey(),
  strategyName: text("strategy_name").notNull(),
  symbol: text("symbol").notNull(),
  timeframe: text("timeframe").notNull(),
  status: strategyRunStatus("status").notNull(),
  strategyDefinition: jsonb("strategy_definition_json").notNull(),
  sourceAgentId: uuid("source_agent_id").references(() => aiAgents.id),
  sourceProposalId: uuid("source_proposal_id").references(() => aiAgentStrategyProposals.id),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().default(sql`now()`),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  metadata: jsonb("metadata_json"),
});

export const paperAccounts = pgTable(
  "paper_accounts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    strategyRunId: uuid("strategy_run_id").references(() => strategyRuns.id),
    agentId: uuid("agent_id").references(() => aiAgents.id),
    name: text("name").notNull(),
    currency: text("currency").notNull().default("JPY"),
    initialBalanceJpy: numeric("initial_balance_jpy", { precision: 18, scale: 6 }).notNull(),
    balanceJpy: numeric("balance_jpy", { precision: 18, scale: 6 }).notNull(),
    leverage: numeric("leverage", { precision: 10, scale: 2 }).notNull(),
    status: paperAccountStatus("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (table) => [uniqueIndex("paper_accounts_agent_id_idx").on(table.agentId)],
);

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
    uniqueIndex("paper_positions_one_open_position_per_strategy_run_idx")
      .on(table.accountId, table.strategyRunId)
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
