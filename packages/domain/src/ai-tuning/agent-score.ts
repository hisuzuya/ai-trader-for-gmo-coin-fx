import type { AgentRole } from "../ai-agents/characters.js";
import type { AgentScorecard, AgentScorecardMetrics } from "./types.js";

/**
 * JPY-equivalent credit awarded for a 100% proposal acceptance rate. Kept small
 * relative to realized PnL so that the score stays PnL-centric: acceptance only
 * breaks ties between prompts with similar realized PnL.
 */
export const ACCEPTANCE_SCORE_WEIGHT_JPY = 5000;

/**
 * JPY-equivalent weights for the non-trader role signals. They are expressed on
 * the same JPY scale as realized PnL so the optimizer's score-based trial /
 * rollback machinery works unchanged across every role. Tuned to be modest:
 * a non-trader earns a positive score from genuine, acted-on output rather than
 * from raw volume.
 */
export const OBSERVATION_SCORE_WEIGHT_JPY = 200;
export const APPLIED_REVIEW_SCORE_WEIGHT_JPY = 800;
export const CURATION_APPLIED_SCORE_WEIGHT_JPY = 600;
export const SHARED_SKILL_SCORE_WEIGHT_JPY = 100;

/** Minimum recent signal a role needs before it is worth spending an optimization call. */
export type RoleSufficiencyThresholds = {
  /** trader: proposals emitted. */
  minProposals: number;
  /** trader: closed trades. */
  minTrades: number;
  /** news_analyst: observations emitted. */
  minObservations: number;
  /** risk_auditor: candidate reviews emitted. */
  minReviews: number;
  /** skill_curator: curation decisions recorded. */
  minCurationDecisions: number;
};

function acceptanceRateOf(metrics: AgentScorecardMetrics): number {
  return metrics.proposalCount > 0 ? metrics.acceptedProposalCount / metrics.proposalCount : 0;
}

/**
 * Role-aware composite reward. Each role is scored on the output its directive
 * asks for, all on a shared JPY scale:
 *  - trader: realized PnL dominates, acceptance is a small tie-breaker.
 *  - news_analyst: useful observations + contribution to accepted proposals.
 *  - risk_auditor: acted-on reviews (loss-prevented proxy) + a small credit for
 *    every review surfaced.
 *  - skill_curator: applied curations + breadth of the shared-skill commons it
 *    keeps healthy.
 */
export function computeRoleScore(role: AgentRole, metrics: AgentScorecardMetrics): number {
  const acceptanceRate = acceptanceRateOf(metrics);
  const activity = metrics.roleActivity;

  switch (role) {
    case "news_analyst":
      return (
        (activity?.observationCount ?? 0) * OBSERVATION_SCORE_WEIGHT_JPY +
        acceptanceRate * ACCEPTANCE_SCORE_WEIGHT_JPY
      );
    case "risk_auditor":
      return (
        (activity?.appliedReviewCount ?? 0) * APPLIED_REVIEW_SCORE_WEIGHT_JPY +
        (activity?.candidateReviewCount ?? 0) * (APPLIED_REVIEW_SCORE_WEIGHT_JPY * 0.1)
      );
    case "skill_curator":
      return (
        (activity?.curationAppliedCount ?? 0) * CURATION_APPLIED_SCORE_WEIGHT_JPY +
        (activity?.sharedSkillCount ?? 0) * SHARED_SKILL_SCORE_WEIGHT_JPY
      );
    default:
      return metrics.realizedPnlJpy + acceptanceRate * ACCEPTANCE_SCORE_WEIGHT_JPY;
  }
}

/** Whether a role has enough recent signal to justify an optimization pass. */
export function hasSufficientRoleSignal(
  role: AgentRole,
  metrics: AgentScorecardMetrics,
  thresholds: RoleSufficiencyThresholds,
): boolean {
  const activity = metrics.roleActivity;

  switch (role) {
    case "news_analyst":
      return (activity?.observationCount ?? 0) >= thresholds.minObservations;
    case "risk_auditor":
      return (activity?.candidateReviewCount ?? 0) >= thresholds.minReviews;
    case "skill_curator":
      return (activity?.curationDecisionCount ?? 0) >= thresholds.minCurationDecisions;
    default:
      return (
        metrics.proposalCount >= thresholds.minProposals ||
        metrics.tradeCount >= thresholds.minTrades
      );
  }
}

/**
 * Collapse raw agent metrics into a single role-aware reward used by the prompt
 * optimizer to decide promotion and rollback. The role defaults to `trader`, so
 * legacy callers that omit it keep the original PnL-centric behaviour.
 */
export function computeAgentScore(metrics: AgentScorecardMetrics): AgentScorecard {
  const acceptanceRate = acceptanceRateOf(metrics);
  const score = computeRoleScore(metrics.role ?? "trader", metrics);

  return {
    ...metrics,
    acceptanceRate,
    score,
  };
}
