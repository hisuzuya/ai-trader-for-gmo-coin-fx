import type { RejectReason } from "../ai-tuning/types";
import type { StrategyDefinition } from "../strategies/types";
import type { CharacterId } from "./characters";

export const AGENT_RESEARCH_TOOL_NAMES = [
  "read_bars",
  "calc_indicator",
  "get_candidate_performance",
  "get_rejection_history",
  "recall_memory",
] as const;

export type AgentResearchToolName = (typeof AGENT_RESEARCH_TOOL_NAMES)[number];

export type AgentObservation = {
  kind: "market" | "candidate_performance" | "risk" | "operations";
  summary: string;
  evidence: string[];
  tags: string[];
};

export type AgentStrategyProposal = {
  rationale: string;
  strategy: StrategyDefinition;
  expectedEdge: string;
  risks: string[];
  memoryRefs: string[];
};

export type CandidateReview = {
  strategyName: string;
  recommendation: "continue" | "retire" | "promote";
  confidence: "low" | "medium" | "high";
  reason: string;
  evidence: string[];
};

export type AgentMemoryWrite = {
  type: "market_observation" | "strategy_hypothesis" | "proposal_review" | "rejection_learning";
  content: string;
  tags: string[];
  sourceRefs: string[];
};

export type AgentRunOutput = {
  observations: AgentObservation[];
  strategyProposals: AgentStrategyProposal[];
  candidateReviews: CandidateReview[];
  memoryWrites: AgentMemoryWrite[];
};

export type AgentRunOutputValidationResult =
  | {
      status: "accepted";
      output: AgentRunOutput;
    }
  | {
      status: "rejected";
      reasons: RejectReason[];
    };

export type AgentDefinition = {
  id: string;
  name: string;
  persona: string;
  systemPrompt: string;
  allowedTools: AgentResearchToolName[];
  status: "active" | "paused";
  currentVersion: number;
  runIntervalSec: number;
  model: string;
  maxConsecutiveFailures: number;
  consecutiveFailures: number;
  tokenBudgetPerRun: number;
  costBudgetPerRunUsd: number;
  pausedReason?: string;
  sharedMemoryEnabled: boolean;
  characterId: CharacterId | null;
};

export type AgentRunRequest = {
  agent: AgentDefinition;
  contextSummary: string;
  version: number;
  maxToolHops?: number;
  timeoutMs?: number;
  outputSizeLimitBytes?: number;
};

export type AgentToolCallLog = {
  name: AgentResearchToolName;
  argsSummary: unknown;
  resultSummary: unknown;
};

export type AgentRunResponse = {
  ok: boolean;
  status: "succeeded" | "failed" | "timeout" | "rejected_output";
  output?: AgentRunOutput;
  outputSummary?: unknown;
  toolCalls: AgentToolCallLog[];
  tokenUsage?: unknown;
  error?: string;
  startedAt: string;
  finishedAt: string;
};
