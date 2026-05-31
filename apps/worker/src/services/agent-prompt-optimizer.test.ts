import { randomUUID } from "node:crypto";

import type { PromptOptimizationRecord } from "@ai-trade/db";
import { COMMON_GUARDRAIL } from "@ai-trade/domain/ai-agents";
import type {
  AgentScorecard,
  AiPromptOptimization,
  AiPromptOptimizationResponse,
  PromptOptimizationInput,
} from "@ai-trade/domain/ai-tuning";
import { describe, expect, it } from "vitest";

import {
  type AgentOptimizationContext,
  AgentPromptOptimizerService,
  InMemoryPromptOptimizerStore,
  type PromptOptimizerContextProvider,
  type PromptOptimizerProvider,
} from "./agent-prompt-optimizer.js";

const NOW = new Date("2026-05-31T00:00:00Z");
const HOUR_MS = 60 * 60 * 1000;

class FakeProvider implements PromptOptimizerProvider {
  readonly calls: PromptOptimizationInput[] = [];

  constructor(
    private readonly optimization: AiPromptOptimization | undefined,
    private readonly errorSummary?: string,
  ) {}

  async generatePromptOptimization(
    input: PromptOptimizationInput,
  ): Promise<AiPromptOptimizationResponse> {
    this.calls.push(input);
    return {
      invocation: {
        id: randomUUID(),
        provider: "claude_cli",
        status: this.optimization ? "succeeded" : "failed",
        promptHash: "hash",
        promptRedacted: "redacted",
        timeoutMs: 180_000,
        startedAt: NOW.toISOString(),
        finishedAt: NOW.toISOString(),
        errorSummary: this.errorSummary,
      },
      optimization: this.optimization,
    };
  }
}

class StaticContextProvider implements PromptOptimizerContextProvider {
  constructor(private readonly contexts: AgentOptimizationContext[]) {}

  async listActiveAgentContexts(): Promise<AgentOptimizationContext[]> {
    return this.contexts;
  }
}

function scorecard(overrides: Partial<AgentScorecard> = {}): AgentScorecard {
  return {
    agentId: "agent-1",
    windowDays: 7,
    proposalCount: 5,
    acceptedProposalCount: 3,
    acceptanceRate: 0.6,
    adoptedStrategyCount: 1,
    tradeCount: 10,
    realizedPnlJpy: 1_000,
    netAccountPnlJpy: 1_000,
    score: 1_000,
    ...overrides,
  };
}

function context(overrides: Partial<AgentOptimizationContext> = {}): AgentOptimizationContext {
  return {
    agentId: "agent-1",
    agentName: "ceres",
    characterId: "ceres",
    persona: "analyst",
    currentVersion: 1,
    currentSystemPrompt: `現行プロンプト。${COMMON_GUARDRAIL}`,
    allowedTools: ["get_recent_candles", "list_candidate_strategies"],
    scorecard: scorecard(),
    latestOptimization: null,
    recentRejections: [],
    recentWinningProposals: [],
    ...overrides,
  };
}

function optimizationRecord(
  overrides: Partial<PromptOptimizationRecord> = {},
): PromptOptimizationRecord {
  return {
    id: "opt-1",
    agentId: "agent-1",
    status: "optimized",
    fromVersion: 1,
    toVersion: 2,
    baselineScore: 1_000,
    observedScore: null,
    scorecard: scorecard(),
    reasoning: "previous decision",
    promptHash: null,
    createdAt: NOW.toISOString(),
    ...overrides,
  };
}

const ACCEPTED_OPTIMIZATION: AiPromptOptimization = {
  optimized_system_prompt: `改善後のプロンプト。再現性のある根拠と損切り条件を必須にします。${COMMON_GUARDRAIL}`,
  reasoning: "直近の却下理由を反映して損切り条件を明示した。",
  key_changes: ["損切り条件を必須化"],
};

function buildService(options: {
  contexts: AgentOptimizationContext[];
  provider: FakeProvider;
  store: InMemoryPromptOptimizerStore;
}) {
  return new AgentPromptOptimizerService({
    enabled: true,
    intervalMs: null,
    provider: options.provider,
    contextProvider: new StaticContextProvider(options.contexts),
    store: options.store,
  });
}

describe("AgentPromptOptimizerService.runOnce", () => {
  it("returns an empty disabled result when the optimizer is off", async () => {
    const provider = new FakeProvider(ACCEPTED_OPTIMIZATION);
    const service = new AgentPromptOptimizerService({
      enabled: false,
      intervalMs: null,
      provider,
      contextProvider: new StaticContextProvider([context()]),
      store: new InMemoryPromptOptimizerStore(),
    });

    const result = await service.runOnce(NOW);

    expect(result.enabled).toBe(false);
    expect(result.agents).toHaveLength(0);
    expect(provider.calls).toHaveLength(0);
  });

  it("auto-promotes a new version without changing allowed tools when accepted", async () => {
    const store = new InMemoryPromptOptimizerStore();
    const provider = new FakeProvider(ACCEPTED_OPTIMIZATION);
    const service = buildService({ contexts: [context()], provider, store });

    const result = await service.runOnce(NOW);

    expect(result.optimizedCount).toBe(1);
    expect(result.agents[0]?.decision).toBe("optimized");
    expect(result.agents[0]?.toVersion).toBe(2);
    expect(provider.calls[0]?.requiredGuardrail).toBe(COMMON_GUARDRAIL);
    expect(store.versionCreations).toHaveLength(1);
    // allowed tools are passed through unchanged — the optimizer never widens capabilities.
    expect(store.versionCreations[0]?.allowedTools).toEqual([
      "get_recent_candles",
      "list_candidate_strategies",
    ]);
    expect(store.optimizations[0]?.status).toBe("optimized");
    expect(store.optimizations[0]?.baselineScore).toBe(1_000);
    expect(store.invocations[0]?.purpose).toBe("prompt_optimization");
  });

  it("rejects and does not promote when the guardrail is dropped", async () => {
    const store = new InMemoryPromptOptimizerStore();
    const provider = new FakeProvider({
      optimized_system_prompt:
        "ガードレールを省いた十分な長さのプロンプト文字列をここに用意します。",
      reasoning: "ガードレールを外した",
      key_changes: ["削除"],
    });
    const service = buildService({ contexts: [context()], provider, store });

    const result = await service.runOnce(NOW);

    expect(result.rejectedCount).toBe(1);
    expect(result.agents[0]?.decision).toBe("rejected");
    expect(store.versionCreations).toHaveLength(0);
    expect(store.optimizations[0]?.status).toBe("rejected");
  });

  it("records a rejection when the runner returns no optimization", async () => {
    const store = new InMemoryPromptOptimizerStore();
    const provider = new FakeProvider(undefined, "runner timed out");
    const service = buildService({ contexts: [context()], provider, store });

    const result = await service.runOnce(NOW);

    expect(result.agents[0]?.decision).toBe("rejected");
    expect(store.optimizations[0]?.reasoning).toBe("runner timed out");
    expect(store.versionCreations).toHaveLength(0);
  });

  it("waits during the trial period without writing or calling the runner", async () => {
    const store = new InMemoryPromptOptimizerStore();
    const provider = new FakeProvider(ACCEPTED_OPTIMIZATION);
    const latestOptimization = optimizationRecord({
      status: "optimized",
      createdAt: new Date(NOW.getTime() - 1 * HOUR_MS).toISOString(),
    });
    const service = buildService({
      contexts: [context({ latestOptimization })],
      provider,
      store,
    });

    const result = await service.runOnce(NOW);

    expect(result.agents[0]?.decision).toBe("trial_pending");
    expect(provider.calls).toHaveLength(0);
    expect(store.optimizations).toHaveLength(0);
  });

  it("auto-rolls back when the trial score degrades beyond the margin", async () => {
    const store = new InMemoryPromptOptimizerStore();
    const provider = new FakeProvider(ACCEPTED_OPTIMIZATION);
    const latestOptimization = optimizationRecord({
      status: "optimized",
      fromVersion: 1,
      toVersion: 2,
      baselineScore: 1_000,
      createdAt: new Date(NOW.getTime() - 25 * HOUR_MS).toISOString(),
    });
    const service = buildService({
      contexts: [context({ latestOptimization, scorecard: scorecard({ score: 400 }) })],
      provider,
      store,
    });

    const result = await service.runOnce(NOW);

    expect(result.rolledBackCount).toBe(1);
    expect(result.agents[0]?.decision).toBe("rolled_back");
    expect(store.rollbacks[0]).toEqual({ agentId: "agent-1", sourceVersion: 1 });
    expect(store.optimizations[0]?.status).toBe("rolled_back");
    expect(store.optimizations[0]?.observedScore).toBe(400);
    expect(provider.calls).toHaveLength(0);
  });

  it("keeps the optimized version when the trial score holds", async () => {
    const store = new InMemoryPromptOptimizerStore();
    const provider = new FakeProvider(ACCEPTED_OPTIMIZATION);
    const latestOptimization = optimizationRecord({
      status: "optimized",
      baselineScore: 1_000,
      createdAt: new Date(NOW.getTime() - 25 * HOUR_MS).toISOString(),
    });
    const service = buildService({
      contexts: [context({ latestOptimization, scorecard: scorecard({ score: 1_000 }) })],
      provider,
      store,
    });

    const result = await service.runOnce(NOW);

    expect(result.agents[0]?.decision).toBe("skipped");
    expect(store.rollbacks).toHaveLength(0);
    expect(store.versionCreations).toHaveLength(0);
    expect(store.optimizations[0]?.status).toBe("skipped");
  });

  it("respects the cooldown after a terminal decision", async () => {
    const store = new InMemoryPromptOptimizerStore();
    const provider = new FakeProvider(ACCEPTED_OPTIMIZATION);
    const latestOptimization = optimizationRecord({
      status: "rejected",
      toVersion: null,
      createdAt: new Date(NOW.getTime() - 1 * HOUR_MS).toISOString(),
    });
    const service = buildService({
      contexts: [context({ latestOptimization })],
      provider,
      store,
    });

    const result = await service.runOnce(NOW);

    expect(result.agents[0]?.decision).toBe("cooldown");
    expect(provider.calls).toHaveLength(0);
    expect(store.optimizations).toHaveLength(0);
  });

  it("skips when there is not enough recent signal to optimize", async () => {
    const store = new InMemoryPromptOptimizerStore();
    const provider = new FakeProvider(ACCEPTED_OPTIMIZATION);
    const service = buildService({
      contexts: [context({ scorecard: scorecard({ proposalCount: 1, tradeCount: 2 }) })],
      provider,
      store,
    });

    const result = await service.runOnce(NOW);

    expect(result.agents[0]?.decision).toBe("insufficient_data");
    expect(provider.calls).toHaveLength(0);
    expect(store.optimizations).toHaveLength(0);
  });
});
