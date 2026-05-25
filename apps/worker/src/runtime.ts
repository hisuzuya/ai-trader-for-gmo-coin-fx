import {
  aiDailyReviews,
  aiTuningProposals,
  CandleRepository,
  checkDbConnection,
  DbJobRunRecorder,
  db,
  type JobRunRecorder,
  paperAccounts,
  paperPositions,
  paperTrades,
  type RecentCandle,
  runRecordedJob,
  strategyRuns,
} from "@ai-trade/db";
import { and, desc, eq } from "drizzle-orm";
import {
  type HistoricalImporter,
  type HistoricalImportResult,
  StubHistoricalImporter,
} from "./jobs/historical-importer.js";
import type { AiDailyReviewerService, DailyReviewRunResult } from "./services/ai-daily-reviewer.js";
import type { AiTunerService, AiTuningRunResult } from "./services/ai-tuner.js";
import type { ServiceHealth, WorkerService, WorkerStatus } from "./types.js";

export interface CandleReader {
  getRecent(input: {
    symbol: string;
    timeframe: string;
    priceType: "bid" | "ask" | "mid";
    limit: number;
  }): Promise<RecentCandle[]>;
}

export class WorkerRuntime {
  private readonly startedAt = new Date();
  private started = false;

  constructor(
    private readonly services: WorkerService[],
    private readonly historicalImporter: HistoricalImporter = new StubHistoricalImporter(),
    private readonly jobRunRecorder: JobRunRecorder = new DbJobRunRecorder(),
    private readonly candleReader: CandleReader = new CandleRepository(),
  ) {}

  async start(): Promise<void> {
    if (this.started) {
      return;
    }

    for (const service of this.services) {
      await service.start();
    }

    this.started = true;
  }

  async stop(): Promise<void> {
    for (const service of [...this.services].reverse()) {
      await service.stop();
    }

    this.started = false;
  }

  async health(): Promise<{ ok: true; service: "worker"; timestamp: string }> {
    return {
      ok: true,
      service: "worker",
      timestamp: new Date().toISOString(),
    };
  }

  async ready(): Promise<{
    ok: boolean;
    checks: {
      db: boolean;
      collector: boolean;
      scheduler: boolean;
      claudeCliProvider: boolean;
    };
  }> {
    const services = await this.serviceHealth();
    const db = await checkDbConnection().catch(() => false);
    const collector = services.some(
      (service) => service.name === "collector" && service.state === "ready",
    );

    const checks = {
      db,
      collector,
      scheduler: this.started,
      claudeCliProvider: true,
    };

    return {
      ok: Object.values(checks).every(Boolean),
      checks,
    };
  }

  async status(): Promise<WorkerStatus> {
    const services = await this.serviceHealth();
    const collector = services.find((service) => service.name === "collector");
    const paperTrader = services.find((service) => service.name === "paper-trader");

    return {
      startedAt: this.startedAt.toISOString(),
      services,
      latestTickerTimestamp: detailString(collector, "latestTickerTimestamp"),
      latestCandleOpenedAt:
        detailString(collector, "latestCandleOpenedAt") ??
        detailString(paperTrader, "latestCandleOpenedAt"),
      websocketConnected: detailBoolean(collector, "websocketConnected"),
      lastReconnectReason: detailString(collector, "lastReconnectReason"),
      lastAiInvocationStatus: detailAiInvocationStatus(services),
    };
  }

  async runAiTuning(): Promise<AiTuningRunResult> {
    const aiTuner = this.services.find(isAiTunerService);

    if (!aiTuner) {
      throw new Error("AI tuner service is not registered.");
    }

    return aiTuner.runOnce();
  }

  async runDailyReview(): Promise<DailyReviewRunResult> {
    const dailyReviewer = this.services.find(isAiDailyReviewerService);

    if (!dailyReviewer) {
      throw new Error("AI daily reviewer service is not registered.");
    }

    return dailyReviewer.runOnce();
  }

  async dashboardSummary(options: { accountName?: string } = {}): Promise<WorkerDashboardSummary> {
    const [accounts, candidates, dailyReviews] = await Promise.all([
      db
        .select({
          id: paperAccounts.id,
          strategyRunId: paperAccounts.strategyRunId,
          name: paperAccounts.name,
          balanceJpy: paperAccounts.balanceJpy,
          initialBalanceJpy: paperAccounts.initialBalanceJpy,
          status: paperAccounts.status,
          updatedAt: paperAccounts.updatedAt,
        })
        .from(paperAccounts)
        .orderBy(desc(paperAccounts.updatedAt))
        .limit(20),
      db
        .select({
          id: aiTuningProposals.id,
          sourceStrategyName: aiTuningProposals.sourceStrategyName,
          candidateStrategyName: aiTuningProposals.candidateStrategyName,
          status: aiTuningProposals.status,
          strategyRunStatus: strategyRuns.status,
          timeframe: aiTuningProposals.timeframe,
          createdAt: aiTuningProposals.createdAt,
        })
        .from(aiTuningProposals)
        .leftJoin(strategyRuns, eq(strategyRuns.id, aiTuningProposals.id))
        .where(eq(aiTuningProposals.insertedIntoPaper, true))
        .orderBy(desc(aiTuningProposals.createdAt))
        .limit(6),
      db
        .select({
          reviewDate: aiDailyReviews.reviewDate,
          status: aiDailyReviews.status,
          summary: aiDailyReviews.summary,
          baselinePromotionCandidates: aiDailyReviews.baselinePromotionCandidates,
          candidateRetirementCandidates: aiDailyReviews.candidateRetirementCandidates,
          warnings: aiDailyReviews.warnings,
          nextActions: aiDailyReviews.nextActions,
          createdAt: aiDailyReviews.createdAt,
        })
        .from(aiDailyReviews)
        .orderBy(desc(aiDailyReviews.createdAt))
        .limit(3),
    ]);

    const selectedAccount =
      options.accountName !== undefined
        ? (accounts.find((account) => account.name === options.accountName) ?? null)
        : null;

    const trades = await (selectedAccount
      ? db
          .select({
            symbol: paperTrades.symbol,
            side: paperTrades.side,
            pnlJpy: paperTrades.pnlJpy,
            closedAt: paperTrades.closedAt,
          })
          .from(paperTrades)
          .where(eq(paperTrades.accountId, selectedAccount.id))
          .orderBy(desc(paperTrades.closedAt))
          .limit(20)
      : db
          .select({
            symbol: paperTrades.symbol,
            side: paperTrades.side,
            pnlJpy: paperTrades.pnlJpy,
            closedAt: paperTrades.closedAt,
          })
          .from(paperTrades)
          .orderBy(desc(paperTrades.closedAt))
          .limit(6));

    const accountDetail = selectedAccount ? await this.loadAccountDetail(selectedAccount) : null;

    return {
      selectedAccountName: selectedAccount?.name ?? null,
      accounts: accounts.map((account) => ({
        name: account.name,
        balanceJpy: account.balanceJpy,
        status: account.status,
        updatedAt: account.updatedAt.toISOString(),
      })),
      trades: trades.map((trade) => ({
        ...trade,
        closedAt: trade.closedAt.toISOString(),
      })),
      candidates: candidates.map((candidate) => ({
        ...candidate,
        createdAt: candidate.createdAt.toISOString(),
      })),
      dailyReviews: dailyReviews.map((review) => ({
        ...review,
        createdAt: review.createdAt.toISOString(),
      })),
      accountDetail,
    };
  }

  private async loadAccountDetail(account: {
    id: string;
    strategyRunId: string | null;
    name: string;
    balanceJpy: string;
    initialBalanceJpy: string;
  }): Promise<AccountDetail> {
    const [openPositions, strategyRun] = await Promise.all([
      db
        .select({
          symbol: paperPositions.symbol,
          side: paperPositions.side,
          quantity: paperPositions.quantity,
          entryPrice: paperPositions.entryPrice,
          stopLossPrice: paperPositions.stopLossPrice,
          takeProfitPrice: paperPositions.takeProfitPrice,
          openedAt: paperPositions.openedAt,
          bestPriceSinceOpen: paperPositions.bestPriceSinceOpen,
          spreadPips: paperPositions.spreadPips,
        })
        .from(paperPositions)
        .where(and(eq(paperPositions.accountId, account.id), eq(paperPositions.status, "open")))
        .orderBy(desc(paperPositions.openedAt))
        .limit(5),
      account.strategyRunId
        ? db
            .select({
              id: strategyRuns.id,
              strategyName: strategyRuns.strategyName,
              symbol: strategyRuns.symbol,
              timeframe: strategyRuns.timeframe,
              status: strategyRuns.status,
              strategyDefinition: strategyRuns.strategyDefinition,
              startedAt: strategyRuns.startedAt,
            })
            .from(strategyRuns)
            .where(eq(strategyRuns.id, account.strategyRunId))
            .limit(1)
        : Promise.resolve([] as AccountStrategyRow[]),
    ]);

    return {
      name: account.name,
      balanceJpy: account.balanceJpy,
      initialBalanceJpy: account.initialBalanceJpy,
      openPositions: openPositions.map((position) => ({
        symbol: position.symbol,
        side: position.side,
        quantity: position.quantity,
        entryPrice: position.entryPrice,
        stopLossPrice: position.stopLossPrice,
        takeProfitPrice: position.takeProfitPrice,
        bestPriceSinceOpen: position.bestPriceSinceOpen,
        spreadPips: position.spreadPips,
        openedAt: position.openedAt.toISOString(),
      })),
      strategyRun: strategyRun[0]
        ? {
            id: strategyRun[0].id,
            strategyName: strategyRun[0].strategyName,
            symbol: strategyRun[0].symbol,
            timeframe: strategyRun[0].timeframe,
            status: strategyRun[0].status,
            startedAt: strategyRun[0].startedAt.toISOString(),
            strategyDefinition: strategyRun[0].strategyDefinition,
          }
        : null,
    };
  }

  async recentCandles(input: RecentCandlesQuery): Promise<RecentCandlesResponse> {
    const candles = await this.candleReader.getRecent({
      symbol: input.symbol,
      timeframe: input.timeframe,
      priceType: input.priceType,
      limit: input.limit,
    });

    return {
      symbol: input.symbol,
      timeframe: input.timeframe,
      priceType: input.priceType,
      candles: candles.map((candle) => ({
        openedAt: candle.openedAt.toISOString(),
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
      })),
    };
  }

  async runHistoricalImport(date: string): Promise<{
    jobRunId: string;
    result: HistoricalImportResult;
  }> {
    return runRecordedJob(this.jobRunRecorder, "historical-import", { date }, () =>
      this.historicalImporter.importDate({ date }),
    );
  }

  async recordPaperDecision(input: {
    strategyRunId: string;
    action: "promote_baseline" | "retire_candidate";
  }): Promise<PaperDecisionResult> {
    const status = input.action === "promote_baseline" ? "promoted_to_baseline" : "retired";
    const now = new Date();

    return db.transaction(async (tx) => {
      const updatedRuns = await tx
        .update(strategyRuns)
        .set({
          status,
          finishedAt: now,
          metadata: {
            manualPaperDecision: input.action,
            decidedAt: now.toISOString(),
          },
        })
        .where(and(eq(strategyRuns.id, input.strategyRunId), eq(strategyRuns.status, "proposed")))
        .returning({
          id: strategyRuns.id,
          strategyName: strategyRuns.strategyName,
          status: strategyRuns.status,
        });

      const updatedRun = updatedRuns[0];

      if (!updatedRun) {
        return {
          ok: false,
          strategyRunId: input.strategyRunId,
          action: input.action,
          reason: "Strategy run was not found or is no longer proposed.",
        };
      }

      if (input.action === "retire_candidate") {
        await tx
          .update(paperAccounts)
          .set({
            status: "stopped",
            updatedAt: now,
          })
          .where(eq(paperAccounts.strategyRunId, input.strategyRunId));
      }

      return {
        ok: true,
        strategyRunId: updatedRun.id,
        strategyName: updatedRun.strategyName,
        action: input.action,
        status,
      };
    });
  }

  private async serviceHealth(): Promise<ServiceHealth[]> {
    return Promise.all(this.services.map((service) => service.health()));
  }
}

export type WorkerDashboardSummary = {
  selectedAccountName: string | null;
  accounts: {
    name: string;
    balanceJpy: string;
    status: string;
    updatedAt: string;
  }[];
  trades: {
    symbol: string;
    side: string;
    pnlJpy: string;
    closedAt: string;
  }[];
  candidates: {
    sourceStrategyName: string;
    candidateStrategyName: string | null;
    status: string;
    strategyRunStatus: string | null;
    timeframe: string;
    createdAt: string;
  }[];
  dailyReviews: {
    reviewDate: string;
    status: string;
    summary: string | null;
    baselinePromotionCandidates: unknown;
    candidateRetirementCandidates: unknown;
    warnings: unknown;
    nextActions: unknown;
    createdAt: string;
  }[];
  accountDetail: AccountDetail | null;
};

export type AccountDetail = {
  name: string;
  balanceJpy: string;
  initialBalanceJpy: string;
  openPositions: {
    symbol: string;
    side: string;
    quantity: string;
    entryPrice: string;
    stopLossPrice: string;
    takeProfitPrice: string;
    bestPriceSinceOpen: string;
    spreadPips: string;
    openedAt: string;
  }[];
  strategyRun: {
    id: string;
    strategyName: string;
    symbol: string;
    timeframe: string;
    status: string;
    startedAt: string;
    strategyDefinition: unknown;
  } | null;
};

type AccountStrategyRow = {
  id: string;
  strategyName: string;
  symbol: string;
  timeframe: string;
  status: string;
  strategyDefinition: unknown;
  startedAt: Date;
};

export type RecentCandlesQuery = {
  symbol: string;
  timeframe: string;
  priceType: "bid" | "ask" | "mid";
  limit: number;
};

export type RecentCandlesResponse = {
  symbol: string;
  timeframe: string;
  priceType: "bid" | "ask" | "mid";
  candles: {
    openedAt: string;
    open: number;
    high: number;
    low: number;
    close: number;
  }[];
};

export type PaperDecisionResult =
  | {
      ok: true;
      strategyRunId: string;
      strategyName: string;
      action: "promote_baseline" | "retire_candidate";
      status: "promoted_to_baseline" | "retired";
    }
  | {
      ok: false;
      strategyRunId: string;
      action: "promote_baseline" | "retire_candidate";
      reason: string;
    };

function detailString(service: ServiceHealth | undefined, key: string): string | null {
  const value = service?.details?.[key];
  return typeof value === "string" ? value : null;
}

function detailBoolean(service: ServiceHealth | undefined, key: string): boolean {
  return service?.details?.[key] === true;
}

function detailAiInvocationStatus(services: ServiceHealth[]): string | null {
  const aiTuner = services.find((service) => service.name === "ai-tuner");
  const latestResult = aiTuner?.details?.latestResult;

  if (
    typeof latestResult === "object" &&
    latestResult !== null &&
    "proposalStatus" in latestResult &&
    typeof latestResult.proposalStatus === "string"
  ) {
    return latestResult.proposalStatus;
  }

  return null;
}

function isAiTunerService(service: WorkerService): service is AiTunerService {
  return service.name === "ai-tuner" && "runOnce" in service;
}

function isAiDailyReviewerService(service: WorkerService): service is AiDailyReviewerService {
  return service.name === "ai-daily-reviewer" && "runOnce" in service;
}
