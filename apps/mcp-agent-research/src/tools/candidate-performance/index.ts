import { paperAccounts, paperTrades, strategyRuns } from "@ai-trade/db";
import { desc, eq } from "drizzle-orm";

import { readOnlyDb } from "../../data-sources/read-only-db.js";

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
