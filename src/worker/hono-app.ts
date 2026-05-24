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

  return app;
}
