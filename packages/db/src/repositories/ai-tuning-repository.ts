import type { AiProposalValidationResult, AiStrategyProposal } from "@ai-trade/domain/ai-tuning";
import type { StrategyDefinition } from "@ai-trade/domain/strategies";

import { db } from "../client.js";
import { aiInvocations, aiTuningProposals, strategyRuns } from "../schema/index.js";

type AiTuningDatabase = Pick<typeof db, "insert" | "transaction">;

export type AiInvocationRecordInput = {
  id: string;
  provider: string;
  purpose: "strategy_tuning" | "daily_review";
  promptHash: string;
  promptRedacted: string;
  stdoutRaw?: string;
  stderrSummary?: string;
  parsedJson?: unknown;
  status: "succeeded" | "failed" | "timeout";
  timeoutMs: number;
  cliVersion?: string;
  startedAt: Date;
  finishedAt: Date;
  errorSummary?: string;
};

export type AiTuningProposalRecordInput = {
  id: string;
  invocationId?: string;
  sourceStrategyName: string;
  symbol: string;
  timeframe: string;
  validation: AiProposalValidationResult;
};

export class AiTuningRepository {
  constructor(private readonly database: AiTuningDatabase = db) {}

  async recordInvocation(input: AiInvocationRecordInput): Promise<void> {
    await this.database.insert(aiInvocations).values(toAiInvocationInsertRow(input));
  }

  async recordProposal(input: AiTuningProposalRecordInput): Promise<void> {
    await this.database.transaction(async (tx) => {
      const proposalRow = toAiTuningProposalInsertRow(input);
      await tx.insert(aiTuningProposals).values(proposalRow);

      if (input.validation.status !== "accepted") {
        return;
      }

      await tx.insert(strategyRuns).values({
        id: input.id,
        strategyName: input.validation.proposal.strategy.meta.name,
        symbol: input.validation.proposal.strategy.meta.symbol,
        timeframe: input.validation.proposal.strategy.meta.timeframe,
        status: "proposed",
        strategyDefinition: input.validation.proposal.strategy,
        startedAt: new Date(),
        finishedAt: new Date(),
        metadata: {
          aiTuningProposalId: input.id,
          sourceStrategyName: input.sourceStrategyName,
          candidateSlot: true,
        },
      });
    });
  }
}

export function toAiInvocationInsertRow(input: AiInvocationRecordInput) {
  return {
    id: input.id,
    provider: input.provider,
    purpose: input.purpose,
    promptHash: input.promptHash,
    promptRedacted: input.promptRedacted,
    stdoutRaw: input.stdoutRaw,
    stderrSummary: input.stderrSummary,
    parsedJson: input.parsedJson,
    status: input.status,
    timeoutMs: input.timeoutMs.toFixed(0),
    cliVersion: input.cliVersion,
    startedAt: input.startedAt,
    finishedAt: input.finishedAt,
    errorSummary: input.errorSummary,
  };
}

export function toAiTuningProposalInsertRow(input: AiTuningProposalRecordInput) {
  if (input.validation.status === "accepted") {
    return acceptedProposalRow(input, input.validation.proposal);
  }

  return {
    id: input.id,
    invocationId: input.invocationId,
    sourceStrategyName: input.sourceStrategyName,
    candidateStrategyName: undefined,
    symbol: input.symbol,
    timeframe: input.timeframe,
    status: "rejected" as const,
    rationale: undefined,
    strategyDefinition: undefined,
    rejectReasons: input.validation.reasons,
    insertedIntoPaper: false,
  };
}

function acceptedProposalRow(input: AiTuningProposalRecordInput, proposal: AiStrategyProposal) {
  return {
    id: input.id,
    invocationId: input.invocationId,
    sourceStrategyName: input.sourceStrategyName,
    candidateStrategyName: proposal.strategy.meta.name,
    symbol: proposal.strategy.meta.symbol,
    timeframe: proposal.strategy.meta.timeframe,
    status: "accepted" as const,
    rationale: proposal.rationale,
    strategyDefinition: proposal.strategy satisfies StrategyDefinition,
    rejectReasons: undefined,
    insertedIntoPaper: true,
  };
}
