import type { AgentRunRequest } from "@ai-trade/domain/ai-agents";
import type { DailyReviewInput, StrategyProposalInput } from "@ai-trade/domain/ai-tuning";
import { Hono } from "hono";

import { type AgentRunner, AiAgentRunner } from "./agent-runner.js";
import {
  type AiRunnerProviderState,
  ClaudeCliProvider,
  type StrategyProposalProvider,
} from "./claude-cli-provider.js";

export type { AiRunnerProviderState };

export type AiRunnerHealth = {
  ok: boolean;
  service: "ai-runner";
  provider: AiRunnerProviderState;
};

export function createAiRunnerApp(
  provider: StrategyProposalProvider = new ClaudeCliProvider(),
  agentRunner: AgentRunner = new AiAgentRunner(provider),
) {
  const app = new Hono();

  app.get("/health", async (c) =>
    c.json({
      ok: true,
      service: "ai-runner",
      provider: await provider.health(),
    } satisfies AiRunnerHealth),
  );

  app.get("/ready", async (c) => {
    const providerHealth = await provider.health();
    const body = {
      ok: providerHealth.ready,
      service: "ai-runner",
      provider: providerHealth,
    } satisfies AiRunnerHealth;

    return c.json(body, body.ok ? 200 : 503);
  });

  app.post("/invoke", async (c) => {
    const body = await c.req.json().catch(() => null);

    if (!isInvocationInput(body)) {
      return c.json(
        {
          ok: false,
          error: "Request body must be { prompt: string, timeoutMs?: number }.",
        },
        400,
      );
    }

    const result = await provider.invoke(body);
    return c.json(result, result.ok ? 200 : 503);
  });

  app.post("/strategy-proposals", async (c) => {
    const body = await c.req.json().catch(() => null);

    if (!isStrategyProposalInput(body)) {
      return c.json(
        {
          ok: false,
          error:
            "Request body must include baseline, recentPerformance, rejectedCandidateSummaries, and explorationPolicy.",
        },
        400,
      );
    }

    const response = await provider.generateStrategyProposal(body);
    return c.json({
      ok: response.invocation.status === "succeeded",
      ...response,
    });
  });

  app.post("/daily-reviews", async (c) => {
    const body = await c.req.json().catch(() => null);

    if (!isDailyReviewInput(body)) {
      return c.json(
        {
          ok: false,
          error:
            "Request body must include reviewDate, timezone, accountSummaries, candidateSummaries, warningSignals, and operationsContext.",
        },
        400,
      );
    }

    const response = await provider.generateDailyReview(body);
    return c.json({
      ok: response.invocation.status === "succeeded",
      ...response,
    });
  });

  app.post("/agent-runs", async (c) => {
    const body = await c.req.json().catch(() => null);

    if (!isAgentRunRequest(body)) {
      return c.json(
        {
          ok: false,
          error:
            "Request body must include agent, contextSummary, and version. Agent definition is supplied by worker.",
        },
        400,
      );
    }

    const response = await agentRunner.run(body);
    return c.json(response, response.ok ? 200 : 503);
  });

  return app;
}

function isAgentRunRequest(input: unknown): input is AgentRunRequest {
  return (
    typeof input === "object" &&
    input !== null &&
    "agent" in input &&
    "contextSummary" in input &&
    "version" in input &&
    typeof input.contextSummary === "string" &&
    typeof input.version === "number" &&
    typeof input.agent === "object" &&
    input.agent !== null &&
    "id" in input.agent &&
    "name" in input.agent &&
    "systemPrompt" in input.agent &&
    "allowedTools" in input.agent &&
    typeof input.agent.id === "string" &&
    typeof input.agent.name === "string" &&
    typeof input.agent.systemPrompt === "string" &&
    Array.isArray(input.agent.allowedTools)
  );
}

function isStrategyProposalInput(input: unknown): input is StrategyProposalInput {
  return (
    typeof input === "object" &&
    input !== null &&
    "baseline" in input &&
    "recentPerformance" in input &&
    "rejectedCandidateSummaries" in input &&
    "explorationPolicy" in input &&
    Array.isArray(input.rejectedCandidateSummaries) &&
    typeof input.explorationPolicy === "string"
  );
}

function isInvocationInput(input: unknown): input is { prompt: string; timeoutMs?: number } {
  return (
    typeof input === "object" &&
    input !== null &&
    "prompt" in input &&
    typeof input.prompt === "string" &&
    input.prompt.trim().length > 0 &&
    (!("timeoutMs" in input) ||
      input.timeoutMs === undefined ||
      (typeof input.timeoutMs === "number" &&
        Number.isInteger(input.timeoutMs) &&
        input.timeoutMs > 0))
  );
}

function isDailyReviewInput(input: unknown): input is DailyReviewInput {
  return (
    typeof input === "object" &&
    input !== null &&
    "reviewDate" in input &&
    "timezone" in input &&
    "accountSummaries" in input &&
    "candidateSummaries" in input &&
    "warningSignals" in input &&
    "operationsContext" in input &&
    typeof input.reviewDate === "string" &&
    input.timezone === "Asia/Tokyo" &&
    Array.isArray(input.accountSummaries) &&
    Array.isArray(input.candidateSummaries) &&
    Array.isArray(input.warningSignals)
  );
}
