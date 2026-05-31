import { randomUUID } from "node:crypto";

import { db, paperAccounts, paperTrades, strategyRuns } from "@ai-trade/db";
import {
  type AdoptionGateMetrics,
  evaluateAdoptionGateSnapshot,
  type StrategyPerformanceSnapshot,
} from "@ai-trade/domain";
import type { AiDailyReview } from "@ai-trade/domain/ai-tuning";
import {
  BASELINE_STRATEGIES,
  type StrategyDefinition,
  type StrategyTimeframe,
  strategyDefinitionSchema,
} from "@ai-trade/domain/strategies";
import { and, asc, desc, eq } from "drizzle-orm";

export type AutoApplyResult = {
  appliedPromotions: { strategyName: string; strategyRunId: string }[];
  appliedRetirements: { strategyName: string; strategyRunId: string }[];
  skipped: { strategyName: string; reason: string }[];
};

export type AutoApplyInput = {
  reviewDate: string;
  baselinePromotionCandidates: AiDailyReview["baseline_promotion_candidates"];
  candidateRetirementCandidates: AiDailyReview["candidate_retirement_candidates"];
};

export interface DailyReviewDecisionExecutor {
  applyRecommendations(input: AutoApplyInput): Promise<AutoApplyResult>;
}

type AdoptionGateResult =
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

      const gate = await evaluateAdoptionGate(rec.strategyName);
      if (!gate.ok) {
        result.skipped.push({
          strategyName: rec.strategyName,
          reason: `promote skipped: adoption gate failed: ${gate.reasons.join("; ")}`,
        });
        continue;
      }

      const ids = await applyDecision(
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

      const ids = await applyDecision(
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
}

async function applyDecision(
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
              and(eq(strategyRuns.strategyName, strategyName), eq(strategyRuns.status, "proposed")),
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
              and(eq(strategyRuns.strategyName, strategyName), eq(strategyRuns.status, "proposed")),
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

async function evaluateAdoptionGate(strategyName: string): Promise<AdoptionGateResult> {
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
