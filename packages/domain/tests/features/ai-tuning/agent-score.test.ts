import { describe, expect, it } from "vitest";

import {
  ACCEPTANCE_SCORE_WEIGHT_JPY,
  type AgentRoleActivity,
  type AgentScorecardMetrics,
  APPLIED_REVIEW_SCORE_WEIGHT_JPY,
  CURATION_APPLIED_SCORE_WEIGHT_JPY,
  computeAgentScore,
  computeRoleScore,
  hasSufficientRoleSignal,
  OBSERVATION_SCORE_WEIGHT_JPY,
  type RoleSufficiencyThresholds,
  SHARED_SKILL_SCORE_WEIGHT_JPY,
} from "../../../src/ai-tuning/index.js";

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

const emptyActivity: AgentRoleActivity = {
  observationCount: 0,
  candidateReviewCount: 0,
  appliedReviewCount: 0,
  curationDecisionCount: 0,
  curationAppliedCount: 0,
  sharedSkillCount: 0,
};

const thresholds: RoleSufficiencyThresholds = {
  minProposals: 3,
  minTrades: 5,
  minObservations: 5,
  minReviews: 3,
  minCurationDecisions: 2,
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

  it("defaults an absent role to the trader (PnL-centric) formula", () => {
    const result = computeAgentScore({ ...baseMetrics, realizedPnlJpy: 7_000 });

    expect(result.role).toBeUndefined();
    expect(result.score).toBe(7_000);
  });

  it("scores a skill_curator on applied curations and shared-skill breadth, not PnL", () => {
    const result = computeAgentScore({
      ...baseMetrics,
      role: "skill_curator",
      // PnL is present but must be ignored for a curator.
      realizedPnlJpy: 50_000,
      roleActivity: {
        ...emptyActivity,
        curationAppliedCount: 2,
        sharedSkillCount: 4,
      },
    });

    expect(result.score).toBe(
      2 * CURATION_APPLIED_SCORE_WEIGHT_JPY + 4 * SHARED_SKILL_SCORE_WEIGHT_JPY,
    );
  });
});

describe("computeRoleScore", () => {
  it("rewards a news_analyst for observations and proposal acceptance", () => {
    const score = computeRoleScore("news_analyst", {
      ...baseMetrics,
      proposalCount: 2,
      acceptedProposalCount: 1,
      roleActivity: { ...emptyActivity, observationCount: 6 },
    });

    expect(score).toBe(6 * OBSERVATION_SCORE_WEIGHT_JPY + 0.5 * ACCEPTANCE_SCORE_WEIGHT_JPY);
  });

  it("rewards a risk_auditor for acted-on reviews with a small credit per review", () => {
    const score = computeRoleScore("risk_auditor", {
      ...baseMetrics,
      roleActivity: { ...emptyActivity, candidateReviewCount: 5, appliedReviewCount: 3 },
    });

    expect(score).toBe(
      3 * APPLIED_REVIEW_SCORE_WEIGHT_JPY + 5 * (APPLIED_REVIEW_SCORE_WEIGHT_JPY * 0.1),
    );
  });

  it("treats missing role activity as zero (no NaN)", () => {
    expect(computeRoleScore("skill_curator", baseMetrics)).toBe(0);
    expect(computeRoleScore("news_analyst", baseMetrics)).toBe(0);
  });
});

describe("hasSufficientRoleSignal", () => {
  it("gates a trader on proposals OR trades", () => {
    expect(
      hasSufficientRoleSignal("trader", { ...baseMetrics, proposalCount: 3 }, thresholds),
    ).toBe(true);
    expect(hasSufficientRoleSignal("trader", { ...baseMetrics, tradeCount: 5 }, thresholds)).toBe(
      true,
    );
    expect(
      hasSufficientRoleSignal(
        "trader",
        { ...baseMetrics, proposalCount: 1, tradeCount: 2 },
        thresholds,
      ),
    ).toBe(false);
  });

  it("gates a news_analyst on observation count", () => {
    expect(
      hasSufficientRoleSignal(
        "news_analyst",
        { ...baseMetrics, roleActivity: { ...emptyActivity, observationCount: 5 } },
        thresholds,
      ),
    ).toBe(true);
    expect(
      hasSufficientRoleSignal(
        "news_analyst",
        { ...baseMetrics, roleActivity: { ...emptyActivity, observationCount: 4 } },
        thresholds,
      ),
    ).toBe(false);
  });

  it("gates a skill_curator on total curation decisions", () => {
    expect(
      hasSufficientRoleSignal(
        "skill_curator",
        { ...baseMetrics, roleActivity: { ...emptyActivity, curationDecisionCount: 2 } },
        thresholds,
      ),
    ).toBe(true);
    expect(
      hasSufficientRoleSignal(
        "skill_curator",
        { ...baseMetrics, roleActivity: { ...emptyActivity, curationDecisionCount: 1 } },
        thresholds,
      ),
    ).toBe(false);
  });
});
