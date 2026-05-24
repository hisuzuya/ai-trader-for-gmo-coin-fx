import { describe, expect, it } from "vitest";

import { createWorkerApp } from "@/worker/hono-app";
import { WorkerRuntime } from "@/worker/runtime";
import { StaticWorkerService } from "@/worker/services/static-service";

describe("worker Hono app", () => {
  it("returns liveness health", async () => {
    const runtime = new WorkerRuntime([new StaticWorkerService("collector")]);
    await runtime.start();

    const response = await createWorkerApp(runtime).request("/health");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ ok: true, service: "worker" });
  });
});
