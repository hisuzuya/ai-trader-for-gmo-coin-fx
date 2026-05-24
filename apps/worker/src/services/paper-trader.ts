import { createHash } from "node:crypto";

import {
  candles,
  db,
  paperAccounts,
  paperOrders,
  paperPositions,
  paperTrades,
  strategyRuns,
  toPaperAccountInsertRow,
  toPaperOrderInsertRow,
  toPaperPositionInsertRow,
  toPaperTradeInsertRow,
} from "@ai-trade/db";
import type { CandleTimeframe, CanonicalCandle, MarketSymbol } from "@ai-trade/domain/market-data";
import {
  createPaperAccountState,
  executePaperTradingStep,
  type PaperAccountState,
  type PaperCandleSet,
  type PaperPositionState,
  type PaperTradeSignal,
  type PaperTradingStepResult,
} from "@ai-trade/domain/paper-trading";
import { baselineStrategies, type StrategyDefinition } from "@ai-trade/domain/strategies";
import { and, desc, eq, sql } from "drizzle-orm";

import type { ServiceHealth, ServiceState, WorkerService } from "../types.js";

const DEFAULT_SPREAD_PIPS = 0.3;

export type PaperStrategyDecision = {
  action: PaperTradeSignal;
  reason: string;
};

export type PaperStrategyStatusState = "waiting_for_data" | "evaluated" | "disabled" | "failed";

export type PaperStrategyStatus = {
  strategyName: string;
  symbol: MarketSymbol;
  timeframe: CandleTimeframe;
  state: PaperStrategyStatusState;
  evaluatedAt: string;
  candleCount: number;
  requiredCandleCount: number;
  latestCandleOpenedAt: string | null;
  decision: PaperStrategyDecision | null;
  orderCount: number;
  tradeCount: number;
  reason: string;
};

export type GetRecentCandleSetsInput = {
  symbol: MarketSymbol;
  timeframe: CandleTimeframe;
  limit: number;
};

export interface PaperCandleRepository {
  getRecentCandleSets(input: GetRecentCandleSetsInput): Promise<PaperCandleSet[]>;
}

export interface PaperTradingRepository {
  loadAccount(input: {
    accountId: string;
    strategy: StrategyDefinition;
  }): Promise<PaperAccountState>;
  loadOpenPosition(input: {
    accountId: string;
    strategy: StrategyDefinition;
  }): Promise<PaperPositionState | undefined>;
  recordStep(input: {
    strategy: StrategyDefinition;
    evaluatedAt: Date;
    account: PaperAccountState;
    previousPosition?: PaperPositionState;
    result: PaperTradingStepResult;
    decision: PaperStrategyDecision;
  }): Promise<void>;
}

export interface PaperStrategyRunner {
  evaluate(input: {
    strategy: StrategyDefinition;
    candles: CanonicalCandle[];
  }): Promise<PaperStrategyDecision>;
}

export type PaperTraderServiceOptions = {
  intervalMs?: number | null;
  strategies?: StrategyDefinition[];
  candleRepository?: PaperCandleRepository;
  tradingRepository?: PaperTradingRepository;
  strategyRunner?: PaperStrategyRunner;
};

export class PaperTraderService implements WorkerService {
  readonly name = "paper-trader";

  private state: ServiceState = "stopped";
  private latestStatuses: PaperStrategyStatus[] = [];
  private lastRunStartedAt: string | null = null;
  private lastRunFinishedAt: string | null = null;

  private readonly strategies: StrategyDefinition[];
  private readonly candleRepository: PaperCandleRepository;
  private readonly tradingRepository: PaperTradingRepository;
  private readonly strategyRunner: PaperStrategyRunner;
  private readonly intervalMs: number | null;
  private interval: ReturnType<typeof setInterval> | null = null;

  constructor(options: PaperTraderServiceOptions = {}) {
    this.strategies = options.strategies ?? baselineStrategies;
    this.candleRepository = options.candleRepository ?? new DbPaperCandleRepository();
    this.tradingRepository = options.tradingRepository ?? new DbPaperTradingRepository();
    this.strategyRunner = options.strategyRunner ?? new BaselinePaperStrategyRunner();
    this.intervalMs = options.intervalMs === undefined ? 60 * 1000 : options.intervalMs;
  }

  async start(): Promise<void> {
    if (this.state === "ready" || this.state === "starting") {
      return;
    }

    this.state = "starting";
    await this.runOnce();

    if (this.intervalMs !== null && this.interval === null) {
      this.interval = setInterval(() => {
        void this.runScheduledStep();
      }, this.intervalMs);
      this.interval.unref?.();
    }
  }

  async stop(): Promise<void> {
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
        strategyCount: this.strategies.length,
        lastRunStartedAt: this.lastRunStartedAt,
        lastRunFinishedAt: this.lastRunFinishedAt,
        latestCandleOpenedAt: latestCandleOpenedAt(this.latestStatuses),
        strategies: this.latestStatuses,
      },
    };
  }

  async runOnce(now: Date = new Date()): Promise<PaperStrategyStatus[]> {
    this.lastRunStartedAt = now.toISOString();
    const statuses = await Promise.all(
      this.strategies.map((strategy) => this.evaluateStrategy(strategy, now)),
    );

    this.latestStatuses = statuses;
    this.lastRunFinishedAt = new Date().toISOString();
    this.state = statuses.some((status) => status.state === "failed") ? "degraded" : "ready";

    return statuses;
  }

  private async runScheduledStep(): Promise<void> {
    try {
      await this.runOnce();
    } catch (error) {
      const now = new Date();
      this.latestStatuses = this.strategies.map((strategy) => failedStatus(strategy, now, error));
      this.lastRunFinishedAt = now.toISOString();
      this.state = "degraded";
    }
  }

  private async evaluateStrategy(
    strategy: StrategyDefinition,
    now: Date,
  ): Promise<PaperStrategyStatus> {
    try {
      return await this.buildStrategyStatus(strategy, now);
    } catch (error) {
      return failedStatus(strategy, now, error);
    }
  }

  private async buildStrategyStatus(
    strategy: StrategyDefinition,
    now: Date,
  ): Promise<PaperStrategyStatus> {
    const requiredCandleCount = strategy.gates.data.min_candle_count;

    if (!strategy.meta.enabled) {
      return {
        strategyName: strategy.meta.name,
        symbol: strategy.meta.symbol,
        timeframe: strategy.meta.timeframe,
        state: "disabled",
        evaluatedAt: now.toISOString(),
        candleCount: 0,
        requiredCandleCount,
        latestCandleOpenedAt: null,
        decision: null,
        orderCount: 0,
        tradeCount: 0,
        reason: "strategy disabled",
      };
    }

    const candleSets = await this.candleRepository.getRecentCandleSets({
      symbol: strategy.meta.symbol,
      timeframe: strategy.meta.timeframe,
      limit: requiredCandleCount + 1,
    });
    const latestCandleSet = candleSets.at(-1);

    if (candleSets.length < requiredCandleCount + 1 || !latestCandleSet) {
      return {
        strategyName: strategy.meta.name,
        symbol: strategy.meta.symbol,
        timeframe: strategy.meta.timeframe,
        state: "waiting_for_data",
        evaluatedAt: now.toISOString(),
        candleCount: candleSets.length,
        requiredCandleCount: requiredCandleCount + 1,
        latestCandleOpenedAt: latestCandleSet?.mid.openedAt.toISOString() ?? null,
        decision: null,
        orderCount: 0,
        tradeCount: 0,
        reason: `requires ${requiredCandleCount + 1} candle sets before evaluation`,
      };
    }

    const signalCandles = candleSets.slice(0, -1).map((candleSet) => candleSet.mid);
    const decision = await this.strategyRunner.evaluate({ strategy, candles: signalCandles });
    const accountId = deterministicUuid("paper-account", strategy.meta.name);
    const account = await this.tradingRepository.loadAccount({ accountId, strategy });
    const previousPosition = await this.tradingRepository.loadOpenPosition({
      accountId,
      strategy,
    });
    const result = executePaperTradingStep({
      account,
      position: previousPosition,
      strategy,
      signal: decision.action,
      nextCandle: latestCandleSet,
      intrabarCandles: [latestCandleSet],
      market: {
        status: "OPEN",
        timestamp: latestCandleSet.mid.openedAt,
      },
    });

    await this.tradingRepository.recordStep({
      strategy,
      evaluatedAt: now,
      account,
      previousPosition,
      result,
      decision,
    });

    return {
      strategyName: strategy.meta.name,
      symbol: strategy.meta.symbol,
      timeframe: strategy.meta.timeframe,
      state: "evaluated",
      evaluatedAt: now.toISOString(),
      candleCount: candleSets.length,
      requiredCandleCount: requiredCandleCount + 1,
      latestCandleOpenedAt: latestCandleSet.mid.openedAt.toISOString(),
      decision,
      orderCount: result.orders.length,
      tradeCount: result.trades.length,
      reason: decision.reason,
    };
  }
}

export class DbPaperCandleRepository implements PaperCandleRepository {
  async getRecentCandleSets(input: GetRecentCandleSetsInput): Promise<PaperCandleSet[]> {
    const rows = await db
      .select({
        symbol: candles.symbol,
        timeframe: candles.timeframe,
        priceType: candles.priceType,
        openedAt: candles.openedAt,
        open: candles.open,
        high: candles.high,
        low: candles.low,
        close: candles.close,
        source: candles.source,
        sourceVersion: candles.sourceVersion,
      })
      .from(candles)
      .where(and(eq(candles.symbol, input.symbol), eq(candles.timeframe, input.timeframe)))
      .orderBy(desc(candles.openedAt))
      .limit(input.limit * 3);

    return toCandleSets(rows.map(candleRowToCanonical))
      .sort((left, right) => left.mid.openedAt.getTime() - right.mid.openedAt.getTime())
      .slice(-input.limit);
  }
}

export class DbPaperTradingRepository implements PaperTradingRepository {
  async loadAccount(input: {
    accountId: string;
    strategy: StrategyDefinition;
  }): Promise<PaperAccountState> {
    const [row] = await db
      .select()
      .from(paperAccounts)
      .where(eq(paperAccounts.id, input.accountId))
      .limit(1);

    if (!row) {
      return createPaperAccountState(input.accountId);
    }

    return {
      id: row.id,
      balanceJpy: Number(row.balanceJpy),
      initialBalanceJpy: Number(row.initialBalanceJpy),
      leverage: Number(row.leverage),
      currency: "JPY",
      dailyRealizedPnlJpy: 0,
    };
  }

  async loadOpenPosition(input: {
    accountId: string;
    strategy: StrategyDefinition;
  }): Promise<PaperPositionState | undefined> {
    const [row] = await db
      .select()
      .from(paperPositions)
      .where(and(eq(paperPositions.accountId, input.accountId), eq(paperPositions.status, "open")))
      .limit(1);

    if (!row) {
      return undefined;
    }

    return {
      id: row.id,
      accountId: row.accountId,
      symbol: row.symbol as MarketSymbol,
      side: row.side,
      quantity: 1000,
      entryPrice: Number(row.entryPrice),
      openedAt: row.openedAt,
      stopLossPrice: Number(row.stopLossPrice),
      takeProfitPrice: Number(row.takeProfitPrice),
      trailingStopPips: input.strategy.exit.trailing_stop_pips,
      breakEvenTriggerPips: input.strategy.exit.break_even_trigger_pips,
      trailingStopPrice: row.trailingStopPrice === null ? undefined : Number(row.trailingStopPrice),
      breakEvenStopPrice:
        row.breakEvenStopPrice === null ? undefined : Number(row.breakEvenStopPrice),
      bestPriceSinceOpen: Number(row.bestPriceSinceOpen),
      spreadPips: Number(row.spreadPips),
      spreadSource: "websocket_bid_ask",
    };
  }

  async recordStep(input: {
    strategy: StrategyDefinition;
    evaluatedAt: Date;
    account: PaperAccountState;
    previousPosition?: PaperPositionState;
    result: PaperTradingStepResult;
    decision: PaperStrategyDecision;
  }): Promise<void> {
    const strategyRunId = deterministicUuid(
      "strategy-run",
      input.strategy.meta.name,
      input.evaluatedAt.toISOString(),
    );
    const entryOrder = input.result.orders.find((order) => order.action === "entry");
    const exitOrder = input.result.orders.find((order) => order.action === "exit");

    await db.transaction(async (tx) => {
      await tx
        .insert(strategyRuns)
        .values({
          id: strategyRunId,
          strategyName: input.strategy.meta.name,
          symbol: input.strategy.meta.symbol,
          timeframe: input.strategy.meta.timeframe,
          status: "running_paper",
          strategyDefinition: input.strategy,
          startedAt: input.evaluatedAt,
          finishedAt: input.evaluatedAt,
          metadata: {
            decision: input.decision,
            orderCount: input.result.orders.length,
            tradeCount: input.result.trades.length,
          },
        })
        .onConflictDoNothing();

      await tx
        .insert(paperAccounts)
        .values(
          toPaperAccountInsertRow({
            account: input.result.account,
            name: input.strategy.meta.name,
            strategyRunId,
          }),
        )
        .onConflictDoUpdate({
          target: paperAccounts.id,
          set: {
            balanceJpy: sql`excluded.balance_jpy`,
            updatedAt: sql`now()`,
          },
        });

      if (input.result.position) {
        await tx
          .insert(paperPositions)
          .values(toPaperPositionInsertRow({ position: input.result.position, strategyRunId }))
          .onConflictDoUpdate({
            target: paperPositions.id,
            set: {
              trailingStopPrice: sql`excluded.trailing_stop_price`,
              breakEvenStopPrice: sql`excluded.break_even_stop_price`,
              bestPriceSinceOpen: sql`excluded.best_price_since_open`,
              updatedAt: sql`now()`,
            },
          });
      }

      for (const order of input.result.orders) {
        await tx
          .insert(paperOrders)
          .values(toPaperOrderInsertRow({ order, strategyRunId }))
          .onConflictDoNothing();
      }

      for (const trade of input.result.trades) {
        await tx
          .insert(paperTrades)
          .values(
            toPaperTradeInsertRow({
              trade,
              strategyRunId,
              entryOrderId: entryOrder?.id,
              exitOrderId: exitOrder?.id,
            }),
          )
          .onConflictDoNothing();
      }

      if (!input.result.position && input.previousPosition && input.result.trades[0]) {
        await tx
          .update(paperPositions)
          .set({
            status: "closed",
            closedAt: input.result.trades[0].closedAt,
            realizedPnlJpy: input.result.trades[0].pnlJpy.toFixed(6),
            updatedAt: sql`now()`,
          })
          .where(eq(paperPositions.id, input.previousPosition.id));
      }
    });
  }
}

export class InMemoryPaperTradingRepository implements PaperTradingRepository {
  readonly steps: Array<{
    strategy: StrategyDefinition;
    result: PaperTradingStepResult;
    decision: PaperStrategyDecision;
  }> = [];

  private readonly accounts = new Map<string, PaperAccountState>();
  private readonly positions = new Map<string, PaperPositionState>();

  async loadAccount(input: {
    accountId: string;
    strategy: StrategyDefinition;
  }): Promise<PaperAccountState> {
    const account = this.accounts.get(input.accountId) ?? createPaperAccountState(input.accountId);
    this.accounts.set(input.accountId, account);
    return account;
  }

  async loadOpenPosition(input: {
    accountId: string;
    strategy: StrategyDefinition;
  }): Promise<PaperPositionState | undefined> {
    return this.positions.get(input.accountId);
  }

  async recordStep(input: {
    strategy: StrategyDefinition;
    evaluatedAt: Date;
    account: PaperAccountState;
    previousPosition?: PaperPositionState;
    result: PaperTradingStepResult;
    decision: PaperStrategyDecision;
  }): Promise<void> {
    this.accounts.set(input.result.account.id, input.result.account);
    if (input.result.position) {
      this.positions.set(input.result.position.accountId, input.result.position);
    } else if (input.previousPosition) {
      this.positions.delete(input.previousPosition.accountId);
    }
    this.steps.push({
      strategy: input.strategy,
      result: input.result,
      decision: input.decision,
    });
  }
}

export class BaselinePaperStrategyRunner implements PaperStrategyRunner {
  async evaluate(input: {
    strategy: StrategyDefinition;
    candles: CanonicalCandle[];
  }): Promise<PaperStrategyDecision> {
    const signal = evaluateBaselineSignal(input.candles);
    if (signal !== "HOLD") {
      return {
        action: signal,
        reason: `${input.strategy.meta.name} ${signal} signal from baseline indicators`,
      };
    }

    return {
      action: "HOLD",
      reason: "baseline indicators did not produce an entry or exit signal",
    };
  }
}

function evaluateBaselineSignal(candles: CanonicalCandle[]): PaperTradeSignal {
  const closes = candles.map((candle) => candle.close);
  if (closes.length < 22) {
    return "HOLD";
  }

  const latestClose = closes.at(-1);
  const previousCloses = closes.slice(0, -1);
  const previousEma9 = ema(previousCloses, 9);
  const previousEma21 = ema(previousCloses, 21);
  const latestEma9 = ema(closes, 9);
  const latestEma21 = ema(closes, 21);
  const rsi14 = rsi(closes, 14);
  const bands = bollingerBands(closes, 20, 2);

  if (
    latestClose !== undefined &&
    bands &&
    rsi14 !== undefined &&
    latestClose <= bands.lower &&
    rsi14 <= 30
  ) {
    return "BUY";
  }

  if (
    latestClose !== undefined &&
    bands &&
    rsi14 !== undefined &&
    latestClose >= bands.upper &&
    rsi14 >= 70
  ) {
    return "SELL";
  }

  if (
    previousEma9 !== undefined &&
    previousEma21 !== undefined &&
    latestEma9 !== undefined &&
    latestEma21 !== undefined
  ) {
    if (previousEma9 <= previousEma21 && latestEma9 > latestEma21) {
      return "BUY";
    }
    if (previousEma9 >= previousEma21 && latestEma9 < latestEma21) {
      return "SELL";
    }
  }

  return "HOLD";
}

function toCandleSets(canonicalCandles: CanonicalCandle[]): PaperCandleSet[] {
  const grouped = new Map<string, CanonicalCandle[]>();

  for (const candle of canonicalCandles) {
    const key = candle.openedAt.toISOString();
    grouped.set(key, [...(grouped.get(key) ?? []), candle]);
  }

  const candleSets: PaperCandleSet[] = [];
  for (const group of grouped.values()) {
    const mid = group.find((candle) => candle.priceType === "mid");
    if (!mid) {
      continue;
    }
    const bid = group.find((candle) => candle.priceType === "bid");
    const ask = group.find((candle) => candle.priceType === "ask");
    const spreadPips = mid.spreadPips ?? spreadFromBidAsk(bid, ask) ?? DEFAULT_SPREAD_PIPS;
    candleSets.push({
      mid,
      bid,
      ask,
      spreadPips,
      spreadSource: bid && ask ? "websocket_bid_ask" : "default",
    });
  }

  return candleSets;
}

function candleRowToCanonical(row: {
  symbol: string;
  timeframe: string;
  priceType: "bid" | "ask" | "mid";
  openedAt: Date;
  open: string;
  high: string;
  low: string;
  close: string;
  source: "websocket" | "rest_klines" | "derived";
  sourceVersion: string;
}): CanonicalCandle {
  return {
    symbol: row.symbol as MarketSymbol,
    timeframe: row.timeframe as CandleTimeframe,
    priceType: row.priceType,
    openedAt: row.openedAt,
    open: Number(row.open),
    high: Number(row.high),
    low: Number(row.low),
    close: Number(row.close),
    source: row.source,
    sourceVersion: row.sourceVersion,
  };
}

function spreadFromBidAsk(
  bid: CanonicalCandle | undefined,
  ask: CanonicalCandle | undefined,
): number | undefined {
  if (!bid || !ask) {
    return undefined;
  }

  return Number(((ask.close - bid.close) / 0.01).toFixed(4));
}

function failedStatus(
  strategy: StrategyDefinition,
  now: Date,
  error: unknown,
): PaperStrategyStatus {
  return {
    strategyName: strategy.meta.name,
    symbol: strategy.meta.symbol,
    timeframe: strategy.meta.timeframe,
    state: "failed",
    evaluatedAt: now.toISOString(),
    candleCount: 0,
    requiredCandleCount: strategy.gates.data.min_candle_count + 1,
    latestCandleOpenedAt: null,
    decision: null,
    orderCount: 0,
    tradeCount: 0,
    reason: error instanceof Error ? error.message : String(error),
  };
}

function latestCandleOpenedAt(statuses: PaperStrategyStatus[]): string | null {
  return statuses.reduce<string | null>((latest, status) => {
    if (!status.latestCandleOpenedAt) {
      return latest;
    }

    return latest === null || status.latestCandleOpenedAt > latest
      ? status.latestCandleOpenedAt
      : latest;
  }, null);
}

function ema(values: number[], period: number): number | undefined {
  if (values.length < period) {
    return undefined;
  }

  const multiplier = 2 / (period + 1);
  const seed = average(values.slice(0, period));
  return values.slice(period).reduce((current, value) => {
    return value * multiplier + current * (1 - multiplier);
  }, seed);
}

function rsi(values: number[], period: number): number | undefined {
  if (values.length <= period) {
    return undefined;
  }

  const deltas = values.slice(1).map((value, index) => value - values[index]);
  const recent = deltas.slice(-period);
  const gains = recent.filter((delta) => delta > 0).reduce((total, delta) => total + delta, 0);
  const losses = recent
    .filter((delta) => delta < 0)
    .reduce((total, delta) => total + Math.abs(delta), 0);

  if (losses === 0) {
    return 100;
  }

  const relativeStrength = gains / losses;
  return 100 - 100 / (1 + relativeStrength);
}

function bollingerBands(
  values: number[],
  period: number,
  stdDevMultiplier: number,
): { lower: number; upper: number } | undefined {
  if (values.length < period) {
    return undefined;
  }

  const window = values.slice(-period);
  const mean = average(window);
  const variance = average(window.map((value) => (value - mean) ** 2));
  const stdDev = Math.sqrt(variance);

  return {
    lower: mean - stdDev * stdDevMultiplier,
    upper: mean + stdDev * stdDevMultiplier,
  };
}

function average(values: number[]): number {
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function deterministicUuid(...parts: string[]): string {
  const digest = createHash("sha256").update(parts.join("|")).digest("hex");
  return [
    digest.slice(0, 8),
    digest.slice(8, 12),
    `4${digest.slice(13, 16)}`,
    `8${digest.slice(17, 20)}`,
    digest.slice(20, 32),
  ].join("-");
}
