import { randomUUID } from "node:crypto";

import { env } from "@ai-trade/config";
import {
  AiAgentRepository,
  type AiInvocationRecordInput,
  AiTuningRepository,
  aiAgentStrategyProposals,
  db,
  type PromptOptimizationRecord,
  type PromptOptimizationRecordInput,
  paperTrades,
  strategyRuns,
} from "@ai-trade/db";
import { COMMON_GUARDRAIL } from "@ai-trade/domain/ai-agents";
import {
  type AgentScorecard,
  type AiPromptOptimizationResponse,
  hasSufficientRoleSignal,
  type PromptOptimizationInput,
  validateAiPromptOptimization,
} from "@ai-trade/domain/ai-tuning";
import { and, desc, eq, gte } from "drizzle-orm";

import type { ServiceHealth, ServiceState, WorkerService } from "../types.js";

/**
 * Per-agent outcome of one optimization pass. `optimized` / `rolled_back` /
 * `rejected` / `skipped` mirror the persisted decision; the remaining values are
 * fast no-op exits that never touch the database.
 */
export type PromptOptimizerAgentDecision =
  | "optimized"
  | "rolled_back"
  | "rejected"
  | "skipped"
  | "trial_pending"
  | "cooldown"
  | "insufficient_data"
  | "error";

export type PromptOptimizerAgentResult = {
  agentId: string;
  agentName: string;
  decision: PromptOptimizerAgentDecision;
  fromVersion: number | null;
  toVersion: number | null;
  baselineScore: number | null;
  observedScore: number | null;
  reason: string;
};

export type PromptOptimizerRunResult = {
  attemptedAt: string;
  enabled: boolean;
  evaluatedAgentCount: number;
  optimizedCount: number;
  rolledBackCount: number;
  rejectedCount: number;
  skippedCount: number;
  agents: PromptOptimizerAgentResult[];
};

/** Context the optimizer needs to score and reflect on a single active agent. */
export type AgentOptimizationContext = {
  agentId: string;
  agentName: string;
  characterId: string | null;
  persona: string;
  currentVersion: number;
  currentSystemPrompt: string;
  /** Current allowed tools. Passed through unchanged: the optimizer never widens capabilities. */
  allowedTools: string[];
  scorecard: AgentScorecard;
  latestOptimization: PromptOptimizationRecord | null;
  recentRejections: PromptOptimizationInput["recentRejections"];
  recentWinningProposals: PromptOptimizationInput["recentWinningProposals"];
};

export interface PromptOptimizerProvider {
  generatePromptOptimization(input: PromptOptimizationInput): Promise<AiPromptOptimizationResponse>;
}

export interface PromptOptimizerContextProvider {
  listActiveAgentContexts(windowDays: number): Promise<AgentOptimizationContext[]>;
}

export interface PromptOptimizerStore {
  recordOptimization(input: PromptOptimizationRecordInput): Promise<PromptOptimizationRecord>;
  createVersion(input: {
    agentId: string;
    systemPrompt: string;
    allowedTools: string[];
    note?: string;
  }): Promise<{ version: number }>;
  rollbackVersion(input: {
    agentId: string;
    sourceVersion: number;
    note?: string;
  }): Promise<{ version: number }>;
  recordInvocation(input: AiInvocationRecordInput): Promise<void>;
}

export type AgentPromptOptimizerServiceOptions = {
  enabled?: boolean;
  intervalMs?: number | null;
  windowDays?: number;
  minProposalsToOptimize?: number;
  minTradesToOptimize?: number;
  minObservationsToOptimize?: number;
  minReviewsToOptimize?: number;
  minCurationDecisionsToOptimize?: number;
  cooldownMs?: number;
  trialPeriodMs?: number;
  rollbackMarginScore?: number;
  provider?: PromptOptimizerProvider;
  contextProvider?: PromptOptimizerContextProvider;
  store?: PromptOptimizerStore;
};

/**
 * Numerical, PnL-driven prompt optimizer (GEPA-style reflective evolution).
 *
 * For each active agent it runs a two-phase autonomous state machine:
 *  1. Trial evaluation — if the latest decision was `optimized` and the trial
 *     window has elapsed, compare the current score against the recorded
 *     baseline. Auto-rollback when the score degrades beyond the margin;
 *     otherwise conclude the trial as kept.
 *  2. Proposal — when no trial is pending (and cooldown + data thresholds are
 *     met), ask the runner to reflect on metrics/rejections/wins and rewrite
 *     ONLY the system prompt. Accepted rewrites auto-promote a new version with
 *     the agent's allowed tools left untouched; the safety guardrail must be
 *     preserved verbatim or the rewrite is rejected.
 */
export class AgentPromptOptimizerService implements WorkerService {
  readonly name = "agent-prompt-optimizer";

  private state: ServiceState = "stopped";
  private latestResult: PromptOptimizerRunResult | null = null;

  private readonly enabled: boolean;
  private readonly intervalMs: number | null;
  private readonly windowDays: number;
  private readonly minProposalsToOptimize: number;
  private readonly minTradesToOptimize: number;
  private readonly minObservationsToOptimize: number;
  private readonly minReviewsToOptimize: number;
  private readonly minCurationDecisionsToOptimize: number;
  private readonly cooldownMs: number;
  private readonly trialPeriodMs: number;
  private readonly rollbackMarginScore: number;
  private readonly provider: PromptOptimizerProvider;
  private readonly contextProvider: PromptOptimizerContextProvider;
  private readonly store: PromptOptimizerStore;
  private interval: ReturnType<typeof setInterval> | null = null;

  constructor(options: AgentPromptOptimizerServiceOptions = {}) {
    this.enabled = options.enabled ?? env.AI_PROMPT_OPTIMIZER_ENABLED;
    this.intervalMs = options.intervalMs === undefined ? 6 * 60 * 60 * 1000 : options.intervalMs;
    this.windowDays = options.windowDays ?? 7;
    this.minProposalsToOptimize = options.minProposalsToOptimize ?? 3;
    this.minTradesToOptimize = options.minTradesToOptimize ?? 5;
    this.minObservationsToOptimize = options.minObservationsToOptimize ?? 5;
    this.minReviewsToOptimize = options.minReviewsToOptimize ?? 3;
    this.minCurationDecisionsToOptimize = options.minCurationDecisionsToOptimize ?? 2;
    this.cooldownMs = options.cooldownMs ?? 24 * 60 * 60 * 1000;
    this.trialPeriodMs = options.trialPeriodMs ?? 24 * 60 * 60 * 1000;
    this.rollbackMarginScore = options.rollbackMarginScore ?? 500;
    this.provider =
      options.provider ?? new HttpPromptOptimizationProvider(env.AI_RUNNER_INTERNAL_URL);
    this.contextProvider = options.contextProvider ?? new DbPromptOptimizerContextProvider();
    this.store = options.store ?? new DbPromptOptimizerStore();
  }

  async start(): Promise<void> {
    this.state = this.enabled ? "ready" : "stopped";

    if (this.enabled && this.intervalMs !== null && this.interval === null) {
      this.interval = setInterval(() => {
        void this.runScheduledOptimization();
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

  async runOnce(now: Date = new Date()): Promise<PromptOptimizerRunResult> {
    if (!this.enabled) {
      const result: PromptOptimizerRunResult = {
        attemptedAt: now.toISOString(),
        enabled: false,
        evaluatedAgentCount: 0,
        optimizedCount: 0,
        rolledBackCount: 0,
        rejectedCount: 0,
        skippedCount: 0,
        agents: [],
      };
      this.latestResult = result;
      return result;
    }

    const contexts = await this.contextProvider.listActiveAgentContexts(this.windowDays);
    const agents: PromptOptimizerAgentResult[] = [];

    for (const context of contexts) {
      agents.push(await this.optimizeAgent(context, now));
    }

    const result: PromptOptimizerRunResult = {
      attemptedAt: now.toISOString(),
      enabled: true,
      evaluatedAgentCount: contexts.length,
      optimizedCount: agents.filter((agent) => agent.decision === "optimized").length,
      rolledBackCount: agents.filter((agent) => agent.decision === "rolled_back").length,
      rejectedCount: agents.filter((agent) => agent.decision === "rejected").length,
      skippedCount: agents.filter((agent) =>
        ["skipped", "trial_pending", "cooldown", "insufficient_data"].includes(agent.decision),
      ).length,
      agents,
    };
    this.latestResult = result;
    return result;
  }

  /** Run the full decision state machine for one agent. */
  async optimizeAgent(
    context: AgentOptimizationContext,
    now: Date = new Date(),
  ): Promise<PromptOptimizerAgentResult> {
    const latest = context.latestOptimization;
    const currentScore = context.scorecard.score;

    // Phase 1: a prior auto-promotion is still inside its trial window.
    if (latest && latest.status === "optimized") {
      const trialElapsedMs = now.getTime() - new Date(latest.createdAt).getTime();

      if (trialElapsedMs < this.trialPeriodMs) {
        return this.result(context, "trial_pending", {
          reason: `Trial in progress (${Math.round(trialElapsedMs / 60000)}m / ${Math.round(
            this.trialPeriodMs / 60000,
          )}m).`,
          baselineScore: latest.baselineScore,
          observedScore: currentScore,
        });
      }

      // Trial concluded: degrade beyond margin → auto-rollback to the prior version.
      if (currentScore < latest.baselineScore - this.rollbackMarginScore) {
        const fromVersion = latest.toVersion ?? context.currentVersion;
        const reasoning = `Auto-rollback: trial score ${currentScore.toFixed(
          0,
        )} fell below baseline ${latest.baselineScore.toFixed(0)} by more than the ${
          this.rollbackMarginScore
        } margin.`;

        await this.store.rollbackVersion({
          agentId: context.agentId,
          sourceVersion: latest.fromVersion,
          note: `Prompt optimizer auto-rollback to v${latest.fromVersion}: ${reasoning}`,
        });
        await this.store.recordOptimization({
          agentId: context.agentId,
          status: "rolled_back",
          fromVersion,
          toVersion: latest.fromVersion,
          baselineScore: latest.baselineScore,
          observedScore: currentScore,
          scorecard: context.scorecard,
          reasoning,
        });

        return this.result(context, "rolled_back", {
          reason: reasoning,
          fromVersion,
          toVersion: latest.fromVersion,
          baselineScore: latest.baselineScore,
          observedScore: currentScore,
        });
      }

      // Trial held / improved: conclude it so the next pass can propose again.
      const reasoning = `Trial kept: score ${currentScore.toFixed(
        0,
      )} held within the rollback margin of baseline ${latest.baselineScore.toFixed(0)}.`;
      await this.store.recordOptimization({
        agentId: context.agentId,
        status: "skipped",
        fromVersion: context.currentVersion,
        toVersion: context.currentVersion,
        baselineScore: latest.baselineScore,
        observedScore: currentScore,
        scorecard: context.scorecard,
        reasoning,
      });

      return this.result(context, "skipped", {
        reason: reasoning,
        baselineScore: latest.baselineScore,
        observedScore: currentScore,
      });
    }

    // Phase 2: no trial pending. Respect cooldown after any prior decision.
    if (latest) {
      const sinceLastMs = now.getTime() - new Date(latest.createdAt).getTime();
      if (sinceLastMs < this.cooldownMs) {
        return this.result(context, "cooldown", {
          reason: `Cooldown active (${Math.round(sinceLastMs / 3600000)}h / ${Math.round(
            this.cooldownMs / 3600000,
          )}h since last decision).`,
          baselineScore: currentScore,
        });
      }
    }

    // Require enough recent signal before spending an optimization call. The
    // threshold is role-aware: traders gate on proposals/trades, but non-trader
    // roles gate on the output their directive produces (observations, reviews,
    // curation decisions) so they are evaluated on their own contribution.
    const role = context.scorecard.role ?? "trader";
    if (
      !hasSufficientRoleSignal(role, context.scorecard, {
        minProposals: this.minProposalsToOptimize,
        minTrades: this.minTradesToOptimize,
        minObservations: this.minObservationsToOptimize,
        minReviews: this.minReviewsToOptimize,
        minCurationDecisions: this.minCurationDecisionsToOptimize,
      })
    ) {
      return this.result(context, "insufficient_data", {
        reason: `Insufficient ${role} signal in the last ${context.scorecard.windowDays}d to justify optimization.`,
        baselineScore: currentScore,
      });
    }

    const input: PromptOptimizationInput = {
      agentId: context.agentId,
      agentName: context.agentName,
      characterId: context.characterId,
      persona: context.persona,
      currentVersion: context.currentVersion,
      currentSystemPrompt: context.currentSystemPrompt,
      requiredGuardrail: COMMON_GUARDRAIL,
      scorecard: context.scorecard,
      recentRejections: context.recentRejections,
      recentWinningProposals: context.recentWinningProposals,
    };

    const response = await this.provider.generatePromptOptimization(input);
    await this.store.recordInvocation(toInvocationRecord(response));

    if (response.optimization === undefined) {
      const reasoning =
        response.invocation.errorSummary ?? "Optimizer did not return an optimization.";
      await this.store.recordOptimization({
        agentId: context.agentId,
        status: "rejected",
        fromVersion: context.currentVersion,
        toVersion: null,
        baselineScore: currentScore,
        observedScore: null,
        scorecard: context.scorecard,
        reasoning,
        promptHash: response.invocation.promptHash,
      });
      return this.result(context, "rejected", {
        reason: reasoning,
        baselineScore: currentScore,
      });
    }

    // Enforce the guardrail verbatim and reject any forbidden-phrase rewrite.
    const validation = validateAiPromptOptimization(response.optimization, {
      requiredGuardrail: COMMON_GUARDRAIL,
    });

    if (validation.status === "rejected") {
      const reasoning = validation.reasons.map((reason) => reason.message).join("; ");
      await this.store.recordOptimization({
        agentId: context.agentId,
        status: "rejected",
        fromVersion: context.currentVersion,
        toVersion: null,
        baselineScore: currentScore,
        observedScore: null,
        scorecard: context.scorecard,
        reasoning,
        promptHash: response.invocation.promptHash,
      });
      return this.result(context, "rejected", {
        reason: reasoning,
        baselineScore: currentScore,
      });
    }

    // Accepted: auto-promote a new version. allowedTools are passed UNCHANGED so
    // the optimizer can never widen the agent's capabilities.
    const { version } = await this.store.createVersion({
      agentId: context.agentId,
      systemPrompt: validation.optimization.optimized_system_prompt,
      allowedTools: context.allowedTools,
      note: `Prompt optimizer auto-promote from v${context.currentVersion} (baseline score ${currentScore.toFixed(
        0,
      )}).`,
    });
    await this.store.recordOptimization({
      agentId: context.agentId,
      status: "optimized",
      fromVersion: context.currentVersion,
      toVersion: version,
      baselineScore: currentScore,
      observedScore: null,
      scorecard: context.scorecard,
      reasoning: validation.optimization.reasoning,
      promptHash: response.invocation.promptHash,
    });

    return this.result(context, "optimized", {
      reason: validation.optimization.reasoning,
      fromVersion: context.currentVersion,
      toVersion: version,
      baselineScore: currentScore,
    });
  }

  private result(
    context: AgentOptimizationContext,
    decision: PromptOptimizerAgentDecision,
    overrides: Partial<Omit<PromptOptimizerAgentResult, "agentId" | "agentName" | "decision">>,
  ): PromptOptimizerAgentResult {
    return {
      agentId: context.agentId,
      agentName: context.agentName,
      decision,
      fromVersion: overrides.fromVersion ?? null,
      toVersion: overrides.toVersion ?? null,
      baselineScore: overrides.baselineScore ?? null,
      observedScore: overrides.observedScore ?? null,
      reason: overrides.reason ?? "",
    };
  }

  private async runScheduledOptimization(): Promise<void> {
    try {
      await this.runOnce();
    } catch (error) {
      this.latestResult = {
        attemptedAt: new Date().toISOString(),
        enabled: this.enabled,
        evaluatedAgentCount: 0,
        optimizedCount: 0,
        rolledBackCount: 0,
        rejectedCount: 0,
        skippedCount: 0,
        agents: [
          {
            agentId: "<all>",
            agentName: "<all>",
            decision: "error",
            fromVersion: null,
            toVersion: null,
            baselineScore: null,
            observedScore: null,
            reason: error instanceof Error ? error.message : String(error),
          },
        ],
      };
    }
  }
}

export class HttpPromptOptimizationProvider implements PromptOptimizerProvider {
  constructor(private readonly baseUrl: string) {}

  async generatePromptOptimization(
    input: PromptOptimizationInput,
  ): Promise<AiPromptOptimizationResponse> {
    const response = await fetch(new URL("/prompt-optimizations", this.baseUrl), {
      method: "POST",
      body: JSON.stringify(input),
      headers: { "content-type": "application/json" },
    });

    if (!response.ok) {
      throw new Error(`ai-runner prompt optimization failed with status ${response.status}`);
    }

    return (await response.json()) as AiPromptOptimizationResponse;
  }
}

export class DbPromptOptimizerContextProvider implements PromptOptimizerContextProvider {
  constructor(private readonly repository = new AiAgentRepository()) {}

  async listActiveAgentContexts(windowDays: number): Promise<AgentOptimizationContext[]> {
    const agents = (await this.repository.listAgents()).filter(
      (agent) => agent.status === "active",
    );
    const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);

    return Promise.all(
      agents.map(async (agent) => {
        const [scorecard, latestOptimization, rejectionRows, winRows] = await Promise.all([
          this.repository.getAgentScorecard(agent.id, windowDays, agent.role),
          this.repository.getLatestPromptOptimization(agent.id),
          db
            .select({
              strategyName: aiAgentStrategyProposals.strategyName,
              rejectionReasons: aiAgentStrategyProposals.rejectionReasons,
            })
            .from(aiAgentStrategyProposals)
            .where(
              and(
                eq(aiAgentStrategyProposals.agentId, agent.id),
                eq(aiAgentStrategyProposals.validationStatus, "rejected"),
              ),
            )
            .orderBy(desc(aiAgentStrategyProposals.createdAt))
            .limit(10),
          db
            .select({
              strategyName: strategyRuns.strategyName,
              pnlJpy: paperTrades.pnlJpy,
            })
            .from(paperTrades)
            .innerJoin(strategyRuns, eq(strategyRuns.id, paperTrades.strategyRunId))
            .where(and(eq(strategyRuns.sourceAgentId, agent.id), gte(paperTrades.closedAt, since))),
        ]);

        return {
          agentId: agent.id,
          agentName: agent.name,
          characterId: agent.characterId,
          persona: agent.persona,
          currentVersion: agent.currentVersion,
          currentSystemPrompt: agent.systemPrompt,
          allowedTools: agent.allowedTools,
          scorecard,
          latestOptimization,
          recentRejections: rejectionRows.map((row) => ({
            candidateStrategyName: row.strategyName,
            sourceStrategyName: null,
            rejectReasons: row.rejectionReasons,
          })),
          recentWinningProposals: aggregateWinningProposals(winRows),
        } satisfies AgentOptimizationContext;
      }),
    );
  }
}

export class DbPromptOptimizerStore implements PromptOptimizerStore {
  constructor(
    private readonly agentRepository = new AiAgentRepository(),
    private readonly tuningRepository = new AiTuningRepository(),
  ) {}

  recordOptimization(input: PromptOptimizationRecordInput): Promise<PromptOptimizationRecord> {
    return this.agentRepository.recordPromptOptimization(input);
  }

  createVersion(input: {
    agentId: string;
    systemPrompt: string;
    allowedTools: string[];
    note?: string;
  }): Promise<{ version: number }> {
    return this.agentRepository.createVersion(input);
  }

  rollbackVersion(input: {
    agentId: string;
    sourceVersion: number;
    note?: string;
  }): Promise<{ version: number }> {
    return this.agentRepository.createVersionFromVersion(input);
  }

  recordInvocation(input: AiInvocationRecordInput): Promise<void> {
    return this.tuningRepository.recordInvocation(input);
  }
}

export class InMemoryPromptOptimizerStore implements PromptOptimizerStore {
  readonly optimizations: PromptOptimizationRecordInput[] = [];
  readonly invocations: AiInvocationRecordInput[] = [];
  readonly versionCreations: { agentId: string; systemPrompt: string; allowedTools: string[] }[] =
    [];
  readonly rollbacks: { agentId: string; sourceVersion: number }[] = [];

  constructor(private nextVersion = 2) {}

  async recordOptimization(
    input: PromptOptimizationRecordInput,
  ): Promise<PromptOptimizationRecord> {
    this.optimizations.push(input);
    return {
      id: randomUUID(),
      agentId: input.agentId,
      status: input.status,
      fromVersion: input.fromVersion,
      toVersion: input.toVersion ?? null,
      baselineScore: input.baselineScore,
      observedScore: input.observedScore ?? null,
      scorecard: input.scorecard,
      reasoning: input.reasoning,
      promptHash: input.promptHash ?? null,
      createdAt: new Date().toISOString(),
    };
  }

  async createVersion(input: {
    agentId: string;
    systemPrompt: string;
    allowedTools: string[];
    note?: string;
  }): Promise<{ version: number }> {
    this.versionCreations.push({
      agentId: input.agentId,
      systemPrompt: input.systemPrompt,
      allowedTools: input.allowedTools,
    });
    return { version: this.nextVersion++ };
  }

  async rollbackVersion(input: {
    agentId: string;
    sourceVersion: number;
    note?: string;
  }): Promise<{ version: number }> {
    this.rollbacks.push({ agentId: input.agentId, sourceVersion: input.sourceVersion });
    return { version: this.nextVersion++ };
  }

  async recordInvocation(input: AiInvocationRecordInput): Promise<void> {
    this.invocations.push(input);
  }
}

function aggregateWinningProposals(
  rows: { strategyName: string; pnlJpy: string }[],
): PromptOptimizationInput["recentWinningProposals"] {
  const totals = new Map<string, number>();

  for (const row of rows) {
    totals.set(row.strategyName, (totals.get(row.strategyName) ?? 0) + Number(row.pnlJpy));
  }

  return [...totals.entries()]
    .map(([strategyName, realizedPnlJpy]) => ({ strategyName, realizedPnlJpy }))
    .filter((entry) => entry.realizedPnlJpy > 0)
    .sort((a, b) => b.realizedPnlJpy - a.realizedPnlJpy)
    .slice(0, 5);
}

function toInvocationRecord(response: AiPromptOptimizationResponse): AiInvocationRecordInput {
  return {
    id: response.invocation.id,
    provider: response.invocation.provider,
    purpose: "prompt_optimization",
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
