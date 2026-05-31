import type { AgentRole } from "../ai-agents/characters.js";
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
  | "indicator_not_configured"
  | "unknown_skill_reference"
  | "duplicate_decision";

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
/**
 * Role-specific activity counts gathered over the scoring window. Traders are
 * scored on PnL/proposals (the fields above); the non-trader roles are scored on
 * these instead, so each crew member is judged on the output its directive asks
 * for rather than on trade PnL it never produces. All fields are optional/absent
 * for legacy trader-only callers and default to 0.
 */
export type AgentRoleActivity = {
  /** Observations the agent emitted in the window (news_analyst output). */
  observationCount: number;
  /** Candidate reviews the agent emitted in the window (risk_auditor output). */
  candidateReviewCount: number;
  /** Of those reviews, how many were acted on — risk_auditor "loss prevented" proxy. */
  appliedReviewCount: number;
  /** Total curation decisions the curator recorded in the window (skill_curator). */
  curationDecisionCount: number;
  /** Curation decisions that were actually applied (promote + retire). */
  curationAppliedCount: number;
  /** Active shared skills in the commons — skill_curator stewardship breadth. */
  sharedSkillCount: number;
};

export type AgentScorecard = {
  agentId: string;
  windowDays: number;
  /** The agent's role. Selects which scoring formula and data gate applies. */
  role?: AgentRole;
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
  /** Role-specific activity counts (used to score non-trader roles). */
  roleActivity?: AgentRoleActivity;
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

/**
 * Skill-curation decision actions. The knowledge curator keeps the shared skill
 * base healthy by promoting reusable private skills to "shared" and retiring
 * stale/contradictory ones (status -> archived, reversible). Merging duplicate
 * skills is intentionally out of scope for the first iteration.
 */
export type SkillCurationAction = "promote" | "retire";

/**
 * A single curation decision proposed by the AI curator. The curator NEVER
 * authors skill content — it only references existing skills by their
 * host-supplied id. `skill_id` is therefore validated against the exact set of
 * candidate ids the host put in the prompt; ids the model invents are rejected.
 */
export type SkillCurationDecision = {
  action: SkillCurationAction;
  /** Host-side real skill id. Must match one of the supplied candidate ids. */
  skill_id: string;
  reason: string;
  confidence: "low" | "medium" | "high";
};

export type AiSkillCuration = {
  decisions: SkillCurationDecision[];
  reasoning: string;
};

/** A skill offered to the curator for a promote/retire decision. */
export type SkillCurationCandidate = {
  skillId: string;
  agentId: string;
  agentName: string;
  scope: "private" | "shared";
  status: "draft" | "active" | "archived";
  title: string;
  tags: string[];
  reason: string;
  /** Truncated body so the curator can judge without unbounded prompt growth. */
  bodyPreview: string;
  createdAt: string;
  ageDays: number;
};

/**
 * Request payload for a skill-curation run. The curator is asked to triage the
 * supplied candidates only; it cannot create skills or write skill bodies.
 */
export type SkillCurationInput = {
  curatorAgentId: string;
  curatorAgentName: string;
  windowDays: number;
  candidates: SkillCurationCandidate[];
};

export type AiSkillCurationResponse = {
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
  curation?: AiSkillCuration;
};

export type AiSkillCurationValidationResult =
  | {
      status: "accepted";
      curation: AiSkillCuration;
    }
  | {
      status: "rejected";
      reasons: RejectReason[];
    };
