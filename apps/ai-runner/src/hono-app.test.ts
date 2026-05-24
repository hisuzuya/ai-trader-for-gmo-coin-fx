import type { AiStrategyProposalResponse, StrategyProposalInput } from "@ai-trade/domain/ai-tuning";
import { BASELINE_STRATEGIES } from "@ai-trade/domain/strategies";
import { describe, expect, it, vi } from "vitest";

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
        reason: "test disabled",
      },
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
});

function fakeProvider(response?: AiStrategyProposalResponse) {
  return {
    health: vi.fn().mockResolvedValue({
      name: "claude_cli",
      mode: "disabled",
      implementation: "claude_cli",
      enabled: false,
      reason: "test disabled",
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
