import { describe, expect, it } from "vitest";

import { ACCEPTANCE_SCORE_WEIGHT_JPY, computeAgentScore } from "./agent-score.js";
import type { AgentScorecardMetrics } from "./types.js";

const baseMetrics: AgentScorecardMetrics = {
  agentId: "agent-1",
  windowDays: 7,
  proposalCount: 0,
  acceptedProposalCount: 0,
  adoptedStrategyCount: 0,
  tradeCount: 0,
  realizedPnlJpy: 0,
  netAccountPnlJpy: 0,
};

describe("computeAgentScore", () => {
  it("uses realized PnL as the dominant reward", () => {
    const result = computeAgentScore({ ...baseMetrics, realizedPnlJpy: 12_345 });

    expect(result.realizedPnlJpy).toBe(12_345);
    expect(result.acceptanceRate).toBe(0);
    expect(result.score).toBe(12_345);
  });

  it("adds a small acceptance-rate bonus on top of realized PnL", () => {
    const result = computeAgentScore({
      ...baseMetrics,
      proposalCount: 4,
      acceptedProposalCount: 2,
      realizedPnlJpy: 1_000,
    });

    expect(result.acceptanceRate).toBe(0.5);
    expect(result.score).toBe(1_000 + 0.5 * ACCEPTANCE_SCORE_WEIGHT_JPY);
  });

  it("treats zero proposals as a zero acceptance rate (no divide-by-zero)", () => {
    const result = computeAgentScore({ ...baseMetrics, proposalCount: 0 });

    expect(result.acceptanceRate).toBe(0);
    expect(result.score).toBe(0);
  });

  it("keeps the acceptance bonus small relative to a losing PnL", () => {
    const result = computeAgentScore({
      ...baseMetrics,
      proposalCount: 1,
      acceptedProposalCount: 1,
      realizedPnlJpy: -10_000,
    });

    // A perfect acceptance rate must not rescue a clearly losing prompt.
    expect(result.score).toBeLessThan(0);
    expect(result.score).toBe(-10_000 + ACCEPTANCE_SCORE_WEIGHT_JPY);
  });
});
