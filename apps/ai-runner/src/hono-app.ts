import type { DailyReviewInput, StrategyProposalInput } from "@ai-trade/domain/ai-tuning";
import { Hono } from "hono";

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

export function createAiRunnerApp(provider: StrategyProposalProvider = new ClaudeCliProvider()) {
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

  return app;
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
