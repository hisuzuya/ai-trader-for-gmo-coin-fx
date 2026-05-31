import { aiTuningProposals } from "@ai-trade/db";
import { and, desc, eq } from "drizzle-orm";

import { readOnlyDb } from "../../data-sources/read-only-db.js";
import { clampLimit } from "../common.js";

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
