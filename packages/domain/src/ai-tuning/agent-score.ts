import type { AgentScorecard, AgentScorecardMetrics } from "./types.js";

/**
 * JPY-equivalent credit awarded for a 100% proposal acceptance rate. Kept small
 * relative to realized PnL so that the score stays PnL-centric: acceptance only
 * breaks ties between prompts with similar realized PnL.
 */
export const ACCEPTANCE_SCORE_WEIGHT_JPY = 5000;

/**
 * Collapse raw agent metrics into a single realized-PnL-centric reward used by
 * the prompt optimizer to decide promotion and rollback.
 */
export function computeAgentScore(metrics: AgentScorecardMetrics): AgentScorecard {
  const acceptanceRate =
    metrics.proposalCount > 0 ? metrics.acceptedProposalCount / metrics.proposalCount : 0;
  const score = metrics.realizedPnlJpy + acceptanceRate * ACCEPTANCE_SCORE_WEIGHT_JPY;

  return {
    ...metrics,
    acceptanceRate,
    score,
  };
}
