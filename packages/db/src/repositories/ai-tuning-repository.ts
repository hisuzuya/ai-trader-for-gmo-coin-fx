import type { AiProposalValidationResult, AiStrategyProposal } from "@ai-trade/domain/ai-tuning";
import type { StrategyDefinition } from "@ai-trade/domain/strategies";
import { and, asc, eq } from "drizzle-orm";

import { db } from "../client.js";
import { aiInvocations, aiTuningProposals, strategyRuns } from "../schema/index.js";

type AiTuningDatabase = Pick<typeof db, "insert" | "transaction">;
const MAX_CANDIDATE_SLOTS_PER_TIMEFRAME = 3;

export type AiInvocationRecordInput = {
  id: string;
  provider: string;
  purpose: "strategy_tuning" | "daily_review" | "prompt_optimization" | "skill_curation";
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

      const activeCandidateRows = await tx
        .select({
          id: strategyRuns.id,
          strategyName: strategyRuns.strategyName,
          metadata: strategyRuns.metadata,
        })
        .from(strategyRuns)
        .where(
          and(
            eq(strategyRuns.timeframe, input.validation.proposal.strategy.meta.timeframe),
            eq(strategyRuns.status, "proposed"),
          ),
        )
        .orderBy(asc(strategyRuns.startedAt));
      const activeCandidates = activeCandidateRows.filter((row) => isCandidateSlot(row.metadata));
      const retireCount = Math.max(
        0,
        activeCandidates.length - (MAX_CANDIDATE_SLOTS_PER_TIMEFRAME - 1),
      );
      const candidatesToRetire = activeCandidates.slice(0, retireCount);
      const now = new Date();

      for (const candidate of candidatesToRetire) {
        await tx
          .update(strategyRuns)
          .set({
            status: "retired",
            finishedAt: now,
            metadata: {
              ...(isRecord(candidate.metadata) ? candidate.metadata : {}),
              candidateSlotAutoRetired: true,
              replacementStrategyRunId: input.id,
              retiredAt: now.toISOString(),
              reason: "candidate slot limit exceeded",
            },
          })
          .where(eq(strategyRuns.id, candidate.id));
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

function isCandidateSlot(metadata: unknown): boolean {
  return isRecord(metadata) && metadata.candidateSlot === true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
