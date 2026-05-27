import { aiDailyReviews, strategyRuns } from "@ai-trade/db";
import { desc } from "drizzle-orm";

import { readOnlyDb } from "../../data-sources/read-only-db.js";
import { readBars } from "../market-data/index.js";
import { recallMemory } from "../memory/index.js";
import { getRejectionHistory } from "../rejection-history/index.js";

export async function getContextSnapshot(input: { agentId: string; timeframe?: string }) {
  const timeframe = input.timeframe ?? "1m";
  const [marketData, candidates, rejections, dailyReviews, memories] = await Promise.all([
    readMarketData(timeframe),
    readCandidates(),
    readSource("rejectionHistory", () => getRejectionHistory({ limit: 10 })),
    readDailyReviews(),
    readSource("memories", () => recallMemory({ agentId: input.agentId, limit: 10 })),
  ]);

  return {
    timeframe,
    sourceErrors: {
      market: marketData.error,
      candidates: candidates.error,
      rejectionHistory: rejections.error,
      dailyReviews: dailyReviews.error,
      memories: memories.error,
    },
    market: {
      latestCandleOpenedAt: marketData.bars.at(0)?.openedAt ?? null,
      candleCount: marketData.bars.length,
      dataError: marketData.error,
      recentCloses: marketData.bars.map((bar) => ({ openedAt: bar.openedAt, close: bar.close })),
    },
    candidates: candidates.value.map((candidate) => ({
      ...candidate,
      startedAt: candidate.startedAt.toISOString(),
    })),
    rejectionHistory: rejections.value,
    dailyReviews: dailyReviews.value.map((review) => ({
      ...review,
      createdAt: review.createdAt.toISOString(),
    })),
    memories: memories.value,
  };
}

async function readCandidates() {
  return readSource("candidates", () =>
    readOnlyDb
      .select({
        strategyName: strategyRuns.strategyName,
        status: strategyRuns.status,
        timeframe: strategyRuns.timeframe,
        sourceAgentId: strategyRuns.sourceAgentId,
        sourceProposalId: strategyRuns.sourceProposalId,
        startedAt: strategyRuns.startedAt,
      })
      .from(strategyRuns)
      .orderBy(desc(strategyRuns.startedAt))
      .limit(20),
  );
}

async function readDailyReviews() {
  return readSource("dailyReviews", () =>
    readOnlyDb
      .select({
        reviewDate: aiDailyReviews.reviewDate,
        summary: aiDailyReviews.summary,
        warnings: aiDailyReviews.warnings,
        createdAt: aiDailyReviews.createdAt,
      })
      .from(aiDailyReviews)
      .orderBy(desc(aiDailyReviews.createdAt))
      .limit(3),
  );
}

async function readMarketData(timeframe: string) {
  try {
    return {
      bars: await readBars({ symbol: "USD_JPY", timeframe, priceType: "mid", count: 20 }),
      error: null,
    };
  } catch (error) {
    return {
      bars: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function readSource<T>(source: string, read: () => Promise<T[]>) {
  try {
    return {
      value: await read(),
      error: null,
    };
  } catch (error) {
    return {
      value: [],
      error: `${source}: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
