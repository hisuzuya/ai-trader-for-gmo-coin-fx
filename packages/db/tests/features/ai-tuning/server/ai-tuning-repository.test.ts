import { BASELINE_STRATEGIES } from "@ai-trade/domain/strategies";
import { describe, expect, it } from "vitest";

import {
  toAiInvocationInsertRow,
  toAiTuningProposalInsertRow,
} from "../../../../src/repositories/ai-tuning-repository.js";

describe("AI tuning repository row helpers", () => {
  it("converts invocation summaries without requiring secrets", () => {
    expect(
      toAiInvocationInsertRow({
        id: "f5bf1c6e-f63f-4cb1-8cb8-7107ec0382a8",
        provider: "claude_cli",
        purpose: "strategy_tuning",
        promptHash: "hash",
        promptRedacted: "{}",
        status: "succeeded",
        timeoutMs: 120000,
        startedAt: new Date("2026-05-24T00:00:00.000Z"),
        finishedAt: new Date("2026-05-24T00:00:01.000Z"),
      }),
    ).toMatchObject({
      provider: "claude_cli",
      purpose: "strategy_tuning",
      timeoutMs: "120000",
      status: "succeeded",
    });
  });

  it("marks accepted proposals as inserted candidate slots", () => {
    expect(
      toAiTuningProposalInsertRow({
        id: "proposal-1",
        invocationId: "f5bf1c6e-f63f-4cb1-8cb8-7107ec0382a8",
        sourceStrategyName: "baseline_5m",
        symbol: "USD_JPY",
        timeframe: "5m",
        validation: {
          status: "accepted",
          proposal: {
            rationale: "Tighten spread gate.",
            strategy: {
              ...BASELINE_STRATEGIES["5m"],
              meta: {
                ...BASELINE_STRATEGIES["5m"].meta,
                name: "candidate_5m_spread_tight",
              },
            },
          },
        },
      }),
    ).toMatchObject({
      status: "accepted",
      sourceStrategyName: "baseline_5m",
      candidateStrategyName: "candidate_5m_spread_tight",
      insertedIntoPaper: true,
    });
  });

  it("keeps rejected proposals out of candidate slots", () => {
    expect(
      toAiTuningProposalInsertRow({
        id: "proposal-2",
        sourceStrategyName: "baseline_5m",
        symbol: "USD_JPY",
        timeframe: "5m",
        validation: {
          status: "rejected",
          reasons: [
            {
              code: "risk_gate_relaxed",
              path: "$.strategy.risk",
              message: "Risk Gate cannot be relaxed",
            },
          ],
        },
      }),
    ).toMatchObject({
      status: "rejected",
      insertedIntoPaper: false,
      rejectReasons: [
        {
          code: "risk_gate_relaxed",
        },
      ],
    });
  });
});
