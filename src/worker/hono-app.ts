import { Hono } from "hono";

import type { WorkerRuntime } from "@/worker/runtime";

export function createWorkerApp(runtime: WorkerRuntime) {
  const app = new Hono();

  app.get("/health", async (c) => c.json(await runtime.health()));
  app.get("/ready", async (c) => {
    const ready = await runtime.ready();
    return c.json(ready, ready.ok ? 200 : 503);
  });
  app.get("/status", async (c) => c.json(await runtime.status()));
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
