import type { StrategyDefinition } from "../strategies/types.js";

export type RejectReasonCode =
  | "invalid_json"
  | "schema_validation_error"
  | "unsupported_timeframe"
  | "unsupported_symbol"
  | "unsupported_indicator"
  | "unsupported_condition"
  | "parameter_out_of_range"
  | "max_open_positions_exceeded"
  | "reversal_entry_not_allowed"
  | "risk_gate_relaxed"
  | "forbidden_capability"
  | "indicator_not_configured";

export type RejectReason = {
  code: RejectReasonCode;
  path: string;
  message: string;
};

export type AiStrategyProposal = {
  proposal_id?: string;
  rationale: string;
  strategy: StrategyDefinition;
};

export type StrategyProposalInput = {
  baseline: StrategyDefinition;
  recentPerformance: {
    netProfitJpy: number;
    tradeCount: number;
    maxDrawdownJpy: number;
  };
  rejectedCandidateSummaries: string[];
  explorationPolicy: string;
};

export type AiStrategyProposalResponse = {
  invocation: {
    id: string;
    provider: "claude_cli";
    status: "succeeded" | "failed" | "timeout";
    promptHash: string;
    promptRedacted: string;
    stdoutRaw?: string;
    stderrSummary?: string;
    parsedJson?: unknown;
    timeoutMs: number;
    cliVersion?: string;
    startedAt: string;
    finishedAt: string;
    errorSummary?: string;
  };
  proposal?: AiStrategyProposal;
};

export type DailyReviewInput = {
  reviewDate: string;
  timezone: "Asia/Tokyo";
  accountSummaries: {
    name: string;
    balanceJpy: number;
    realizedPnlJpy: number;
    tradeCount: number;
    maxDrawdownJpy: number;
    status: string;
  }[];
  candidateSummaries: {
    strategyName: string;
    sourceStrategyName: string;
    timeframe: string;
    status: string;
    rationale?: string;
  }[];
  warningSignals: string[];
  operationsContext: {
    liveTradingEnabled: false;
    backupStatus: "unknown" | "ok" | "failed";
    restoreRehearsalStatus: "unknown" | "ok" | "failed";
  };
};

export type DailyReviewRecommendation = {
  strategyName: string;
  reason: string;
  confidence: "low" | "medium" | "high";
};

export type DailyReviewWarning = {
  severity: "info" | "warning" | "critical";
  code: string;
  message: string;
};

export type AiDailyReview = {
  review_date: string;
  summary: string;
  baseline_promotion_candidates: DailyReviewRecommendation[];
  candidate_retirement_candidates: DailyReviewRecommendation[];
  warnings: DailyReviewWarning[];
  next_actions: string[];
};

export type AiDailyReviewResponse = {
  invocation: {
    id: string;
    provider: "claude_cli";
    status: "succeeded" | "failed" | "timeout";
    promptHash: string;
    promptRedacted: string;
    stdoutRaw?: string;
    stderrSummary?: string;
    parsedJson?: unknown;
    timeoutMs: number;
    cliVersion?: string;
    startedAt: string;
    finishedAt: string;
    errorSummary?: string;
  };
  review?: AiDailyReview;
};

export type AiProposalValidationResult =
  | {
      status: "accepted";
      proposal: AiStrategyProposal;
    }
  | {
      status: "rejected";
      reasons: RejectReason[];
    };

/**
 * Realized-PnL-centric scorecard for a single research agent over a recent
 * window. Used as the reward signal for prompt optimization. Realized PnL is the
 * ground truth; proposal acceptance rate is a secondary tie-breaker.
 */
export type AgentScorecard = {
  agentId: string;
  windowDays: number;
  /** Strategy proposals the agent emitted in the window. */
  proposalCount: number;
  /** Proposals that passed deterministic validation (became candidate slots). */
  acceptedProposalCount: number;
  /** acceptedProposalCount / proposalCount (0 when no proposals). */
  acceptanceRate: number;
  /** strategy_runs rows sourced by this agent in the window. */
  adoptedStrategyCount: number;
  /** Closed paper trades on the agent's paper account in the window. */
  tradeCount: number;
  /** Sum of realized PnL (JPY) from those closed trades. */
  realizedPnlJpy: number;
  /** balanceJpy - initialBalanceJpy on the agent's paper account. */
  netAccountPnlJpy: number;
  /** Composite reward. Realized PnL dominates; acceptance is a small bonus. */
  score: number;
};

/** Raw metrics produced by the data layer before the composite score is applied. */
export type AgentScorecardMetrics = Omit<AgentScorecard, "acceptanceRate" | "score">;

/**
 * Request payload for reflective (GEPA-style) prompt optimization. The optimizer
 * is asked to rewrite only the agent's system prompt; allowed tools are never
 * touched and the safety guardrail must be preserved verbatim.
 */
export type PromptOptimizationInput = {
  agentId: string;
  agentName: string;
  characterId: string | null;
  persona: string;
  currentVersion: number;
  currentSystemPrompt: string;
  /** This exact substring MUST be preserved verbatim in the optimized prompt. */
  requiredGuardrail: string;
  scorecard: AgentScorecard;
  recentRejections: {
    candidateStrategyName: string | null;
    sourceStrategyName: string | null;
    rejectReasons: unknown;
  }[];
  recentWinningProposals: {
    strategyName: string;
    realizedPnlJpy: number;
  }[];
};

export type AiPromptOptimization = {
  optimized_system_prompt: string;
  reasoning: string;
  key_changes: string[];
  expected_focus?: string;
};

export type AiPromptOptimizationResponse = {
  invocation: {
    id: string;
    provider: "claude_cli";
    status: "succeeded" | "failed" | "timeout";
    promptHash: string;
    promptRedacted: string;
    stdoutRaw?: string;
    stderrSummary?: string;
    parsedJson?: unknown;
    timeoutMs: number;
    cliVersion?: string;
    startedAt: string;
    finishedAt: string;
    errorSummary?: string;
  };
  optimization?: AiPromptOptimization;
};

export type AiPromptOptimizationValidationResult =
  | {
      status: "accepted";
      optimization: AiPromptOptimization;
    }
  | {
      status: "rejected";
      reasons: RejectReason[];
    };

export type AiDailyReviewValidationResult =
  | {
      status: "accepted";
      review: AiDailyReview;
    }
  | {
      status: "rejected";
      reasons: RejectReason[];
    };
