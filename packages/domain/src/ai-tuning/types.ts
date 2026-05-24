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

export type AiDailyReviewValidationResult =
  | {
      status: "accepted";
      review: AiDailyReview;
    }
  | {
      status: "rejected";
      reasons: RejectReason[];
    };
