import type {
  AiDailyReviewResponse,
  AiPromptOptimizationResponse,
  AiStrategyProposalResponse,
  DailyReviewInput,
  PromptOptimizationInput,
  StrategyProposalInput,
} from "@ai-trade/domain/ai-tuning";
import { BASELINE_STRATEGIES } from "@ai-trade/domain/strategies";
import { describe, expect, it, vi } from "vitest";

import { AiAgentRunner } from "./agent-loop/agent-runner.js";
import { createAiRunnerApp } from "./hono-app.js";

describe("ai-runner Hono app", () => {
  it("returns liveness health with disabled Claude CLI provider state", async () => {
    const response = await createAiRunnerApp(fakeProvider()).request("/health");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      ok: true,
      service: "ai-runner",
      provider: {
        name: "claude_cli",
        mode: "disabled",
        implementation: "claude_cli",
        enabled: false,
        ready: false,
        reason: "test disabled",
      },
    });
  });

  it("returns readiness based on provider state", async () => {
    const response = await createAiRunnerApp(fakeProvider()).request("/ready");
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.ok).toBe(false);
    expect(body.provider.ready).toBe(false);
  });

  it("invokes Claude CLI through the provider", async () => {
    const provider = fakeProvider();

    const response = await createAiRunnerApp(provider).request("/invoke", {
      method: "POST",
      body: JSON.stringify({ prompt: 'Return JSON only: {"ok":true}', timeoutMs: 30000 }),
      headers: { "content-type": "application/json" },
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ ok: true, stdout: '{"ok":true}' });
    expect(provider.invoke).toHaveBeenCalledWith({
      prompt: 'Return JSON only: {"ok":true}',
      timeoutMs: 30000,
    });
  });

  it("generates a strategy proposal through the provider", async () => {
    const provider = fakeProvider({
      invocation: {
        id: "invocation-1",
        provider: "claude_cli",
        status: "succeeded",
        promptHash: "hash",
        promptRedacted: "{}",
        timeoutMs: 120000,
        startedAt: "2026-05-24T00:00:00.000Z",
        finishedAt: "2026-05-24T00:00:01.000Z",
      },
      proposal: {
        proposal_id: "proposal-1",
        rationale: "Tighten spread gate.",
        strategy: {
          ...BASELINE_STRATEGIES["5m"],
          meta: {
            ...BASELINE_STRATEGIES["5m"].meta,
            name: "candidate_5m_spread_tight",
          },
        },
      },
    });
    const input = strategyProposalInput();

    const response = await createAiRunnerApp(provider).request("/strategy-proposals", {
      method: "POST",
      body: JSON.stringify(input),
      headers: { "content-type": "application/json" },
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.proposal.strategy.meta.name).toBe("candidate_5m_spread_tight");
    expect(provider.generateStrategyProposal).toHaveBeenCalledWith(input);
  });

  it("rejects malformed proposal requests", async () => {
    const provider = fakeProvider();

    const response = await createAiRunnerApp(provider).request("/strategy-proposals", {
      method: "POST",
      body: JSON.stringify({}),
      headers: { "content-type": "application/json" },
    });

    expect(response.status).toBe(400);
    expect(provider.generateStrategyProposal).not.toHaveBeenCalled();
  });

  it("generates a Daily Review through the provider", async () => {
    const provider = fakeProvider(undefined, {
      invocation: {
        id: "daily-invocation-1",
        provider: "claude_cli",
        status: "succeeded",
        promptHash: "hash",
        promptRedacted: "{}",
        timeoutMs: 180000,
        startedAt: "2026-05-24T00:00:00.000Z",
        finishedAt: "2026-05-24T00:00:01.000Z",
      },
      review: {
        review_date: "2026-05-24",
        summary: "Paper trading is stable.",
        baseline_promotion_candidates: [],
        candidate_retirement_candidates: [],
        warnings: [{ severity: "info", code: "NO_ACTION", message: "No action required." }],
        next_actions: ["Continue paper run."],
      },
    });
    const input = dailyReviewInput();

    const response = await createAiRunnerApp(provider).request("/daily-reviews", {
      method: "POST",
      body: JSON.stringify(input),
      headers: { "content-type": "application/json" },
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.review.summary).toBe("Paper trading is stable.");
    expect(provider.generateDailyReview).toHaveBeenCalledWith(input);
  });

  it("generates a prompt optimization through the provider", async () => {
    const provider = fakeProvider(undefined, undefined, {
      invocation: {
        id: "optimization-invocation-1",
        provider: "claude_cli",
        status: "succeeded",
        promptHash: "hash",
        promptRedacted: "{}",
        timeoutMs: 180000,
        startedAt: "2026-05-24T00:00:00.000Z",
        finishedAt: "2026-05-24T00:00:01.000Z",
      },
      optimization: {
        optimized_system_prompt: `改善されたシステムプロンプト。${GUARDRAIL}`,
        reasoning: "実現損益が伸び悩んでいるため、損切り基準を明確化しました。",
        key_changes: ["損切り条件を明示", "勝ちパターンの再現性を強調"],
        expected_focus: "実現損益の安定化",
      },
    });
    const input = promptOptimizationInput();

    const response = await createAiRunnerApp(provider).request("/prompt-optimizations", {
      method: "POST",
      body: JSON.stringify(input),
      headers: { "content-type": "application/json" },
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.optimization.optimized_system_prompt).toContain(GUARDRAIL);
    expect(provider.generatePromptOptimization).toHaveBeenCalledWith(input);
  });

  it("rejects a prompt optimization request missing the required guardrail field", async () => {
    const provider = fakeProvider();
    const { requiredGuardrail: _omitted, ...invalid } = promptOptimizationInput();

    const response = await createAiRunnerApp(provider).request("/prompt-optimizations", {
      method: "POST",
      body: JSON.stringify(invalid),
      headers: { "content-type": "application/json" },
    });

    expect(response.status).toBe(400);
    expect(provider.generatePromptOptimization).not.toHaveBeenCalled();
  });

  it("runs an agent through the internal agent runner endpoint", async () => {
    const provider = fakeProvider();
    const agentRunner = {
      run: vi.fn().mockResolvedValue({
        ok: true,
        status: "succeeded",
        outputSummary: {
          observations: 1,
          strategyProposals: 0,
          candidateReviews: 0,
          memoryWrites: 0,
        },
        toolCalls: [],
        startedAt: "2026-05-25T00:00:00.000Z",
        finishedAt: "2026-05-25T00:00:01.000Z",
      }),
    };
    const input = agentRunInput();

    const response = await createAiRunnerApp(provider, agentRunner).request("/agent-runs", {
      method: "POST",
      body: JSON.stringify(input),
      headers: { "content-type": "application/json" },
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.outputSummary.observations).toBe(1);
    expect(agentRunner.run).toHaveBeenCalledWith(input);
  });

  it("executes read-only tool requests and redacts tool call summaries", async () => {
    const provider = fakeProvider();
    provider.invoke
      .mockResolvedValueOnce({
        ok: true,
        provider: "claude_cli",
        stdout:
          '{"toolRequests":[{"name":"recall_memory","args":{"agentId":"agent-1","query":"API_TOKEN=secret-value"}}]}',
        startedAt: "2026-05-24T00:00:00.000Z",
        finishedAt: "2026-05-24T00:00:01.000Z",
        timeoutMs: 30000,
      })
      .mockResolvedValueOnce({
        ok: true,
        provider: "claude_cli",
        stdout:
          '{"observations":[],"strategyProposals":[],"candidateReviews":[],"memoryWrites":[]}',
        startedAt: "2026-05-24T00:00:02.000Z",
        finishedAt: "2026-05-24T00:00:03.000Z",
        timeoutMs: 30000,
      });
    const runner = new AiAgentRunner(provider, {
      call: vi.fn().mockResolvedValue({ result: "PASSWORD=hidden-value" }),
    });

    const response = await runner.run({
      ...agentRunInput(),
      agent: {
        ...agentRunInput().agent,
        id: "agent-1",
        allowedTools: ["recall_memory"],
      },
    });

    expect(response.ok).toBe(true);
    expect(response.toolCalls).toEqual([
      {
        name: "recall_memory",
        argsSummary: { agentId: "agent-1", query: "[REDACTED]" },
        resultSummary: { result: "[REDACTED]" },
      },
    ]);
  });

  it("records Claude MCP tool calls in the agent run activity", async () => {
    const provider = fakeProvider();
    provider.invoke.mockResolvedValueOnce({
      ok: true,
      provider: "claude_cli",
      stdout:
        '{"observations":[],"strategyProposals":[],"candidateReviews":[],"memoryWrites":[],"skillWriteIntents":[]}',
      mcpToolCalls: [
        {
          name: "recall_skills",
          argsSummary: {
            source: "claude_mcp",
            toolName: "mcp__agent_research__recall_skills",
            input: { agentId: "agent-1", query: "API_TOKEN=secret-value" },
          },
          resultSummary: {
            source: "claude_mcp",
            result: { text: "PASSWORD=hidden-value" },
          },
        },
      ],
      startedAt: "2026-05-24T00:00:00.000Z",
      finishedAt: "2026-05-24T00:00:01.000Z",
      timeoutMs: 30000,
    });
    const runner = new AiAgentRunner(provider);

    const response = await runner.run({
      ...agentRunInput(),
      agent: {
        ...agentRunInput().agent,
        allowedTools: ["recall_skills"],
      },
    });

    expect(response.ok).toBe(true);
    expect(response.toolCalls).toEqual([
      {
        name: "recall_skills",
        argsSummary: {
          source: "claude_mcp",
          toolName: "mcp__agent_research__recall_skills",
          input: { agentId: "agent-1", query: "[REDACTED]" },
        },
        resultSummary: {
          source: "claude_mcp",
          result: { text: "[REDACTED]" },
        },
      },
    ]);
  });
});

function fakeProvider(
  response?: AiStrategyProposalResponse,
  dailyReviewResponse?: AiDailyReviewResponse,
  promptOptimizationResponse?: AiPromptOptimizationResponse,
) {
  return {
    health: vi.fn().mockResolvedValue({
      name: "claude_cli",
      mode: "disabled",
      implementation: "claude_cli",
      enabled: false,
      ready: false,
      reason: "test disabled",
    }),
    invoke: vi.fn().mockResolvedValue({
      ok: true,
      provider: "claude_cli",
      stdout: '{"ok":true}',
      startedAt: "2026-05-24T00:00:00.000Z",
      finishedAt: "2026-05-24T00:00:01.000Z",
      timeoutMs: 30000,
    }),
    generateStrategyProposal: vi.fn().mockResolvedValue(
      response ?? {
        invocation: {
          id: "invocation-disabled",
          provider: "claude_cli",
          status: "failed",
          promptHash: "hash",
          promptRedacted: "{}",
          timeoutMs: 120000,
          startedAt: "2026-05-24T00:00:00.000Z",
          finishedAt: "2026-05-24T00:00:00.000Z",
          errorSummary: "disabled",
        },
      },
    ),
    generateDailyReview: vi.fn().mockResolvedValue(
      dailyReviewResponse ?? {
        invocation: {
          id: "daily-invocation-disabled",
          provider: "claude_cli",
          status: "failed",
          promptHash: "hash",
          promptRedacted: "{}",
          timeoutMs: 180000,
          startedAt: "2026-05-24T00:00:00.000Z",
          finishedAt: "2026-05-24T00:00:00.000Z",
          errorSummary: "disabled",
        },
      },
    ),
    generatePromptOptimization: vi.fn().mockResolvedValue(
      promptOptimizationResponse ?? {
        invocation: {
          id: "optimization-invocation-disabled",
          provider: "claude_cli",
          status: "failed",
          promptHash: "hash",
          promptRedacted: "{}",
          timeoutMs: 180000,
          startedAt: "2026-05-24T00:00:00.000Z",
          finishedAt: "2026-05-24T00:00:00.000Z",
          errorSummary: "disabled",
        },
      },
    ),
  };
}

function strategyProposalInput(): StrategyProposalInput {
  return {
    baseline: BASELINE_STRATEGIES["5m"],
    recentPerformance: {
      netProfitJpy: 120,
      tradeCount: 8,
      maxDrawdownJpy: 300,
    },
    rejectedCandidateSummaries: [],
    explorationPolicy: "Prefer conservative spread and drawdown changes.",
  };
}

function dailyReviewInput(): DailyReviewInput {
  return {
    reviewDate: "2026-05-24",
    timezone: "Asia/Tokyo",
    accountSummaries: [],
    candidateSummaries: [],
    warningSignals: [],
    operationsContext: {
      liveTradingEnabled: false,
      backupStatus: "unknown",
      restoreRehearsalStatus: "unknown",
    },
  };
}

const GUARDRAIL = "## 共通ガードレール\n- Risk Gate を緩和しない。Paper Order を直接実行しない。";

function promptOptimizationInput(): PromptOptimizationInput {
  return {
    agentId: "c0000000-0000-4000-8000-000000000001",
    agentName: "Ceres",
    characterId: "ceres",
    persona: "冷徹な白銀アナリスト",
    currentVersion: 1,
    currentSystemPrompt: `あなたはセレスです。事実に基づいて判断します。${GUARDRAIL}`,
    requiredGuardrail: GUARDRAIL,
    scorecard: {
      agentId: "c0000000-0000-4000-8000-000000000001",
      windowDays: 7,
      proposalCount: 4,
      acceptedProposalCount: 2,
      acceptanceRate: 0.5,
      adoptedStrategyCount: 1,
      tradeCount: 6,
      realizedPnlJpy: -250,
      netAccountPnlJpy: -250,
      score: 2250,
    },
    recentRejections: [
      {
        candidateStrategyName: "ceres-meanrev-1",
        sourceStrategyName: "baseline-5m",
        rejectReasons: [
          { code: "parameter_out_of_range", path: "risk.maxDrawdownJpy", message: "範囲外" },
        ],
      },
    ],
    recentWinningProposals: [{ strategyName: "ceres-trend-2", realizedPnlJpy: 480 }],
  };
}

function agentRunInput() {
  return {
    agent: {
      id: "11111111-1111-4111-8111-111111111111",
      name: "Research Agent 01",
      persona: "USD/JPY paper strategy researcher",
      systemPrompt: "Observe only.",
      allowedTools: ["read_bars", "recall_memory"],
      status: "active" as const,
      currentVersion: 1,
      runIntervalSec: 3600,
      model: "claude-sonnet-4-5",
      maxConsecutiveFailures: 3,
      consecutiveFailures: 0,
      tokenBudgetPerRun: 200000,
      costBudgetPerRunUsd: 5,
      sharedMemoryEnabled: true,
      characterId: null,
      role: "trader" as const,
      initialBalanceJpy: 100000,
    },
    runEnvelope: "No active candidates.",
    version: 1,
    maxToolHops: 3,
  };
}
