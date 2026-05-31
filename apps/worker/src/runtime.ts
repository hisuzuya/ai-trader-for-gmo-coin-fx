import {
  aiAgentObservations,
  aiAgentRuns,
  aiAgentStrategyProposals,
  aiAgents,
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
import { and, desc, eq, gte, sql } from "drizzle-orm";
import type { AgentScheduler } from "./pipelines/agent-evaluation/scheduler.js";
import {
  type HistoricalImporter,
  type HistoricalImportResult,
  StubHistoricalImporter,
} from "./pipelines/market-data/historical-importer.js";
import type {
  AgentPromptOptimizerService,
  PromptOptimizerRunResult,
} from "./services/agent-prompt-optimizer.js";
import type { AiDailyReviewerService, DailyReviewRunResult } from "./services/ai-daily-reviewer.js";
import type { AiTunerService, AiTuningRunResult } from "./services/ai-tuner.js";
import type { SkillCuratorRunResult, SkillCuratorService } from "./services/skill-curator.js";
import type { ServiceHealth, WorkerService, WorkerStatus } from "./types.js";

export interface CandleReader {
  getRecent(input: {
    symbol: string;
    timeframe: string;
    priceType: "bid" | "ask" | "mid";
    limit: number;
    before?: Date;
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
    const scheduler = this.services.find(isAgentScheduler);

    if (scheduler) {
      const result = await scheduler.runOnce();
      return {
        attemptedAt: result.startedAt,
        sourceStrategyName: "agent-pipeline",
        invocationStatus:
          result.status === "timeout" ? "timeout" : result.ok ? "succeeded" : "failed",
        proposalStatus: result.ok ? "accepted" : "failed",
        candidateStrategyName: firstStrategyProposalName(result.output),
        reason: result.error ?? "Agent pipeline completed.",
      };
    }

    const aiTuner = this.services.find(isAiTunerService);

    if (!aiTuner) {
      throw new Error("AI tuner service is not registered.");
    }

    return aiTuner.runOnce();
  }

  async runDailyReview(): Promise<DailyReviewRunResult> {
    const scheduler = this.services.find(isAgentScheduler);

    if (scheduler) {
      const results = await scheduler.runAll();
      const acceptedReviews = results.flatMap((result) => result.output?.candidateReviews ?? []);
      return {
        attemptedAt: new Date().toISOString(),
        reviewDate: toTokyoDate(new Date()),
        invocationStatus: results.some((result) => result.status === "timeout")
          ? "timeout"
          : results.every((result) => result.ok)
            ? "succeeded"
            : "failed",
        reviewStatus: results.every((result) => result.ok) ? "accepted" : "failed",
        warningCount: results.filter((result) => !result.ok).length,
        promotionCandidateCount: acceptedReviews.filter(
          (review) => review.recommendation === "promote",
        ).length,
        retirementCandidateCount: acceptedReviews.filter(
          (review) => review.recommendation === "retire",
        ).length,
        reason: `Agent pipeline reviewed ${acceptedReviews.length} candidate decisions across ${results.length} agents.`,
      };
    }

    const dailyReviewer = this.services.find(isAiDailyReviewerService);

    if (!dailyReviewer) {
      throw new Error("AI daily reviewer service is not registered.");
    }

    return dailyReviewer.runOnce();
  }

  async runPromptOptimization(): Promise<PromptOptimizerRunResult> {
    const optimizer = this.services.find(isAgentPromptOptimizerService);

    if (!optimizer) {
      throw new Error("Agent prompt optimizer service is not registered.");
    }

    return optimizer.runOnce();
  }

  async runSkillCuration(): Promise<SkillCuratorRunResult> {
    const curator = this.services.find(isSkillCuratorService);

    if (!curator) {
      throw new Error("Skill curator service is not registered.");
    }

    return curator.runOnce();
  }

  async listAgents() {
    const scheduler = this.services.find(isAgentScheduler);

    if (!scheduler) {
      throw new Error("Agent scheduler service is not registered.");
    }

    return scheduler.listAgentSummaries();
  }

  async getAgentDetail(agentId: string) {
    const scheduler = this.services.find(isAgentScheduler);

    if (!scheduler) {
      throw new Error("Agent scheduler service is not registered.");
    }

    return scheduler.getAgentDetail(agentId);
  }

  async runAgent(agentId?: string) {
    const scheduler = this.services.find(isAgentScheduler);

    if (!scheduler) {
      throw new Error("Agent scheduler service is not registered.");
    }

    return scheduler.runOnce(agentId);
  }

  async runAllAgents() {
    const scheduler = this.services.find(isAgentScheduler);

    if (!scheduler) {
      throw new Error("Agent scheduler service is not registered.");
    }

    return scheduler.runAll();
  }

  async createAgentVersion(input: {
    agentId: string;
    systemPrompt: string;
    allowedTools: string[];
    note?: string;
  }) {
    const scheduler = this.services.find(isAgentScheduler);

    if (!scheduler) {
      throw new Error("Agent scheduler service is not registered.");
    }

    return scheduler.createVersion(input);
  }

  async rollbackAgentVersion(input: { agentId: string; sourceVersion: number; note?: string }) {
    const scheduler = this.services.find(isAgentScheduler);

    if (!scheduler) {
      throw new Error("Agent scheduler service is not registered.");
    }

    return scheduler.rollbackVersion(input);
  }

  async deleteAgentMemory(input: { agentId: string; memoryId: string }) {
    const scheduler = this.services.find(isAgentScheduler);

    if (!scheduler) {
      throw new Error("Agent scheduler service is not registered.");
    }

    return scheduler.deleteMemory(input);
  }

  async createAgent(input: Parameters<AgentScheduler["createAgent"]>[0]) {
    const scheduler = this.services.find(isAgentScheduler);

    if (!scheduler) {
      throw new Error("Agent scheduler service is not registered.");
    }

    return scheduler.createAgent(input);
  }

  async deleteAgent(input: Parameters<AgentScheduler["deleteAgent"]>[0]) {
    const scheduler = this.services.find(isAgentScheduler);

    if (!scheduler) {
      throw new Error("Agent scheduler service is not registered.");
    }

    return scheduler.deleteAgent(input);
  }

  async updateAgentSettings(input: Parameters<AgentScheduler["updateAgentSettings"]>[0]) {
    const scheduler = this.services.find(isAgentScheduler);

    if (!scheduler) {
      throw new Error("Agent scheduler service is not registered.");
    }

    return scheduler.updateAgentSettings(input);
  }

  async listAgentProposals(filter: Parameters<AgentScheduler["listProposals"]>[0]) {
    const scheduler = this.services.find(isAgentScheduler);

    if (!scheduler) {
      throw new Error("Agent scheduler service is not registered.");
    }

    return scheduler.listProposals(filter);
  }

  async listAgentRuns(filter: Parameters<AgentScheduler["listRuns"]>[0]) {
    const scheduler = this.services.find(isAgentScheduler);

    if (!scheduler) {
      throw new Error("Agent scheduler service is not registered.");
    }

    return scheduler.listRuns(filter);
  }

  async dashboardSummary(options: { accountName?: string } = {}): Promise<WorkerDashboardSummary> {
    const calendarFromDate = new Date();
    calendarFromDate.setUTCHours(0, 0, 0, 0);
    calendarFromDate.setUTCDate(calendarFromDate.getUTCDate() - 120);

    const [accounts, candidates, dailyReviews, dailyPnlRows, dailyAgentPnlRows] = await Promise.all(
      [
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
        db
          .select({
            date: sql<string>`to_char(${paperTrades.closedAt} AT TIME ZONE 'Asia/Tokyo', 'YYYY-MM-DD')`,
            pnlJpy: sql<string>`COALESCE(SUM(${paperTrades.pnlJpy}), 0)`,
            tradeCount: sql<number>`COUNT(*)::int`,
            winCount: sql<number>`COUNT(*) FILTER (WHERE ${paperTrades.pnlJpy} > 0)::int`,
          })
          .from(paperTrades)
          .where(gte(paperTrades.closedAt, calendarFromDate))
          .groupBy(sql`to_char(${paperTrades.closedAt} AT TIME ZONE 'Asia/Tokyo', 'YYYY-MM-DD')`)
          .orderBy(
            sql`to_char(${paperTrades.closedAt} AT TIME ZONE 'Asia/Tokyo', 'YYYY-MM-DD') DESC`,
          ),
        db
          .select({
            date: sql<string>`to_char(${paperTrades.closedAt} AT TIME ZONE 'Asia/Tokyo', 'YYYY-MM-DD')`,
            accountId: paperAccounts.id,
            accountName: paperAccounts.name,
            agentId: aiAgents.id,
            agentName: aiAgents.name,
            characterId: aiAgents.characterId,
            pnlJpy: sql<string>`COALESCE(SUM(${paperTrades.pnlJpy}), 0)`,
            tradeCount: sql<number>`COUNT(*)::int`,
            winCount: sql<number>`COUNT(*) FILTER (WHERE ${paperTrades.pnlJpy} > 0)::int`,
          })
          .from(paperTrades)
          .innerJoin(paperAccounts, eq(paperAccounts.id, paperTrades.accountId))
          .leftJoin(aiAgents, eq(aiAgents.id, paperAccounts.agentId))
          .where(gte(paperTrades.closedAt, calendarFromDate))
          .groupBy(
            sql`to_char(${paperTrades.closedAt} AT TIME ZONE 'Asia/Tokyo', 'YYYY-MM-DD')`,
            paperAccounts.id,
            paperAccounts.name,
            aiAgents.id,
            aiAgents.name,
            aiAgents.characterId,
          ),
      ],
    );

    // -- All open positions (across crew) with agent info ---------------------
    const openPositionRows = await db
      .select({
        id: paperPositions.id,
        accountId: paperPositions.accountId,
        accountName: paperAccounts.name,
        agentId: aiAgents.id,
        agentName: aiAgents.name,
        characterId: aiAgents.characterId,
        symbol: paperPositions.symbol,
        side: paperPositions.side,
        quantity: paperPositions.quantity,
        entryPrice: paperPositions.entryPrice,
        stopLossPrice: paperPositions.stopLossPrice,
        takeProfitPrice: paperPositions.takeProfitPrice,
        bestPriceSinceOpen: paperPositions.bestPriceSinceOpen,
        spreadPips: paperPositions.spreadPips,
        openedAt: paperPositions.openedAt,
      })
      .from(paperPositions)
      .innerJoin(paperAccounts, eq(paperAccounts.id, paperPositions.accountId))
      .leftJoin(aiAgents, eq(aiAgents.id, paperAccounts.agentId))
      .where(eq(paperPositions.status, "open"))
      .orderBy(desc(paperPositions.openedAt));

    // -- Latest mid price per symbol for unrealized PnL calc -------------------
    const distinctSymbols = Array.from(new Set(openPositionRows.map((p) => p.symbol)));
    const symbolPriceMap = new Map<string, number>();
    await Promise.all(
      distinctSymbols.map(async (symbol) => {
        const candles = await this.candleReader.getRecent({
          symbol,
          timeframe: "1m",
          priceType: "mid",
          limit: 1,
        });
        const latest = candles[candles.length - 1];
        if (latest) symbolPriceMap.set(symbol, latest.close);
      }),
    );

    const openPositions: OpenPositionRow[] = openPositionRows.map((p) => {
      const current = symbolPriceMap.get(p.symbol) ?? null;
      const entry = Number(p.entryPrice);
      const qty = Number(p.quantity);
      const unrealized =
        current !== null
          ? Math.round((p.side === "long" ? current - entry : entry - current) * qty)
          : null;
      return {
        id: p.id,
        accountId: p.accountId,
        accountName: p.accountName,
        agentId: p.agentId,
        agentName: p.agentName,
        characterId: p.characterId,
        symbol: p.symbol,
        side: p.side,
        quantity: p.quantity,
        entryPrice: p.entryPrice,
        stopLossPrice: p.stopLossPrice,
        takeProfitPrice: p.takeProfitPrice,
        bestPriceSinceOpen: p.bestPriceSinceOpen,
        spreadPips: p.spreadPips,
        currentPrice: current !== null ? current.toFixed(6) : null,
        unrealizedPnlJpy: unrealized !== null ? unrealized.toString() : null,
        openedAt: p.openedAt.toISOString(),
      };
    });

    // -- Per-agent briefings (latest thinking + today PnL + daily FB) ---------
    const agentRows = await db
      .select({
        id: aiAgents.id,
        name: aiAgents.name,
        status: aiAgents.status,
        characterId: aiAgents.characterId,
      })
      .from(aiAgents);

    const todayJst = sql<string>`to_char(now() AT TIME ZONE 'Asia/Tokyo', 'YYYY-MM-DD')`;
    const latestReviewSummary = dailyReviews[0]?.summary ?? null;

    const agentBriefings: AgentBriefingRow[] = await Promise.all(
      agentRows.map(async (agent) => {
        const [latestRunRows, todayTradeRows] = await Promise.all([
          db
            .select({
              id: aiAgentRuns.id,
              startedAt: aiAgentRuns.startedAt,
              finishedAt: aiAgentRuns.finishedAt,
              status: aiAgentRuns.status,
            })
            .from(aiAgentRuns)
            .where(eq(aiAgentRuns.agentId, agent.id))
            .orderBy(desc(aiAgentRuns.startedAt))
            .limit(1),
          db
            .select({
              pnlJpy: paperTrades.pnlJpy,
            })
            .from(paperTrades)
            .innerJoin(paperAccounts, eq(paperAccounts.id, paperTrades.accountId))
            .where(
              and(
                eq(paperAccounts.agentId, agent.id),
                sql`to_char(${paperTrades.closedAt} AT TIME ZONE 'Asia/Tokyo', 'YYYY-MM-DD') = ${todayJst}`,
              ),
            ),
        ]);

        const latestRunRow = latestRunRows[0] ?? null;
        let observations: { kind: string; summary: string; tags: string[] }[] = [];
        let proposals: { strategyName: string; validationStatus: string }[] = [];

        if (latestRunRow) {
          const [observationRows, proposalRows] = await Promise.all([
            db
              .select({
                kind: aiAgentObservations.kind,
                summary: aiAgentObservations.summary,
                tags: aiAgentObservations.tags,
              })
              .from(aiAgentObservations)
              .where(eq(aiAgentObservations.runId, latestRunRow.id))
              .limit(5),
            db
              .select({
                strategyName: aiAgentStrategyProposals.strategyName,
                validationStatus: aiAgentStrategyProposals.validationStatus,
              })
              .from(aiAgentStrategyProposals)
              .where(eq(aiAgentStrategyProposals.runId, latestRunRow.id))
              .limit(5),
          ]);
          observations = observationRows.map((row) => ({
            kind: row.kind,
            summary: row.summary,
            tags: row.tags ?? [],
          }));
          proposals = proposalRows.map((row) => ({
            strategyName: row.strategyName,
            validationStatus: row.validationStatus,
          }));
        }

        const todayRealizedPnl = todayTradeRows.reduce((sum, row) => sum + Number(row.pnlJpy), 0);
        const todayTradeCount = todayTradeRows.length;
        const todayWinCount = todayTradeRows.filter((row) => Number(row.pnlJpy) > 0).length;
        const agentOpenPositions = openPositions.filter((p) => p.agentId === agent.id);
        const todayUnrealizedPnl = agentOpenPositions.reduce(
          (sum, p) => sum + (p.unrealizedPnlJpy !== null ? Number(p.unrealizedPnlJpy) : 0),
          0,
        );

        return {
          agentId: agent.id,
          agentName: agent.name,
          characterId: agent.characterId,
          status: agent.status,
          todayRealizedPnlJpy: todayRealizedPnl.toString(),
          todayUnrealizedPnlJpy: todayUnrealizedPnl.toString(),
          todayTradeCount,
          todayWinCount,
          openPositionCount: agentOpenPositions.length,
          latestRun: latestRunRow
            ? {
                id: latestRunRow.id,
                startedAt: latestRunRow.startedAt.toISOString(),
                finishedAt: latestRunRow.finishedAt?.toISOString() ?? null,
                status: latestRunRow.status,
                observations,
                proposals,
              }
            : null,
          dailyFeedback: latestReviewSummary,
        };
      }),
    );

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
      dailyPnl: dailyPnlRows.map((row) => {
        const accounts = dailyAgentPnlRows
          .filter((r) => r.date === row.date)
          .map((r) => ({
            accountId: r.accountId,
            accountName: r.accountName,
            agentId: r.agentId,
            agentName: r.agentName,
            characterId: r.characterId,
            pnlJpy: r.pnlJpy,
            tradeCount: r.tradeCount,
            winCount: r.winCount,
          }))
          .sort((a, b) => Number(b.pnlJpy) - Number(a.pnlJpy));
        return {
          date: row.date,
          pnlJpy: row.pnlJpy,
          tradeCount: row.tradeCount,
          winCount: row.winCount,
          accounts,
        };
      }),
      openPositions,
      agentBriefings,
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
      before: input.before,
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
  dailyPnl: {
    date: string;
    pnlJpy: string;
    tradeCount: number;
    winCount: number;
    accounts: {
      accountId: string;
      accountName: string;
      agentId: string | null;
      agentName: string | null;
      characterId: string | null;
      pnlJpy: string;
      tradeCount: number;
      winCount: number;
    }[];
  }[];
  openPositions: OpenPositionRow[];
  agentBriefings: AgentBriefingRow[];
  accountDetail: AccountDetail | null;
};

export type OpenPositionRow = {
  id: string;
  accountId: string;
  accountName: string;
  agentId: string | null;
  agentName: string | null;
  characterId: string | null;
  symbol: string;
  side: "long" | "short";
  quantity: string;
  entryPrice: string;
  stopLossPrice: string;
  takeProfitPrice: string;
  bestPriceSinceOpen: string;
  spreadPips: string;
  currentPrice: string | null;
  unrealizedPnlJpy: string | null;
  openedAt: string;
};

export type AgentBriefingRow = {
  agentId: string;
  agentName: string;
  characterId: string | null;
  status: string;
  todayRealizedPnlJpy: string;
  todayUnrealizedPnlJpy: string;
  todayTradeCount: number;
  todayWinCount: number;
  openPositionCount: number;
  latestRun: {
    id: string;
    startedAt: string;
    finishedAt: string | null;
    status: string;
    observations: {
      kind: string;
      summary: string;
      tags: string[];
    }[];
    proposals: {
      strategyName: string;
      validationStatus: string;
    }[];
  } | null;
  dailyFeedback: string | null;
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
  before?: Date;
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
  const agentScheduler = services.find((service) => service.name === "agent-scheduler");
  const latestAgentResult = agentScheduler?.details?.latestResult;

  if (
    typeof latestAgentResult === "object" &&
    latestAgentResult !== null &&
    "status" in latestAgentResult &&
    typeof latestAgentResult.status === "string"
  ) {
    return latestAgentResult.status;
  }

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

function isAgentScheduler(service: WorkerService): service is AgentScheduler {
  return (
    service.name === "agent-scheduler" &&
    "listAgentSummaries" in service &&
    "getAgentDetail" in service &&
    "runOnce" in service &&
    "runAll" in service
  );
}

function isAgentPromptOptimizerService(
  service: WorkerService,
): service is AgentPromptOptimizerService {
  return service.name === "agent-prompt-optimizer" && "runOnce" in service;
}

function isSkillCuratorService(service: WorkerService): service is SkillCuratorService {
  return service.name === "skill-curator" && "runOnce" in service;
}

function firstStrategyProposalName(
  output: { strategyProposals?: { strategy?: { meta?: { name?: string } } }[] } | undefined,
) {
  return output?.strategyProposals?.[0]?.strategy?.meta?.name ?? null;
}

function toTokyoDate(date: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}
