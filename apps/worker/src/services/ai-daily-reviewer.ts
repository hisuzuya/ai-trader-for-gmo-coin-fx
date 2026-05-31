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
} from "@ai-trade/db";
import {
  type AiDailyReviewResponse,
  type AiDailyReviewValidationResult,
  type DailyReviewInput,
  validateAiDailyReview,
} from "@ai-trade/domain/ai-tuning";
import { desc, eq } from "drizzle-orm";

import {
  type AutoApplyInput,
  type AutoApplyResult,
  type DailyReviewDecisionExecutor,
  DbDailyReviewDecisionExecutor,
} from "../pipelines/strategy-evaluation/adoption-runner.js";
import type { ServiceHealth, ServiceState, WorkerService } from "../types.js";

export type { AutoApplyInput, AutoApplyResult, DailyReviewDecisionExecutor };

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
