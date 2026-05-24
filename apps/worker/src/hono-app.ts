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
  app.get("/dashboard", async (c) => {
    try {
      return c.json({
        ok: true,
        summary: await runtime.dashboardSummary(),
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
