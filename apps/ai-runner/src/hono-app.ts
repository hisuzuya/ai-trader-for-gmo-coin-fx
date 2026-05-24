import type { DailyReviewInput, StrategyProposalInput } from "@ai-trade/domain/ai-tuning";
import { Hono } from "hono";

import {
  type AiRunnerProviderState,
  ClaudeCliProvider,
  type StrategyProposalProvider,
} from "./claude-cli-provider.js";

export type { AiRunnerProviderState };

export type AiRunnerHealth = {
  ok: true;
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

  app.get("/ready", async (c) =>
    c.json({
      ok: true,
      service: "ai-runner",
      provider: await provider.health(),
    } satisfies AiRunnerHealth),
  );

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
