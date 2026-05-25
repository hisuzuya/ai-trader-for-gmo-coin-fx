import { env } from "@ai-trade/config";
import { Hono } from "hono";

import type { WorkerRuntime } from "./runtime.js";

export function createWorkerApp(runtime: WorkerRuntime) {
  const app = new Hono();

  app.get("/health", async (c) => c.json(await runtime.health()));
  app.get("/ready", async (c) => {
    const ready = await runtime.ready();
    return c.json(ready, ready.ok ? 200 : 503);
  });
  app.get("/status", async (c) => c.json(await runtime.status()));
  app.get("/agents", async (c) => {
    try {
      return c.json({
        ok: true,
        agents: await runtime.listAgents(),
      });
    } catch (error) {
      return c.json(
        {
          ok: false,
          error: error instanceof Error ? error.message : "Agent listing failed.",
        },
        500,
      );
    }
  });
  app.post("/agents/:id/versions", async (c) => {
    if (!isAuthorizedInternalRequest(c.req.header("authorization"))) {
      return c.json({ ok: false, error: "Unauthorized." }, 401);
    }

    const agentId = c.req.param("id");
    const body = await c.req.json().catch(() => null);

    if (!isAgentVersionBody(body)) {
      return c.json(
        {
          ok: false,
          error:
            "Request body must be { systemPrompt: string, allowedTools: string[], note?: string }.",
        },
        400,
      );
    }

    try {
      return c.json({
        ok: true,
        ...(await runtime.createAgentVersion({
          agentId,
          systemPrompt: body.systemPrompt,
          allowedTools: body.allowedTools,
          note: body.note,
        })),
      });
    } catch (error) {
      return c.json(
        {
          ok: false,
          error: error instanceof Error ? error.message : "Agent version creation failed.",
        },
        500,
      );
    }
  });
  app.get("/dashboard", async (c) => {
    const accountQuery = c.req.query("account");
    const accountName =
      typeof accountQuery === "string" && accountQuery.trim().length > 0
        ? accountQuery.trim()
        : undefined;

    try {
      return c.json({
        ok: true,
        summary: await runtime.dashboardSummary(accountName !== undefined ? { accountName } : {}),
      });
    } catch (error) {
      return c.json(
        {
          ok: false,
          error: error instanceof Error ? error.message : "Dashboard summary failed.",
        },
        500,
      );
    }
  });
  app.get("/candles", async (c) => {
    const query = parseCandlesQuery(c.req.query());

    if (!query.ok) {
      return c.json({ ok: false, error: query.error }, 400);
    }

    try {
      return c.json({
        ok: true,
        ...(await runtime.recentCandles(query.value)),
      });
    } catch (error) {
      return c.json(
        {
          ok: false,
          error: error instanceof Error ? error.message : "Candle lookup failed.",
        },
        500,
      );
    }
  });
  app.get("/metrics", (c) =>
    c.json({
      format: "json",
      note: "Prometheus text metrics are reserved for a later phase.",
    }),
  );
  app.post("/jobs/historical-import", async (c) => {
    const body = await c.req.json().catch(() => null);

    if (!isHistoricalImportBody(body)) {
      return c.json(
        {
          error: 'Request body must be { date: "YYYYMMDD" }.',
        },
        400,
      );
    }

    try {
      const job = await runtime.runHistoricalImport(body.date);
      return c.json({
        ok: true,
        date: body.date,
        jobRunId: job.jobRunId,
        result: job.result,
      });
    } catch (error) {
      return c.json(
        {
          ok: false,
          date: body.date,
          error: error instanceof Error ? error.message : "Historical import failed.",
        },
        500,
      );
    }
  });

  app.post("/jobs/ai-tuning", async (c) => {
    try {
      const result = await runtime.runAiTuning();
      return c.json({
        ok: result.proposalStatus === "accepted",
        result,
      });
    } catch (error) {
      return c.json(
        {
          ok: false,
          error: error instanceof Error ? error.message : "AI tuning failed.",
        },
        500,
      );
    }
  });

  app.post("/jobs/daily-review", async (c) => {
    try {
      const result = await runtime.runDailyReview();
      return c.json({
        ok: result.reviewStatus === "accepted",
        result,
      });
    } catch (error) {
      return c.json(
        {
          ok: false,
          error: error instanceof Error ? error.message : "AI daily review failed.",
        },
        500,
      );
    }
  });

  app.post("/jobs/agent-run", async (c) => {
    const body = await c.req.json().catch(() => null);
    const agentId =
      typeof body === "object" &&
      body !== null &&
      "agentId" in body &&
      typeof body.agentId === "string"
        ? body.agentId
        : undefined;

    try {
      const result = await runtime.runAgent(agentId);
      return c.json({
        ok: result.ok,
        result,
      });
    } catch (error) {
      return c.json(
        {
          ok: false,
          error: error instanceof Error ? error.message : "Agent run failed.",
        },
        500,
      );
    }
  });

  app.post("/paper-decisions", async (c) => {
    const body = await c.req.json().catch(() => null);

    if (!isPaperDecisionBody(body)) {
      return c.json(
        {
          ok: false,
          error:
            'Request body must be { strategyRunId: "uuid", action: "promote_baseline" | "retire_candidate" }.',
        },
        400,
      );
    }

    try {
      const result = await runtime.recordPaperDecision(body);
      return c.json(result, result.ok ? 200 : 409);
    } catch (error) {
      return c.json(
        {
          ok: false,
          error: error instanceof Error ? error.message : "Paper decision failed.",
        },
        500,
      );
    }
  });

  return app;
}

function isHistoricalImportBody(body: unknown): body is { date: string } {
  return (
    typeof body === "object" &&
    body !== null &&
    "date" in body &&
    typeof body.date === "string" &&
    /^\d{8}$/.test(body.date)
  );
}

function isAuthorizedInternalRequest(authorization: string | undefined) {
  if (!env.WORKER_INTERNAL_TOKEN) {
    return env.NODE_ENV !== "production";
  }

  return authorization === `Bearer ${env.WORKER_INTERNAL_TOKEN}`;
}

function isAgentVersionBody(
  body: unknown,
): body is { systemPrompt: string; allowedTools: string[]; note?: string } {
  return (
    typeof body === "object" &&
    body !== null &&
    "systemPrompt" in body &&
    "allowedTools" in body &&
    typeof body.systemPrompt === "string" &&
    body.systemPrompt.trim().length > 0 &&
    Array.isArray(body.allowedTools) &&
    body.allowedTools.every((tool) => typeof tool === "string") &&
    (!("note" in body) || body.note === undefined || typeof body.note === "string")
  );
}

const DEFAULT_CANDLES_SYMBOL = "USD_JPY";
const DEFAULT_CANDLES_TIMEFRAME = "1m";
const DEFAULT_CANDLES_PRICE_TYPE = "mid" as const;
const DEFAULT_CANDLES_LIMIT = 500;
const MAX_CANDLES_LIMIT = 5000;
const ALLOWED_CANDLE_TIMEFRAMES = ["1m", "5m", "15m", "1h", "4h", "1d"] as const;
const ALLOWED_CANDLE_PRICE_TYPES = ["bid", "ask", "mid"] as const;

type CandlesQuery = {
  symbol: string;
  timeframe: (typeof ALLOWED_CANDLE_TIMEFRAMES)[number];
  priceType: (typeof ALLOWED_CANDLE_PRICE_TYPES)[number];
  limit: number;
  before?: Date;
};

function parseCandlesQuery(
  raw: Record<string, string>,
): { ok: true; value: CandlesQuery } | { ok: false; error: string } {
  const symbol = (raw.symbol ?? DEFAULT_CANDLES_SYMBOL).trim();

  if (!/^[A-Z]{3}_[A-Z]{3}$/.test(symbol)) {
    return { ok: false, error: 'symbol must match "AAA_BBB" format.' };
  }

  const timeframeRaw = (raw.timeframe ?? DEFAULT_CANDLES_TIMEFRAME).trim().toLowerCase();

  if (!isAllowedTimeframe(timeframeRaw)) {
    return {
      ok: false,
      error: `timeframe must be one of ${ALLOWED_CANDLE_TIMEFRAMES.join(", ")}.`,
    };
  }

  const priceTypeRaw = (raw.priceType ?? DEFAULT_CANDLES_PRICE_TYPE).trim().toLowerCase();

  if (!isAllowedPriceType(priceTypeRaw)) {
    return {
      ok: false,
      error: `priceType must be one of ${ALLOWED_CANDLE_PRICE_TYPES.join(", ")}.`,
    };
  }

  const limitRaw = raw.limit ?? String(DEFAULT_CANDLES_LIMIT);
  const limit = Number(limitRaw);

  if (!Number.isInteger(limit) || limit <= 0 || limit > MAX_CANDLES_LIMIT) {
    return {
      ok: false,
      error: `limit must be an integer between 1 and ${MAX_CANDLES_LIMIT}.`,
    };
  }

  const beforeRaw = raw.before?.trim();
  let before: Date | undefined;

  if (beforeRaw) {
    before = new Date(beforeRaw);
    if (Number.isNaN(before.getTime())) {
      return { ok: false, error: "before must be an ISO-8601 timestamp." };
    }
  }

  return {
    ok: true,
    value: { symbol, timeframe: timeframeRaw, priceType: priceTypeRaw, limit, before },
  };
}

function isAllowedTimeframe(value: string): value is (typeof ALLOWED_CANDLE_TIMEFRAMES)[number] {
  return (ALLOWED_CANDLE_TIMEFRAMES as readonly string[]).includes(value);
}

function isAllowedPriceType(value: string): value is (typeof ALLOWED_CANDLE_PRICE_TYPES)[number] {
  return (ALLOWED_CANDLE_PRICE_TYPES as readonly string[]).includes(value);
}

function isPaperDecisionBody(
  body: unknown,
): body is { strategyRunId: string; action: "promote_baseline" | "retire_candidate" } {
  return (
    typeof body === "object" &&
    body !== null &&
    "strategyRunId" in body &&
    "action" in body &&
    typeof body.strategyRunId === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      body.strategyRunId,
    ) &&
    (body.action === "promote_baseline" || body.action === "retire_candidate")
  );
}
