import {
  aiAgentMemories,
  aiTuningProposals,
  CandleRepository,
  paperAccounts,
  paperTrades,
  strategyRuns,
} from "@ai-trade/db";
import { and, desc, eq, ilike, or } from "drizzle-orm";

import { readOnlyDb } from "./read-only-db.js";

const MAX_LIMIT = 500;

export async function readBars(input: {
  symbol: string;
  timeframe: string;
  count: number;
  priceType: "bid" | "ask" | "mid";
}) {
  const candles = await new CandleRepository(readOnlyDb).getRecent({
    symbol: input.symbol,
    timeframe: input.timeframe,
    priceType: input.priceType,
    limit: clampLimit(input.count),
  });

  return candles.map((candle) => ({
    openedAt: candle.openedAt.toISOString(),
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
  }));
}

export async function calcIndicator(input: {
  symbol: string;
  timeframe: string;
  indicator: "sma" | "ema" | "rsi";
  params: { period?: number };
  count: number;
}) {
  const period = Math.max(2, Math.min(100, Number(input.params.period ?? 14)));
  const bars = await readBars({
    symbol: input.symbol,
    timeframe: input.timeframe,
    priceType: "mid",
    count: Math.max(input.count + period, period * 3),
  });
  const closes = bars.map((bar) => bar.close).reverse();
  const values =
    input.indicator === "sma"
      ? simpleMovingAverage(closes, period)
      : input.indicator === "ema"
        ? exponentialMovingAverage(closes, period)
        : relativeStrengthIndex(closes, period);

  return values.slice(-clampLimit(input.count));
}

export async function getCandidatePerformance(input: { strategyName: string }) {
  const runs = await readOnlyDb
    .select({
      id: strategyRuns.id,
      strategyName: strategyRuns.strategyName,
      status: strategyRuns.status,
      accountId: paperAccounts.id,
      balanceJpy: paperAccounts.balanceJpy,
      initialBalanceJpy: paperAccounts.initialBalanceJpy,
    })
    .from(strategyRuns)
    .leftJoin(paperAccounts, eq(paperAccounts.strategyRunId, strategyRuns.id))
    .where(eq(strategyRuns.strategyName, input.strategyName))
    .orderBy(desc(strategyRuns.startedAt))
    .limit(1);
  const run = runs[0] ?? null;

  if (!run?.accountId) {
    return { strategyName: input.strategyName, status: run?.status ?? "not_found", tradeCount: 0 };
  }

  const trades = await readOnlyDb
    .select({
      pnlJpy: paperTrades.pnlJpy,
      closedAt: paperTrades.closedAt,
    })
    .from(paperTrades)
    .where(eq(paperTrades.accountId, run.accountId))
    .orderBy(desc(paperTrades.closedAt))
    .limit(200);
  const pnlValues = trades.map((trade) => Number(trade.pnlJpy));

  return {
    strategyName: input.strategyName,
    status: run.status,
    balanceJpy: Number(run.balanceJpy),
    initialBalanceJpy: Number(run.initialBalanceJpy),
    netProfitJpy: Number(run.balanceJpy) - Number(run.initialBalanceJpy),
    tradeCount: trades.length,
    realizedPnlJpy: pnlValues.reduce((sum, value) => sum + value, 0),
  };
}

export async function getRejectionHistory(input: { strategyName?: string; limit?: number }) {
  const conditions = [eq(aiTuningProposals.status, "rejected")];

  if (input.strategyName) {
    conditions.push(eq(aiTuningProposals.sourceStrategyName, input.strategyName));
  }

  const rows = await readOnlyDb
    .select({
      sourceStrategyName: aiTuningProposals.sourceStrategyName,
      candidateStrategyName: aiTuningProposals.candidateStrategyName,
      rejectReasons: aiTuningProposals.rejectReasons,
      createdAt: aiTuningProposals.createdAt,
    })
    .from(aiTuningProposals)
    .where(and(...conditions))
    .orderBy(desc(aiTuningProposals.createdAt))
    .limit(clampLimit(input.limit ?? 20));

  return rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() }));
}

export async function recallMemory(input: {
  agentId: string;
  query?: string;
  types?: string[];
  limit?: number;
}) {
  const conditions = [eq(aiAgentMemories.agentId, input.agentId)];

  if (input.query?.trim()) {
    const query = `%${input.query.trim()}%`;
    const searchCondition = or(
      ilike(aiAgentMemories.content, query),
      ilike(aiAgentMemories.searchVector, query),
    );

    if (searchCondition) {
      conditions.push(searchCondition);
    }
  }

  const rows = await readOnlyDb
    .select({
      id: aiAgentMemories.id,
      type: aiAgentMemories.type,
      content: aiAgentMemories.content,
      tags: aiAgentMemories.tags,
      sourceRefs: aiAgentMemories.sourceRefs,
      createdAt: aiAgentMemories.createdAt,
    })
    .from(aiAgentMemories)
    .where(and(...conditions))
    .orderBy(desc(aiAgentMemories.createdAt))
    .limit(clampLimit(input.limit ?? 10));

  return rows
    .filter((row) => !input.types || input.types.includes(row.type))
    .map((row) => ({ ...row, createdAt: row.createdAt.toISOString() }));
}

function clampLimit(limit: number) {
  return Math.max(1, Math.min(MAX_LIMIT, Math.trunc(limit)));
}

function simpleMovingAverage(values: number[], period: number) {
  return values.map((_, index) => {
    if (index + 1 < period) {
      return null;
    }

    const slice = values.slice(index + 1 - period, index + 1);
    return slice.reduce((sum, value) => sum + value, 0) / period;
  });
}

function exponentialMovingAverage(values: number[], period: number) {
  const smoothing = 2 / (period + 1);
  let previous = values[0] ?? 0;

  return values.map((value, index) => {
    previous = index === 0 ? value : value * smoothing + previous * (1 - smoothing);
    return previous;
  });
}

function relativeStrengthIndex(values: number[], period: number) {
  return values.map((_, index) => {
    if (index < period) {
      return null;
    }

    const slice = values.slice(index + 1 - period, index + 1);
    let gains = 0;
    let losses = 0;

    for (let i = 1; i < slice.length; i += 1) {
      const delta = slice[i] - slice[i - 1];
      gains += Math.max(delta, 0);
      losses += Math.max(-delta, 0);
    }

    if (losses === 0) {
      return 100;
    }

    const rs = gains / losses;
    return 100 - 100 / (1 + rs);
  });
}
