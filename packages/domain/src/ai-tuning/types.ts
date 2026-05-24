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

export type AiProposalValidationResult =
  | {
      status: "accepted";
      proposal: AiStrategyProposal;
    }
  | {
      status: "rejected";
      reasons: RejectReason[];
    };
