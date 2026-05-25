import { randomUUID } from "node:crypto";

import { env } from "@ai-trade/config";
import {
  type AiDailyReviewRecordInput,
  AiDailyReviewRepository,
  type AiInvocationRecordInput,
  aiTuningProposals,
  db,
  paperAccounts,
  paperTrades,
  strategyRuns,
} from "@ai-trade/db";
import {
  type AiDailyReview,
  type AiDailyReviewResponse,
  type AiDailyReviewValidationResult,
  type DailyReviewInput,
  validateAiDailyReview,
} from "@ai-trade/domain/ai-tuning";
import {
  BASELINE_STRATEGIES,
  type StrategyDefinition,
  type StrategyTimeframe,
  strategyDefinitionSchema,
} from "@ai-trade/domain/strategies";
import { and, asc, desc, eq } from "drizzle-orm";

import type { ServiceHealth, ServiceState, WorkerService } from "../types.js";

export type DailyReviewRunResult = {
  attemptedAt: string;
  reviewDate: string;
  invocationStatus: "succeeded" | "failed" | "timeout";
  reviewStatus: "accepted" | "rejected" | "failed";
  warningCount: number;
  promotionCandidateCount: number;
  retirementCandidateCount: number;
  reason: string;
  autoApply?: AutoApplyResult;
};

export type AutoApplyResult = {
  appliedPromotions: { strategyName: string; strategyRunId: string }[];
  appliedRetirements: { strategyName: string; strategyRunId: string }[];
  skipped: { strategyName: string; reason: string }[];
};

export type AdoptionGateResult =
  | {
      ok: true;
      candidateRunId: string;
      candidateStrategyName: string;
      baselineStrategyName: string;
      timeframe: StrategyTimeframe;
      candidateStrategy: StrategyDefinition;
      promotedStrategy: StrategyDefinition;
      shadowStrategy: StrategyDefinition;
      metrics: AdoptionGateMetrics;
    }
  | {
      ok: false;
      candidateStrategyName: string;
      reasons: string[];
    };

export type AdoptionGateMetrics = {
  candidate: StrategyPerformanceSnapshot;
  baseline: StrategyPerformanceSnapshot;
  minTradeCount: number;
  profitImprovementPct: number;
};

export type StrategyPerformanceSnapshot = {
  strategyName: string;
  accountId: string | null;
  netProfitJpy: number;
  tradeCount: number;
  maxDrawdownPct: number;
};

export type AutoApplyInput = {
  reviewDate: string;
  baselinePromotionCandidates: AiDailyReview["baseline_promotion_candidates"];
  candidateRetirementCandidates: AiDailyReview["candidate_retirement_candidates"];
};

export interface DailyReviewDecisionExecutor {
  applyRecommendations(input: AutoApplyInput): Promise<AutoApplyResult>;
}

export interface DailyReviewProvider {
  generateDailyReview(input: DailyReviewInput): Promise<AiDailyReviewResponse>;
}

export interface DailyReviewStore {
  recordInvocationAndReview(
    invocation: AiInvocationRecordInput,
    review: AiDailyReviewRecordInput,
  ): Promise<void>;
}

export interface DailyReviewContextProvider {
  buildInput(reviewDate: string): Promise<DailyReviewInput>;
}

export type AiDailyReviewerServiceOptions = {
  enabled?: boolean;
  intervalMs?: number | null;
  aiProvider?: DailyReviewProvider;
  contextProvider?: DailyReviewContextProvider;
  store?: DailyReviewStore;
  decisionExecutor?: DailyReviewDecisionExecutor;
};

export class AiDailyReviewerService implements WorkerService {
  readonly name = "ai-daily-reviewer";

  private state: ServiceState = "stopped";
  private latestResult: DailyReviewRunResult | null = null;

  private readonly enabled: boolean;
  private readonly intervalMs: number | null;
  private readonly aiProvider: DailyReviewProvider;
  private readonly contextProvider: DailyReviewContextProvider;
  private readonly store: DailyReviewStore;
  private readonly decisionExecutor: DailyReviewDecisionExecutor;
  private interval: ReturnType<typeof setInterval> | null = null;
  private firstRunTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor(options: AiDailyReviewerServiceOptions = {}) {
    this.enabled = options.enabled ?? env.AI_DAILY_REVIEW_ENABLED;
    this.intervalMs = options.intervalMs === undefined ? 24 * 60 * 60 * 1000 : options.intervalMs;
    this.aiProvider = options.aiProvider ?? new HttpDailyReviewProvider(env.AI_RUNNER_INTERNAL_URL);
    this.contextProvider = options.contextProvider ?? new DbDailyReviewContextProvider();
    this.store = options.store ?? new AiDailyReviewRepository();
    this.decisionExecutor = options.decisionExecutor ?? new DbDailyReviewDecisionExecutor();
  }

  async start(): Promise<void> {
    this.state = this.enabled ? "ready" : "stopped";

    if (!this.enabled || this.intervalMs === null || this.interval !== null) {
      return;
    }

    const intervalMs = this.intervalMs;
    this.firstRunTimeout = setTimeout(() => {
      void this.runScheduledReview();
      this.interval = setInterval(() => {
        void this.runScheduledReview();
      }, intervalMs);
      this.interval.unref?.();
    }, msUntilNextTokyoHour(7));
    this.firstRunTimeout.unref?.();
  }

  async stop(): Promise<void> {
    if (this.firstRunTimeout !== null) {
      clearTimeout(this.firstRunTimeout);
      this.firstRunTimeout = null;
    }

    if (this.interval !== null) {
      clearInterval(this.interval);
      this.interval = null;
    }

    this.state = "stopped";
  }

  async health(): Promise<ServiceHealth> {
    return {
      name: this.name,
      state: this.state,
      details: {
        enabled: this.enabled,
        latestResult: this.latestResult,
      },
    };
  }

  async runOnce(now: Date = new Date()): Promise<DailyReviewRunResult> {
    const reviewDate = toTokyoDate(now);

    if (!this.enabled) {
      const result = {
        attemptedAt: now.toISOString(),
        reviewDate,
        invocationStatus: "failed" as const,
        reviewStatus: "failed" as const,
        warningCount: 0,
        promotionCandidateCount: 0,
        retirementCandidateCount: 0,
        reason: "Daily Review is disabled. Set AI_DAILY_REVIEW_ENABLED=true to run.",
      };
      this.latestResult = result;
      return result;
    }

    const input = await this.contextProvider.buildInput(reviewDate);
    const response = await this.aiProvider.generateDailyReview(input);
    const validation = toDailyReviewValidation(response);
    const reviewId = randomUUID();

    await this.store.recordInvocationAndReview(toInvocationRecord(response), {
      id: reviewId,
      invocationId: response.invocation.id,
      reviewDate,
      validation,
    });

    let autoApply: AutoApplyResult | undefined;
    if (validation.status === "accepted") {
      try {
        autoApply = await this.decisionExecutor.applyRecommendations({
          reviewDate,
          baselinePromotionCandidates: validation.review.baseline_promotion_candidates,
          candidateRetirementCandidates: validation.review.candidate_retirement_candidates,
        });
      } catch (error) {
        autoApply = {
          appliedPromotions: [],
          appliedRetirements: [],
          skipped: [
            {
              strategyName: "<all>",
              reason: `auto-apply failed: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    }

    const result =
      validation.status === "accepted"
        ? {
            attemptedAt: now.toISOString(),
            reviewDate,
            invocationStatus: response.invocation.status,
            reviewStatus: "accepted" as const,
            warningCount: validation.review.warnings.length,
            promotionCandidateCount: validation.review.baseline_promotion_candidates.length,
            retirementCandidateCount: validation.review.candidate_retirement_candidates.length,
            reason: validation.review.summary,
            autoApply,
          }
        : {
            attemptedAt: now.toISOString(),
            reviewDate,
            invocationStatus: response.invocation.status,
            reviewStatus: "rejected" as const,
            warningCount: 0,
            promotionCandidateCount: 0,
            retirementCandidateCount: 0,
            reason: validation.reasons.map((reason) => reason.message).join("; "),
          };

    this.latestResult = result;
    return result;
  }

  private async runScheduledReview(): Promise<void> {
    try {
      await this.runOnce();
    } catch (error) {
      this.latestResult = {
        attemptedAt: new Date().toISOString(),
        reviewDate: toTokyoDate(new Date()),
        invocationStatus: "failed",
        reviewStatus: "failed",
        warningCount: 0,
        promotionCandidateCount: 0,
        retirementCandidateCount: 0,
        reason: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

export class HttpDailyReviewProvider implements DailyReviewProvider {
  constructor(private readonly baseUrl: string) {}

  async generateDailyReview(input: DailyReviewInput): Promise<AiDailyReviewResponse> {
    const response = await fetch(new URL("/daily-reviews", this.baseUrl), {
      method: "POST",
      body: JSON.stringify(input),
      headers: { "content-type": "application/json" },
    });

    if (!response.ok) {
      throw new Error(`ai-runner Daily Review failed with status ${response.status}`);
    }

    return (await response.json()) as AiDailyReviewResponse;
  }
}

export class DbDailyReviewContextProvider implements DailyReviewContextProvider {
  async buildInput(reviewDate: string): Promise<DailyReviewInput> {
    const [accounts, trades, candidates] = await Promise.all([
      db
        .select({
          name: paperAccounts.name,
          balanceJpy: paperAccounts.balanceJpy,
          status: paperAccounts.status,
        })
        .from(paperAccounts)
        .orderBy(desc(paperAccounts.updatedAt))
        .limit(12),
      db
        .select({
          pnlJpy: paperTrades.pnlJpy,
          closedAt: paperTrades.closedAt,
        })
        .from(paperTrades)
        .orderBy(desc(paperTrades.closedAt))
        .limit(200),
      db
        .select({
          sourceStrategyName: aiTuningProposals.sourceStrategyName,
          candidateStrategyName: aiTuningProposals.candidateStrategyName,
          status: aiTuningProposals.status,
          timeframe: aiTuningProposals.timeframe,
          rationale: aiTuningProposals.rationale,
        })
        .from(aiTuningProposals)
        .where(eq(aiTuningProposals.insertedIntoPaper, true))
        .orderBy(desc(aiTuningProposals.createdAt))
        .limit(12),
    ]);

    const recentPnl = trades.reduce((sum, trade) => sum + Number(trade.pnlJpy), 0);
    const maxDrawdownJpy = Math.max(0, -Math.min(0, recentPnl));
    const warningSignals = buildWarningSignals(accounts, recentPnl, maxDrawdownJpy);

    return {
      reviewDate,
      timezone: "Asia/Tokyo",
      accountSummaries: accounts.map((account) => ({
        name: account.name,
        balanceJpy: Number(account.balanceJpy),
        realizedPnlJpy: recentPnl,
        tradeCount: trades.length,
        maxDrawdownJpy,
        status: account.status,
      })),
      candidateSummaries: candidates.map((candidate) => ({
        strategyName: candidate.candidateStrategyName ?? "unknown",
        sourceStrategyName: candidate.sourceStrategyName,
        timeframe: candidate.timeframe,
        status: candidate.status,
        rationale: candidate.rationale ?? undefined,
      })),
      warningSignals,
      operationsContext: {
        liveTradingEnabled: false,
        backupStatus: "unknown",
        restoreRehearsalStatus: "unknown",
      },
    };
  }
}

export class InMemoryDailyReviewStore implements DailyReviewStore {
  readonly invocations: AiInvocationRecordInput[] = [];
  readonly reviews: AiDailyReviewRecordInput[] = [];

  async recordInvocationAndReview(
    invocation: AiInvocationRecordInput,
    review: AiDailyReviewRecordInput,
  ): Promise<void> {
    this.invocations.push(invocation);
    this.reviews.push(review);
  }
}

export class DbDailyReviewDecisionExecutor implements DailyReviewDecisionExecutor {
  async applyRecommendations(input: AutoApplyInput): Promise<AutoApplyResult> {
    const result: AutoApplyResult = {
      appliedPromotions: [],
      appliedRetirements: [],
      skipped: [],
    };

    for (const rec of input.baselinePromotionCandidates) {
      if (rec.confidence !== "high") {
        result.skipped.push({
          strategyName: rec.strategyName,
          reason: `promote skipped: confidence=${rec.confidence}`,
        });
        continue;
      }

      const gate = await this.evaluateAdoptionGate(rec.strategyName);
      if (!gate.ok) {
        result.skipped.push({
          strategyName: rec.strategyName,
          reason: `promote skipped: adoption gate failed: ${gate.reasons.join("; ")}`,
        });
        continue;
      }

      const ids = await this.applyDecision(
        rec.strategyName,
        "promote_baseline",
        input.reviewDate,
        rec.reason,
        gate,
      );

      if (ids.length === 0) {
        result.skipped.push({
          strategyName: rec.strategyName,
          reason: "promote skipped: no matching proposed strategy run",
        });
      } else {
        for (const id of ids) {
          result.appliedPromotions.push({ strategyName: rec.strategyName, strategyRunId: id });
        }
      }
    }

    for (const rec of input.candidateRetirementCandidates) {
      if (rec.confidence !== "high") {
        result.skipped.push({
          strategyName: rec.strategyName,
          reason: `retire skipped: confidence=${rec.confidence}`,
        });
        continue;
      }

      const ids = await this.applyDecision(
        rec.strategyName,
        "retire_candidate",
        input.reviewDate,
        rec.reason,
      );

      if (ids.length === 0) {
        result.skipped.push({
          strategyName: rec.strategyName,
          reason: "retire skipped: no matching proposed strategy run",
        });
      } else {
        for (const id of ids) {
          result.appliedRetirements.push({ strategyName: rec.strategyName, strategyRunId: id });
        }
      }
    }

    return result;
  }

  private async applyDecision(
    strategyName: string,
    action: "promote_baseline" | "retire_candidate",
    reviewDate: string,
    reason: string,
    adoptionGate?: Extract<AdoptionGateResult, { ok: true }>,
  ): Promise<string[]> {
    const now = new Date();

    return db.transaction(async (tx) => {
      if (action === "promote_baseline" && adoptionGate) {
        await tx.insert(strategyRuns).values({
          id: randomUUID(),
          strategyName: adoptionGate.shadowStrategy.meta.name,
          symbol: adoptionGate.shadowStrategy.meta.symbol,
          timeframe: adoptionGate.shadowStrategy.meta.timeframe,
          status: "proposed",
          strategyDefinition: adoptionGate.shadowStrategy,
          startedAt: now,
          finishedAt: now,
          metadata: {
            shadowBaselineRun: true,
            replacedByStrategyRunId: adoptionGate.candidateRunId,
            baselineStrategyName: adoptionGate.baselineStrategyName,
            validationWindow: validationWindowByTimeframe[adoptionGate.timeframe],
            decidedAt: now.toISOString(),
            reviewDate,
            reason,
          },
        });
      }

      const updated =
        action === "promote_baseline" && adoptionGate
          ? await tx
              .update(strategyRuns)
              .set({
                strategyName: adoptionGate.baselineStrategyName,
                status: "promoted_to_baseline",
                strategyDefinition: adoptionGate.promotedStrategy,
                finishedAt: now,
                metadata: {
                  automaticPaperDecision: action,
                  decidedAt: now.toISOString(),
                  reviewDate,
                  reason,
                  sourceCandidateStrategyName: adoptionGate.candidateStrategyName,
                  baselineStrategyName: adoptionGate.baselineStrategyName,
                  adoptionGate: adoptionGate.metrics,
                },
              })
              .where(
                and(
                  eq(strategyRuns.strategyName, strategyName),
                  eq(strategyRuns.status, "proposed"),
                ),
              )
              .returning({ id: strategyRuns.id })
          : await tx
              .update(strategyRuns)
              .set({
                status: "retired",
                finishedAt: now,
                metadata: {
                  automaticPaperDecision: action,
                  decidedAt: now.toISOString(),
                  reviewDate,
                  reason,
                },
              })
              .where(
                and(
                  eq(strategyRuns.strategyName, strategyName),
                  eq(strategyRuns.status, "proposed"),
                ),
              )
              .returning({ id: strategyRuns.id });

      const ids = updated.map((row) => row.id);

      if (action === "retire_candidate" && ids.length > 0) {
        for (const id of ids) {
          await tx
            .update(paperAccounts)
            .set({ status: "stopped", updatedAt: now })
            .where(eq(paperAccounts.strategyRunId, id));
        }
      }

      return ids;
    });
  }

  private async evaluateAdoptionGate(strategyName: string): Promise<AdoptionGateResult> {
    const [candidateRow] = await db
      .select({
        id: strategyRuns.id,
        strategyName: strategyRuns.strategyName,
        timeframe: strategyRuns.timeframe,
        strategyDefinition: strategyRuns.strategyDefinition,
      })
      .from(strategyRuns)
      .where(and(eq(strategyRuns.strategyName, strategyName), eq(strategyRuns.status, "proposed")))
      .orderBy(desc(strategyRuns.startedAt))
      .limit(1);

    if (!candidateRow) {
      return {
        ok: false,
        candidateStrategyName: strategyName,
        reasons: ["candidate run not found"],
      };
    }

    const candidateStrategy = parseStrategyDefinition(candidateRow.strategyDefinition);
    if (!candidateStrategy) {
      return {
        ok: false,
        candidateStrategyName: strategyName,
        reasons: ["Candidate Strategy Definition is invalid"],
      };
    }

    const timeframe = candidateStrategy.meta.timeframe;
    const baselineStrategyName = `baseline_${timeframe}`;
    const baselineStrategy = await loadCurrentBaselineStrategy(timeframe);
    const promotedStrategy = renameStrategy(candidateStrategy, baselineStrategyName);
    const shadowStrategy = renameStrategy(
      baselineStrategy,
      `shadow_${baselineStrategyName}_${compactTimestamp(new Date())}`,
    );
    const [candidate, baseline] = await Promise.all([
      loadPerformanceSnapshot(strategyName),
      loadPerformanceSnapshot(baselineStrategyName),
    ]);
    const metrics = {
      candidate,
      baseline,
      minTradeCount: minTradeCountByTimeframe[timeframe],
      profitImprovementPct: percentageImprovement(candidate.netProfitJpy, baseline.netProfitJpy),
    };
    const reasons = evaluateAdoptionGateSnapshot({
      candidateStrategy,
      baselineStrategy,
      metrics,
    });

    if (reasons.length > 0) {
      return { ok: false, candidateStrategyName: strategyName, reasons };
    }

    return {
      ok: true,
      candidateRunId: candidateRow.id,
      candidateStrategyName: strategyName,
      baselineStrategyName,
      timeframe,
      candidateStrategy,
      promotedStrategy,
      shadowStrategy,
      metrics,
    };
  }
}

export function evaluateAdoptionGateSnapshot(input: {
  candidateStrategy: StrategyDefinition;
  baselineStrategy: StrategyDefinition;
  metrics: AdoptionGateMetrics;
}): string[] {
  const reasons: string[] = [];
  const { candidate, baseline, minTradeCount, profitImprovementPct } = input.metrics;

  if (input.candidateStrategy.meta.timeframe !== input.baselineStrategy.meta.timeframe) {
    reasons.push("candidate and baseline timeframe differ");
  }

  if (candidate.tradeCount < minTradeCount) {
    reasons.push(`candidate trade_count ${candidate.tradeCount} is below minimum ${minTradeCount}`);
  }

  if (profitImprovementPct < 5) {
    reasons.push(
      `candidate net profit improvement ${profitImprovementPct.toFixed(2)}% is below 5%`,
    );
  }

  if (candidate.maxDrawdownPct > baseline.maxDrawdownPct) {
    reasons.push(
      `candidate max drawdown ${candidate.maxDrawdownPct.toFixed(
        2,
      )}% exceeds baseline ${baseline.maxDrawdownPct.toFixed(2)}%`,
    );
  }

  if (candidate.maxDrawdownPct > 15) {
    reasons.push(`candidate max drawdown ${candidate.maxDrawdownPct.toFixed(2)}% exceeds 15%`);
  }

  reasons.push(...riskGateRelaxationReasons(input.candidateStrategy, input.baselineStrategy));

  return reasons;
}

export class InMemoryDailyReviewDecisionExecutor implements DailyReviewDecisionExecutor {
  readonly calls: AutoApplyInput[] = [];
  result: AutoApplyResult = {
    appliedPromotions: [],
    appliedRetirements: [],
    skipped: [],
  };

  async applyRecommendations(input: AutoApplyInput): Promise<AutoApplyResult> {
    this.calls.push(input);
    return this.result;
  }
}

const minTradeCountByTimeframe = {
  "1m": 20,
  "5m": 12,
  "15m": 6,
} as const satisfies Record<StrategyTimeframe, number>;

const validationWindowByTimeframe = {
  "1m": "6h",
  "5m": "24h",
  "15m": "3d",
} as const satisfies Record<StrategyTimeframe, string>;

async function loadCurrentBaselineStrategy(
  timeframe: StrategyTimeframe,
): Promise<StrategyDefinition> {
  const baselineName = `baseline_${timeframe}`;
  const [row] = await db
    .select({ strategyDefinition: strategyRuns.strategyDefinition })
    .from(strategyRuns)
    .where(
      and(
        eq(strategyRuns.strategyName, baselineName),
        eq(strategyRuns.status, "promoted_to_baseline"),
      ),
    )
    .orderBy(desc(strategyRuns.finishedAt))
    .limit(1);
  const parsed = row ? parseStrategyDefinition(row.strategyDefinition) : null;

  return parsed ?? BASELINE_STRATEGIES[timeframe];
}

function renameStrategy(strategy: StrategyDefinition, name: string): StrategyDefinition {
  return {
    ...strategy,
    meta: {
      ...strategy.meta,
      name,
    },
  };
}

function parseStrategyDefinition(input: unknown): StrategyDefinition | null {
  const parsed = strategyDefinitionSchema.safeParse(input);

  return parsed.success ? (parsed.data as StrategyDefinition) : null;
}

function compactTimestamp(date: Date): string {
  return date
    .toISOString()
    .replaceAll(/[-:.TZ]/g, "")
    .slice(0, 14);
}

async function loadPerformanceSnapshot(strategyName: string): Promise<StrategyPerformanceSnapshot> {
  const [account] = await db
    .select({
      id: paperAccounts.id,
      balanceJpy: paperAccounts.balanceJpy,
      initialBalanceJpy: paperAccounts.initialBalanceJpy,
    })
    .from(paperAccounts)
    .where(eq(paperAccounts.name, strategyName))
    .orderBy(desc(paperAccounts.updatedAt))
    .limit(1);

  if (!account) {
    return {
      strategyName,
      accountId: null,
      netProfitJpy: 0,
      tradeCount: 0,
      maxDrawdownPct: 0,
    };
  }

  const trades = await db
    .select({
      pnlJpy: paperTrades.pnlJpy,
    })
    .from(paperTrades)
    .where(eq(paperTrades.accountId, account.id))
    .orderBy(asc(paperTrades.closedAt));
  const initialBalanceJpy = Number(account.initialBalanceJpy);

  return {
    strategyName,
    accountId: account.id,
    netProfitJpy: Number(account.balanceJpy) - initialBalanceJpy,
    tradeCount: trades.length,
    maxDrawdownPct: maxDrawdownPct(
      trades.map((trade) => Number(trade.pnlJpy)),
      initialBalanceJpy,
    ),
  };
}

function maxDrawdownPct(pnls: number[], initialBalanceJpy: number): number {
  if (initialBalanceJpy <= 0) {
    return 0;
  }

  let equity = initialBalanceJpy;
  let peak = initialBalanceJpy;
  let maxDrawdown = 0;

  for (const pnl of pnls) {
    equity += pnl;
    peak = Math.max(peak, equity);
    maxDrawdown = Math.max(maxDrawdown, peak - equity);
  }

  return (maxDrawdown / initialBalanceJpy) * 100;
}

function percentageImprovement(candidateProfit: number, baselineProfit: number): number {
  if (baselineProfit <= 0) {
    return candidateProfit > 0 ? 100 : 0;
  }

  return ((candidateProfit - baselineProfit) / Math.abs(baselineProfit)) * 100;
}

function riskGateRelaxationReasons(
  candidate: StrategyDefinition,
  baseline: StrategyDefinition,
): string[] {
  const reasons: string[] = [];

  if (
    candidate.risk.max_open_positions_per_account > baseline.risk.max_open_positions_per_account
  ) {
    reasons.push("candidate relaxes max_open_positions_per_account");
  }

  if (candidate.risk.max_margin_usage_pct > baseline.risk.max_margin_usage_pct) {
    reasons.push("candidate relaxes max_margin_usage_pct");
  }

  if (candidate.risk.max_loss_per_trade_jpy > baseline.risk.max_loss_per_trade_jpy) {
    reasons.push("candidate relaxes max_loss_per_trade_jpy");
  }

  if (candidate.risk.max_daily_loss_jpy > baseline.risk.max_daily_loss_jpy) {
    reasons.push("candidate relaxes max_daily_loss_jpy");
  }

  if (
    candidate.risk.min_margin_maintenance_rate_for_entry <
    baseline.risk.min_margin_maintenance_rate_for_entry
  ) {
    reasons.push("candidate relaxes min_margin_maintenance_rate_for_entry");
  }

  if (candidate.gates.volatility.max_spread_pips > baseline.gates.volatility.max_spread_pips) {
    reasons.push("candidate relaxes max_spread_pips");
  }

  if (
    candidate.gates.volatility.max_atr_spike_ratio > baseline.gates.volatility.max_atr_spike_ratio
  ) {
    reasons.push("candidate relaxes max_atr_spike_ratio");
  }

  if (candidate.exit.allow_reversal_entry !== false) {
    reasons.push("candidate enables reversal entry");
  }

  return reasons;
}

function toDailyReviewValidation(response: AiDailyReviewResponse): AiDailyReviewValidationResult {
  if (response.review === undefined) {
    return {
      status: "rejected",
      reasons: [
        {
          code: "schema_validation_error",
          path: "$",
          message: response.invocation.errorSummary ?? "AI provider did not return a Daily Review.",
        },
      ],
    };
  }

  return validateAiDailyReview(response.review);
}

function toInvocationRecord(response: AiDailyReviewResponse): AiInvocationRecordInput {
  return {
    id: response.invocation.id,
    provider: response.invocation.provider,
    purpose: "daily_review",
    promptHash: response.invocation.promptHash,
    promptRedacted: response.invocation.promptRedacted,
    stdoutRaw: response.invocation.stdoutRaw,
    stderrSummary: response.invocation.stderrSummary,
    parsedJson: response.invocation.parsedJson,
    status: response.invocation.status,
    timeoutMs: response.invocation.timeoutMs,
    cliVersion: response.invocation.cliVersion,
    startedAt: new Date(response.invocation.startedAt),
    finishedAt: new Date(response.invocation.finishedAt),
    errorSummary: response.invocation.errorSummary,
  };
}

function buildWarningSignals(
  accounts: { name: string; balanceJpy: string }[],
  recentPnl: number,
  maxDrawdownJpy: number,
): string[] {
  const warnings: string[] = [];

  if (accounts.length === 0) {
    warnings.push("No Paper Accounts are recorded yet.");
  }

  if (recentPnl < 0) {
    warnings.push(`Recent realized PnL is negative: ${recentPnl.toFixed(0)} JPY.`);
  }

  if (maxDrawdownJpy >= 2000) {
    warnings.push(`Estimated drawdown exceeds daily warning threshold: ${maxDrawdownJpy} JPY.`);
  }

  return warnings;
}

function toTokyoDate(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function msUntilNextTokyoHour(hour: number): number {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Tokyo",
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(now);
  const currentHour = Number(parts.find((part) => part.type === "hour")?.value ?? 0);
  const currentMinute = Number(parts.find((part) => part.type === "minute")?.value ?? 0);
  const currentSecond = Number(parts.find((part) => part.type === "second")?.value ?? 0);
  const elapsedToday = ((currentHour * 60 + currentMinute) * 60 + currentSecond) * 1000;
  const targetToday = hour * 60 * 60 * 1000;
  const dayMs = 24 * 60 * 60 * 1000;

  return targetToday > elapsedToday
    ? targetToday - elapsedToday
    : dayMs - elapsedToday + targetToday;
}
