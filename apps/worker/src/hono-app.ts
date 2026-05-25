import { env } from "@ai-trade/config";
import { type CharacterId, isCharacterId } from "@ai-trade/domain/ai-agents";
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
  app.get("/agents/proposals", async (c) => {
    const agentId = c.req.query("agentId");
    const statusRaw = c.req.query("status");
    const status =
      statusRaw === "accepted" || statusRaw === "rejected" ? statusRaw : undefined;
    const limitRaw = c.req.query("limit");
    const limit = limitRaw ? Number(limitRaw) : undefined;

    try {
      return c.json({
        ok: true,
        proposals: await runtime.listAgentProposals({ agentId, status, limit }),
      });
    } catch (error) {
      return c.json(
        {
          ok: false,
          error: error instanceof Error ? error.message : "Proposal listing failed.",
        },
        500,
      );
    }
  });
  app.get("/agents/runs", async (c) => {
    const agentId = c.req.query("agentId");
    const statusRaw = c.req.query("status");
    const status =
      statusRaw === "succeeded" ||
      statusRaw === "failed" ||
      statusRaw === "timeout" ||
      statusRaw === "rejected_output"
        ? statusRaw
        : undefined;
    const limitRaw = c.req.query("limit");
    const limit = limitRaw ? Number(limitRaw) : undefined;

    try {
      return c.json({
        ok: true,
        runs: await runtime.listAgentRuns({ agentId, status, limit }),
      });
    } catch (error) {
      return c.json(
        {
          ok: false,
          error: error instanceof Error ? error.message : "Run listing failed.",
        },
        500,
      );
    }
  });
  app.get("/agents/:id", async (c) => {
    try {
      const agent = await runtime.getAgentDetail(c.req.param("id"));

      if (!agent) {
        return c.json({ ok: false, error: "Agent not found." }, 404);
      }

      return c.json({
        ok: true,
        agent,
      });
    } catch (error) {
      return c.json(
        {
          ok: false,
          error: error instanceof Error ? error.message : "Agent detail lookup failed.",
        },
        500,
      );
    }
  });
  app.post("/agents", async (c) => {
    if (!isAuthorizedInternalRequest(c.req.header("authorization"))) {
      return c.json({ ok: false, error: "Unauthorized." }, 401);
    }

    const body = await c.req.json().catch(() => null);

    if (!isCreateAgentBody(body)) {
      return c.json({ ok: false, error: "Invalid create-agent body." }, 400);
    }

    try {
      const result = await runtime.createAgent({
        name: body.name,
        persona: body.persona,
        systemPrompt: body.systemPrompt,
        allowedTools: body.allowedTools,
        runIntervalSec: body.runIntervalSec,
        model: body.model,
        characterId: body.characterId ?? null,
        sharedMemoryEnabled: body.sharedMemoryEnabled,
        note: body.note,
      });

      return c.json({ ok: true, ...result });
    } catch (error) {
      return c.json(
        {
          ok: false,
          error: error instanceof Error ? error.message : "Agent creation failed.",
        },
        500,
      );
    }
  });
  app.put("/agents/:id", async (c) => {
    if (!isAuthorizedInternalRequest(c.req.header("authorization"))) {
      return c.json({ ok: false, error: "Unauthorized." }, 401);
    }

    const body = await c.req.json().catch(() => null);

    if (!isUpdateAgentBody(body)) {
      return c.json({ ok: false, error: "Invalid update-agent body." }, 400);
    }

    try {
      const result = await runtime.updateAgentSettings({
        agentId: c.req.param("id"),
        name: body.name,
        persona: body.persona,
        characterId: body.characterId === undefined ? undefined : (body.characterId ?? null),
        status: body.status,
        runIntervalSec: body.runIntervalSec,
        model: body.model,
        sharedMemoryEnabled: body.sharedMemoryEnabled,
        pausedReason: body.pausedReason,
      });

      return c.json({ ok: result.updated, ...result }, result.updated ? 200 : 404);
    } catch (error) {
      return c.json(
        {
          ok: false,
          error: error instanceof Error ? error.message : "Agent update failed.",
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
  app.post("/agents/:id/versions/:version/rollback", async (c) => {
    if (!isAuthorizedInternalRequest(c.req.header("authorization"))) {
      return c.json({ ok: false, error: "Unauthorized." }, 401);
    }

    const sourceVersion = Number(c.req.param("version"));
    const body = await c.req.json().catch(() => null);
    const note =
      typeof body === "object" && body !== null && "note" in body && typeof body.note === "string"
        ? body.note
        : undefined;

    if (!Number.isInteger(sourceVersion) || sourceVersion <= 0) {
      return c.json({ ok: false, error: "version must be a positive integer." }, 400);
    }

    try {
      return c.json({
        ok: true,
        ...(await runtime.rollbackAgentVersion({
          agentId: c.req.param("id"),
          sourceVersion,
          note,
        })),
      });
    } catch (error) {
      return c.json(
        {
          ok: false,
          error: error instanceof Error ? error.message : "Agent rollback failed.",
        },
        500,
      );
    }
  });
  app.delete("/agents/:id/memories/:memoryId", async (c) => {
    if (!isAuthorizedInternalRequest(c.req.header("authorization"))) {
      return c.json({ ok: false, error: "Unauthorized." }, 401);
    }

    try {
      const result = await runtime.deleteAgentMemory({
        agentId: c.req.param("id"),
        memoryId: c.req.param("memoryId"),
      });

      return c.json({ ok: result.deleted, ...result }, result.deleted ? 200 : 404);
    } catch (error) {
      return c.json(
        {
          ok: false,
          error: error instanceof Error ? error.message : "Agent memory delete failed.",
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

  app.post("/jobs/agent-run-all", async (c) => {
    try {
      const results = await runtime.runAllAgents();
      return c.json({
        ok: results.every((result) => result.ok),
        results,
      });
    } catch (error) {
      return c.json(
        {
          ok: false,
          error: error instanceof Error ? error.message : "Agent run all failed.",
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

type CreateAgentBody = {
  name: string;
  persona: string;
  systemPrompt: string;
  allowedTools: string[];
  runIntervalSec: number;
  model: string;
  characterId?: CharacterId | null;
  sharedMemoryEnabled?: boolean;
  note?: string;
};

function isCreateAgentBody(body: unknown): body is CreateAgentBody {
  if (typeof body !== "object" || body === null) return false;
  const b = body as Record<string, unknown>;
  if (typeof b.name !== "string" || b.name.trim().length === 0) return false;
  if (typeof b.persona !== "string" || b.persona.trim().length === 0) return false;
  if (typeof b.systemPrompt !== "string" || b.systemPrompt.trim().length === 0) return false;
  if (!Array.isArray(b.allowedTools) || !b.allowedTools.every((t) => typeof t === "string")) {
    return false;
  }
  if (typeof b.runIntervalSec !== "number" || !Number.isFinite(b.runIntervalSec)) return false;
  if (typeof b.model !== "string" || b.model.trim().length === 0) return false;
  if (b.characterId !== undefined && b.characterId !== null) {
    if (typeof b.characterId !== "string" || !isCharacterId(b.characterId)) return false;
  }
  return true;
}

type UpdateAgentBody = {
  name?: string;
  persona?: string;
  characterId?: CharacterId | null;
  status?: "active" | "paused";
  runIntervalSec?: number;
  model?: string;
  sharedMemoryEnabled?: boolean;
  pausedReason?: string | null;
};

function isUpdateAgentBody(body: unknown): body is UpdateAgentBody {
  if (typeof body !== "object" || body === null) return false;
  const b = body as Record<string, unknown>;
  if (b.name !== undefined && typeof b.name !== "string") return false;
  if (b.persona !== undefined && typeof b.persona !== "string") return false;
  if (b.characterId !== undefined && b.characterId !== null) {
    if (typeof b.characterId !== "string" || !isCharacterId(b.characterId)) return false;
  }
  if (b.status !== undefined && b.status !== "active" && b.status !== "paused") return false;
  if (b.runIntervalSec !== undefined && typeof b.runIntervalSec !== "number") return false;
  if (b.model !== undefined && typeof b.model !== "string") return false;
  if (b.sharedMemoryEnabled !== undefined && typeof b.sharedMemoryEnabled !== "boolean") {
    return false;
  }
  if (b.pausedReason !== undefined && b.pausedReason !== null && typeof b.pausedReason !== "string") {
    return false;
  }
  return true;
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
