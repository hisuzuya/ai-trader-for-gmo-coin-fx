import { describe, expect, it, vi } from "vitest";

import { createWorkerApp } from "@/worker/hono-app";
import type { HistoricalImporter } from "@/worker/jobs/historical-importer";
import type {
  JobRunMetadata,
  JobRunRecorder,
  StartedJobRun,
} from "@/worker/jobs/job-run-recorder";
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

  it("returns worker status without changing the existing shape", async () => {
    const runtime = new WorkerRuntime([new StaticWorkerService("collector")]);
    await runtime.start();

    const response = await createWorkerApp(runtime).request("/status");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      services: [{ name: "collector", state: "ready" }],
      latestTickerTimestamp: null,
      latestCandleOpenedAt: null,
      websocketConnected: false,
      lastReconnectReason: null,
      lastAiInvocationStatus: null,
    });
  });

  it("runs historical import and records a succeeded job run", async () => {
    const importer: HistoricalImporter = {
      importDate: vi.fn().mockResolvedValue({ importedCandles: 12 }),
    };
    const jobRunRecorder = new InMemoryJobRunRecorder();
    const runtime = new WorkerRuntime(
      [new StaticWorkerService("collector")],
      importer,
      jobRunRecorder,
    );

    const response = await createWorkerApp(runtime).request(
      "/jobs/historical-import",
      {
        method: "POST",
        body: JSON.stringify({ date: "20260524" }),
        headers: { "content-type": "application/json" },
      },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      ok: true,
      date: "20260524",
      jobRunId: "job-run-1",
      result: { importedCandles: 12 },
    });
    expect(importer.importDate).toHaveBeenCalledWith({ date: "20260524" });
    expect(jobRunRecorder.records).toEqual([
      {
        id: "job-run-1",
        jobName: "historical-import",
        status: "succeeded",
        metadata: {
          date: "20260524",
          result: { importedCandles: 12 },
        },
      },
    ]);
  });

  it("rejects historical import requests without YYYYMMDD date", async () => {
    const importer: HistoricalImporter = {
      importDate: vi.fn().mockResolvedValue({ importedCandles: 0 }),
    };
    const runtime = new WorkerRuntime(
      [new StaticWorkerService("collector")],
      importer,
      new InMemoryJobRunRecorder(),
    );

    const response = await createWorkerApp(runtime).request(
      "/jobs/historical-import",
      {
        method: "POST",
        body: JSON.stringify({ date: "2026-05-24" }),
        headers: { "content-type": "application/json" },
      },
    );

    expect(response.status).toBe(400);
    expect(importer.importDate).not.toHaveBeenCalled();
  });

  it("records a failed job run when historical import fails", async () => {
    const importer: HistoricalImporter = {
      importDate: vi.fn().mockRejectedValue(new Error("import failed")),
    };
    const jobRunRecorder = new InMemoryJobRunRecorder();
    const runtime = new WorkerRuntime(
      [new StaticWorkerService("collector")],
      importer,
      jobRunRecorder,
    );

    const response = await createWorkerApp(runtime).request(
      "/jobs/historical-import",
      {
        method: "POST",
        body: JSON.stringify({ date: "20260524" }),
        headers: { "content-type": "application/json" },
      },
    );
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({
      ok: false,
      date: "20260524",
      error: "import failed",
    });
    expect(jobRunRecorder.records).toEqual([
      {
        id: "job-run-1",
        jobName: "historical-import",
        status: "failed",
        metadata: { date: "20260524" },
        errorSummary: "import failed",
      },
    ]);
  });
});

type JobRunRecord = {
  id: string;
  jobName: string;
  status: "running" | "succeeded" | "failed";
  metadata?: JobRunMetadata;
  errorSummary?: string;
};

class InMemoryJobRunRecorder implements JobRunRecorder {
  readonly records: JobRunRecord[] = [];

  async start(
    jobName: string,
    metadata?: JobRunMetadata,
  ): Promise<StartedJobRun> {
    const id = `job-run-${this.records.length + 1}`;
    this.records.push({
      id,
      jobName,
      status: "running",
      metadata,
    });

    return { id };
  }

  async succeed(
    jobRunId: string,
    metadata?: JobRunMetadata,
  ): Promise<void> {
    this.update(jobRunId, {
      status: "succeeded",
      metadata,
    });
  }

  async fail(
    jobRunId: string,
    errorSummary: string,
    metadata?: JobRunMetadata,
  ): Promise<void> {
    this.update(jobRunId, {
      status: "failed",
      metadata,
      errorSummary,
    });
  }

  private update(jobRunId: string, values: Partial<JobRunRecord>) {
    const record = this.records.find(({ id }) => id === jobRunId);

    if (!record) {
      throw new Error(`Unknown job run: ${jobRunId}`);
    }

    Object.assign(record, values);
  }
}
