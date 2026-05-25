import type { DailyReviewRecommendation } from "@ai-trade/domain/ai-tuning";
import { BASELINE_STRATEGIES } from "@ai-trade/domain/strategies";
import { describe, expect, it, vi } from "vitest";
import {
  type AdoptionGateMetrics,
  AiDailyReviewerService,
  type DailyReviewContextProvider,
  type DailyReviewDecisionExecutor,
  type DailyReviewProvider,
  evaluateAdoptionGateSnapshot,
  InMemoryDailyReviewDecisionExecutor,
  InMemoryDailyReviewStore,
} from "./ai-daily-reviewer.js";

describe("AiDailyReviewerService.runOnce auto-apply", () => {
  it("forwards baseline_promotion_candidates and retirement_candidates to the decision executor on accepted review", async () => {
    const decisionExecutor = new InMemoryDailyReviewDecisionExecutor();
    decisionExecutor.result = {
      appliedPromotions: [{ strategyName: "cand_high_pf", strategyRunId: "run-1" }],
      appliedRetirements: [],
      skipped: [{ strategyName: "cand_low_pf", reason: "promote skipped: confidence=low" }],
    };

    const service = buildService({
      review: {
        review_date: "2026-05-25",
        summary: "ok",
        baseline_promotion_candidates: [
          { strategyName: "cand_high_pf", reason: "PF >= 1.5", confidence: "high" },
          { strategyName: "cand_low_pf", reason: "weak", confidence: "low" },
        ] satisfies DailyReviewRecommendation[],
        candidate_retirement_candidates: [
          { strategyName: "cand_dd", reason: "drawdown", confidence: "high" },
        ] satisfies DailyReviewRecommendation[],
        warnings: [],
        next_actions: [],
      },
      decisionExecutor,
    });

    const result = await service.runOnce(new Date("2026-05-25T00:00:00Z"));

    expect(result.reviewStatus).toBe("accepted");
    expect(decisionExecutor.calls).toHaveLength(1);
    expect(decisionExecutor.calls[0]).toMatchObject({
      baselinePromotionCandidates: [
        { strategyName: "cand_high_pf", confidence: "high" },
        { strategyName: "cand_low_pf", confidence: "low" },
      ],
      candidateRetirementCandidates: [{ strategyName: "cand_dd", confidence: "high" }],
    });
    expect(result.autoApply).toEqual(decisionExecutor.result);
  });

  it("does not call the decision executor when the review is rejected", async () => {
    const decisionExecutor = new InMemoryDailyReviewDecisionExecutor();

    const service = buildService({
      review: undefined,
      invocationErrorSummary: "AI did not return a review.",
      decisionExecutor,
    });

    const result = await service.runOnce(new Date("2026-05-25T00:00:00Z"));

    expect(result.reviewStatus).toBe("rejected");
    expect(decisionExecutor.calls).toHaveLength(0);
    expect(result.autoApply).toBeUndefined();
  });

  it("captures executor errors without throwing", async () => {
    const failingExecutor: DailyReviewDecisionExecutor = {
      applyRecommendations: vi.fn().mockRejectedValue(new Error("db down")),
    };

    const service = buildService({
      review: {
        review_date: "2026-05-25",
        summary: "ok",
        baseline_promotion_candidates: [
          { strategyName: "cand_high_pf", reason: "ok", confidence: "high" },
        ] satisfies DailyReviewRecommendation[],
        candidate_retirement_candidates: [],
        warnings: [],
        next_actions: [],
      },
      decisionExecutor: failingExecutor,
    });

    const result = await service.runOnce(new Date("2026-05-25T00:00:00Z"));

    expect(result.reviewStatus).toBe("accepted");
    expect(result.autoApply?.skipped[0]?.reason).toContain("auto-apply failed: db down");
  });
});

describe("InMemoryDailyReviewDecisionExecutor", () => {
  it("returns whatever result is configured", async () => {
    const executor = new InMemoryDailyReviewDecisionExecutor();
    executor.result = {
      appliedPromotions: [{ strategyName: "s", strategyRunId: "r" }],
      appliedRetirements: [],
      skipped: [],
    };
    const result = await executor.applyRecommendations({
      reviewDate: "2026-05-25",
      baselinePromotionCandidates: [],
      candidateRetirementCandidates: [],
    });
    expect(result.appliedPromotions).toEqual([{ strategyName: "s", strategyRunId: "r" }]);
  });
});

describe("evaluateAdoptionGateSnapshot", () => {
  it("accepts a candidate that beats the current baseline without relaxing risk gates", () => {
    const baseline = BASELINE_STRATEGIES["5m"];
    const candidate = {
      ...baseline,
      meta: { ...baseline.meta, name: "candidate_5m_tighter_exit" },
      exit: { ...baseline.exit, take_profit_pips: baseline.exit.take_profit_pips + 1 },
    };
    const metrics: AdoptionGateMetrics = {
      candidate: {
        strategyName: candidate.meta.name,
        accountId: "candidate-account",
        netProfitJpy: 1100,
        tradeCount: 12,
        maxDrawdownPct: 4,
      },
      baseline: {
        strategyName: baseline.meta.name,
        accountId: "baseline-account",
        netProfitJpy: 1000,
        tradeCount: 12,
        maxDrawdownPct: 5,
      },
      minTradeCount: 12,
      profitImprovementPct: 10,
    };

    expect(
      evaluateAdoptionGateSnapshot({
        candidateStrategy: candidate,
        baselineStrategy: baseline,
        metrics,
      }),
    ).toEqual([]);
  });

  it("rejects weak or risk-relaxed candidates", () => {
    const baseline = BASELINE_STRATEGIES["1m"];
    const candidate = {
      ...baseline,
      meta: { ...baseline.meta, name: "candidate_1m_loose_risk" },
      gates: {
        ...baseline.gates,
        volatility: {
          ...baseline.gates.volatility,
          max_spread_pips: baseline.gates.volatility.max_spread_pips + 0.2,
        },
      },
    };
    const metrics: AdoptionGateMetrics = {
      candidate: {
        strategyName: candidate.meta.name,
        accountId: "candidate-account",
        netProfitJpy: 1010,
        tradeCount: 5,
        maxDrawdownPct: 20,
      },
      baseline: {
        strategyName: baseline.meta.name,
        accountId: "baseline-account",
        netProfitJpy: 1000,
        tradeCount: 20,
        maxDrawdownPct: 5,
      },
      minTradeCount: 20,
      profitImprovementPct: 1,
    };

    expect(
      evaluateAdoptionGateSnapshot({
        candidateStrategy: candidate,
        baselineStrategy: baseline,
        metrics,
      }),
    ).toEqual(
      expect.arrayContaining([
        "candidate trade_count 5 is below minimum 20",
        "candidate relaxes max_spread_pips",
      ]),
    );
  });
});

type BuildServiceArgs = {
  review:
    | {
        review_date: string;
        summary: string;
        baseline_promotion_candidates: DailyReviewRecommendation[];
        candidate_retirement_candidates: DailyReviewRecommendation[];
        warnings: never[];
        next_actions: string[];
      }
    | undefined;
  invocationErrorSummary?: string;
  decisionExecutor: DailyReviewDecisionExecutor;
};

function buildService({
  review,
  invocationErrorSummary,
  decisionExecutor,
}: BuildServiceArgs): AiDailyReviewerService {
  const aiProvider: DailyReviewProvider = {
    generateDailyReview: vi.fn().mockResolvedValue({
      invocation: {
        id: "9b1c8a2e-1234-4d6f-9c1a-1234567890ab",
        provider: "claude_cli",
        status: review ? "succeeded" : "failed",
        promptHash: "hash",
        promptRedacted: "{}",
        timeoutMs: 180000,
        startedAt: "2026-05-25T00:00:00.000Z",
        finishedAt: "2026-05-25T00:00:01.000Z",
        errorSummary: invocationErrorSummary,
      },
      review,
    }),
  };

  const contextProvider: DailyReviewContextProvider = {
    buildInput: vi.fn().mockResolvedValue({
      reviewDate: "2026-05-25",
      timezone: "Asia/Tokyo",
      accountSummaries: [],
      candidateSummaries: [],
      warningSignals: [],
      operationsContext: {
        liveTradingEnabled: false,
        backupStatus: "unknown",
        restoreRehearsalStatus: "unknown",
      },
    }),
  };

  return new AiDailyReviewerService({
    enabled: true,
    intervalMs: null,
    aiProvider,
    contextProvider,
    store: new InMemoryDailyReviewStore(),
    decisionExecutor,
  });
}
