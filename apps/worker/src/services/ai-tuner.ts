import { randomUUID } from "node:crypto";

import { env } from "@ai-trade/config";
import {
  type AiInvocationRecordInput,
  type AiTuningProposalRecordInput,
  AiTuningRepository,
} from "@ai-trade/db";
import type { AiStrategyProposalResponse, StrategyProposalInput } from "@ai-trade/domain/ai-tuning";
import {
  baselineStrategies,
  type StrategyDefinition,
  validateAiStrategyProposal,
} from "@ai-trade/domain/strategies";

import type { ServiceHealth, ServiceState, WorkerService } from "../types.js";

export type AiTuningRunResult = {
  attemptedAt: string;
  sourceStrategyName: string;
  invocationStatus: "succeeded" | "failed" | "timeout";
  proposalStatus: "accepted" | "rejected" | "failed";
  candidateStrategyName: string | null;
  reason: string;
};

export interface AiProvider {
  generateStrategyProposal(input: StrategyProposalInput): Promise<AiStrategyProposalResponse>;
}

export interface AiTuningStore {
  recordInvocation(input: AiInvocationRecordInput): Promise<void>;
  recordProposal(input: AiTuningProposalRecordInput): Promise<void>;
}

export type AiTunerServiceOptions = {
  enabled?: boolean;
  intervalMs?: number | null;
  strategies?: StrategyDefinition[];
  aiProvider?: AiProvider;
  store?: AiTuningStore;
};

export class AiTunerService implements WorkerService {
  readonly name = "ai-tuner";

  private state: ServiceState = "stopped";
  private latestResult: AiTuningRunResult | null = null;

  private readonly enabled: boolean;
  private readonly intervalMs: number | null;
  private readonly strategies: StrategyDefinition[];
  private readonly aiProvider: AiProvider;
  private readonly store: AiTuningStore;
  private interval: ReturnType<typeof setInterval> | null = null;

  constructor(options: AiTunerServiceOptions = {}) {
    this.enabled = options.enabled ?? env.AI_TUNING_ENABLED;
    this.intervalMs = options.intervalMs === undefined ? 60 * 60 * 1000 : options.intervalMs;
    this.strategies = options.strategies ?? baselineStrategies;
    this.aiProvider = options.aiProvider ?? new HttpAiProvider(env.AI_RUNNER_INTERNAL_URL);
    this.store = options.store ?? new AiTuningRepository();
  }

  async start(): Promise<void> {
    this.state = this.enabled ? "ready" : "stopped";

    if (this.enabled && this.intervalMs !== null && this.interval === null) {
      this.interval = setInterval(() => {
        void this.runScheduledTuning();
      }, this.intervalMs);
      this.interval.unref?.();
    }
  }

  async stop(): Promise<void> {
    if (this.interval !== null) {
      clearInterval(this.interval);
      this.interval = null;
    }

    this.state = "stopped";
  }

  async health(): Promise<ServiceHealth> {
    return {
      name: this.name,
      state: this.state,
      details: {
        enabled: this.enabled,
        latestResult: this.latestResult,
      },
    };
  }

  async runOnce(now: Date = new Date()): Promise<AiTuningRunResult> {
    if (!this.enabled) {
      const result = {
        attemptedAt: now.toISOString(),
        sourceStrategyName: this.strategies[0]?.meta.name ?? "unknown",
        invocationStatus: "failed" as const,
        proposalStatus: "failed" as const,
        candidateStrategyName: null,
        reason: "AI tuning is disabled. Set AI_TUNING_ENABLED=true to run.",
      };
      this.latestResult = result;
      return result;
    }

    const sourceStrategy = this.strategies[0];
    if (!sourceStrategy) {
      throw new Error("No Baseline Strategy is configured for AI tuning.");
    }

    const response = await this.aiProvider.generateStrategyProposal(
      buildStrategyProposalInput(sourceStrategy),
    );
    await this.store.recordInvocation(toInvocationRecord(response));

    if (response.proposal === undefined) {
      const result = {
        attemptedAt: now.toISOString(),
        sourceStrategyName: sourceStrategy.meta.name,
        invocationStatus: response.invocation.status,
        proposalStatus: "failed" as const,
        candidateStrategyName: null,
        reason: response.invocation.errorSummary ?? "AI provider did not return a proposal.",
      };
      this.latestResult = result;
      return result;
    }

    const validation = validateAiStrategyProposal(response.proposal);
    const proposalId = randomUUID();
    await this.store.recordProposal({
      id: proposalId,
      invocationId: response.invocation.id,
      sourceStrategyName: sourceStrategy.meta.name,
      symbol: sourceStrategy.meta.symbol,
      timeframe: sourceStrategy.meta.timeframe,
      validation,
    });

    const result =
      validation.status === "accepted"
        ? {
            attemptedAt: now.toISOString(),
            sourceStrategyName: sourceStrategy.meta.name,
            invocationStatus: response.invocation.status,
            proposalStatus: "accepted" as const,
            candidateStrategyName: validation.proposal.strategy.meta.name,
            reason: validation.proposal.rationale,
          }
        : {
            attemptedAt: now.toISOString(),
            sourceStrategyName: sourceStrategy.meta.name,
            invocationStatus: response.invocation.status,
            proposalStatus: "rejected" as const,
            candidateStrategyName: null,
            reason: validation.reasons.map((reason) => reason.message).join("; "),
          };
    this.latestResult = result;
    return result;
  }

  private async runScheduledTuning(): Promise<void> {
    try {
      await this.runOnce();
    } catch (error) {
      this.latestResult = {
        attemptedAt: new Date().toISOString(),
        sourceStrategyName: this.strategies[0]?.meta.name ?? "unknown",
        invocationStatus: "failed",
        proposalStatus: "failed",
        candidateStrategyName: null,
        reason: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

export class HttpAiProvider implements AiProvider {
  constructor(private readonly baseUrl: string) {}

  async generateStrategyProposal(
    input: StrategyProposalInput,
  ): Promise<AiStrategyProposalResponse> {
    const response = await fetch(new URL("/strategy-proposals", this.baseUrl), {
      method: "POST",
      body: JSON.stringify(input),
      headers: { "content-type": "application/json" },
    });

    if (!response.ok) {
      throw new Error(`ai-runner strategy proposal failed with status ${response.status}`);
    }

    return (await response.json()) as AiStrategyProposalResponse;
  }
}

export class InMemoryAiTuningStore implements AiTuningStore {
  readonly invocations: AiInvocationRecordInput[] = [];
  readonly proposals: AiTuningProposalRecordInput[] = [];

  async recordInvocation(input: AiInvocationRecordInput): Promise<void> {
    this.invocations.push(input);
  }

  async recordProposal(input: AiTuningProposalRecordInput): Promise<void> {
    this.proposals.push(input);
  }
}

function buildStrategyProposalInput(baseline: StrategyDefinition): StrategyProposalInput {
  return {
    baseline,
    recentPerformance: {
      netProfitJpy: 0,
      tradeCount: 0,
      maxDrawdownJpy: 0,
    },
    rejectedCandidateSummaries: [],
    explorationPolicy:
      "Keep Risk Gates at least as strict as the current Baseline Strategy. Prefer small parameter changes suitable for Paper Trading validation.",
  };
}

function toInvocationRecord(response: AiStrategyProposalResponse): AiInvocationRecordInput {
  return {
    id: response.invocation.id,
    provider: response.invocation.provider,
    purpose: "strategy_tuning",
    promptHash: response.invocation.promptHash,
    promptRedacted: response.invocation.promptRedacted,
    stdoutRaw: response.invocation.stdoutRaw,
    stderrSummary: response.invocation.stderrSummary,
    parsedJson: response.invocation.parsedJson,
    status: response.invocation.status,
    timeoutMs: response.invocation.timeoutMs,
    cliVersion: response.invocation.cliVersion,
    startedAt: new Date(response.invocation.startedAt),
    finishedAt: new Date(response.invocation.finishedAt),
    errorSummary: response.invocation.errorSummary,
  };
}
