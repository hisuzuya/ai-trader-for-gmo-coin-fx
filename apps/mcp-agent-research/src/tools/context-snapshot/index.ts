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
    getRejectionHistory({ limit: 10 }),
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
    recallMemory({ agentId: input.agentId, limit: 10 }),
  ]);

  return {
    timeframe,
    market: {
      latestCandleOpenedAt: marketData.bars.at(0)?.openedAt ?? null,
      candleCount: marketData.bars.length,
      dataError: marketData.error,
      recentCloses: marketData.bars.map((bar) => ({ openedAt: bar.openedAt, close: bar.close })),
    },
    candidates: candidates.map((candidate) => ({
      ...candidate,
      startedAt: candidate.startedAt.toISOString(),
    })),
    rejectionHistory: rejections,
    dailyReviews: dailyReviews.map((review) => ({
      ...review,
      createdAt: review.createdAt.toISOString(),
    })),
    memories,
  };
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
