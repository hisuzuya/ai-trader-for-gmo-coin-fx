import type { JobRunMetadata, JobRunRecorder, StartedJobRun } from "@ai-trade/db";
import { BASELINE_STRATEGIES } from "@ai-trade/domain/strategies";
import { describe, expect, it, vi } from "vitest";
import { createWorkerApp } from "./hono-app.js";
import type { HistoricalImporter } from "./pipelines/market-data/historical-importer.js";
import { WorkerRuntime } from "./runtime.js";
import {
  AiDailyReviewerService,
  type DailyReviewContextProvider,
  type DailyReviewProvider,
  InMemoryDailyReviewDecisionExecutor,
  InMemoryDailyReviewStore,
} from "./services/ai-daily-reviewer.js";
import { type AiProvider, AiTunerService, InMemoryAiTuningStore } from "./services/ai-tuner.js";
import { StaticWorkerService } from "./services/static-service.js";

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

    const response = await createWorkerApp(runtime).request("/jobs/historical-import", {
      method: "POST",
      body: JSON.stringify({ date: "20260524" }),
      headers: { "content-type": "application/json" },
    });
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

    const response = await createWorkerApp(runtime).request("/jobs/historical-import", {
      method: "POST",
      body: JSON.stringify({ date: "2026-05-24" }),
      headers: { "content-type": "application/json" },
    });

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

    const response = await createWorkerApp(runtime).request("/jobs/historical-import", {
      method: "POST",
      body: JSON.stringify({ date: "20260524" }),
      headers: { "content-type": "application/json" },
    });
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

  it("runs AI tuning and returns the candidate insertion result", async () => {
    const store = new InMemoryAiTuningStore();
    const aiProvider: AiProvider = {
      generateStrategyProposal: vi.fn().mockResolvedValue({
        invocation: {
          id: "f5bf1c6e-f63f-4cb1-8cb8-7107ec0382a8",
          provider: "claude_cli",
          status: "succeeded",
          promptHash: "hash",
          promptRedacted: "{}",
          timeoutMs: 120000,
          startedAt: "2026-05-24T00:00:00.000Z",
          finishedAt: "2026-05-24T00:00:01.000Z",
        },
        proposal: {
          rationale: "Reduce spread exposure.",
          strategy: {
            ...BASELINE_STRATEGIES["1m"],
            meta: {
              ...BASELINE_STRATEGIES["1m"].meta,
              name: "candidate_1m_spread_guard",
            },
          },
        },
      }),
    };
    const runtime = new WorkerRuntime([
      new AiTunerService({
        enabled: true,
        intervalMs: null,
        strategies: [BASELINE_STRATEGIES["1m"]],
        aiProvider,
        store,
      }),
    ]);
    await runtime.start();

    const response = await createWorkerApp(runtime).request("/jobs/ai-tuning", {
      method: "POST",
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      result: {
        sourceStrategyName: "baseline_1m",
        proposalStatus: "accepted",
        candidateStrategyName: "candidate_1m_spread_guard",
      },
    });
    expect(store.invocations).toHaveLength(1);
    expect(store.proposals).toHaveLength(1);
  });

  it("runs Daily Review and records the accepted review", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-24T00:00:00.000Z"));
    const store = new InMemoryDailyReviewStore();
    const aiProvider: DailyReviewProvider = {
      generateDailyReview: vi.fn().mockResolvedValue({
        invocation: {
          id: "7c2dacde-ff6c-489f-8814-c1cb88009441",
          provider: "claude_cli",
          status: "succeeded",
          promptHash: "hash",
          promptRedacted: "{}",
          timeoutMs: 180000,
          startedAt: "2026-05-24T00:00:00.000Z",
          finishedAt: "2026-05-24T00:00:01.000Z",
        },
        review: {
          review_date: "2026-05-24",
          summary: "Paper trading is stable.",
          baseline_promotion_candidates: [],
          candidate_retirement_candidates: [
            {
              strategyName: "candidate_1m_spread_guard",
              reason: "Drawdown is above the review threshold.",
              confidence: "medium",
            },
          ],
          warnings: [{ severity: "warning", code: "DRAWDOWN", message: "Review drawdown." }],
          next_actions: ["Keep live trading disabled."],
        },
      }),
    };
    const contextProvider: DailyReviewContextProvider = {
      buildInput: vi.fn().mockResolvedValue({
        reviewDate: "2026-05-24",
        timezone: "Asia/Tokyo",
        accountSummaries: [],
        candidateSummaries: [],
        warningSignals: [],
        operationsContext: {
          liveTradingEnabled: false,
          backupStatus: "unknown",
          restoreRehearsalStatus: "unknown",
        },
      }),
    };
    const decisionExecutor = new InMemoryDailyReviewDecisionExecutor();
    const runtime = new WorkerRuntime([
      new AiDailyReviewerService({
        enabled: true,
        intervalMs: null,
        aiProvider,
        contextProvider,
        store,
        decisionExecutor,
      }),
    ]);
    await runtime.start();

    const response = await createWorkerApp(runtime).request("/jobs/daily-review", {
      method: "POST",
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      result: {
        reviewDate: "2026-05-24",
        reviewStatus: "accepted",
        warningCount: 1,
        retirementCandidateCount: 1,
      },
    });
    expect(store.invocations).toHaveLength(1);
    expect(store.reviews).toHaveLength(1);
    expect(decisionExecutor.calls).toHaveLength(1);
    expect(decisionExecutor.calls[0]).toMatchObject({
      reviewDate: "2026-05-24",
      candidateRetirementCandidates: [
        { strategyName: "candidate_1m_spread_guard", confidence: "medium" },
      ],
    });
    vi.useRealTimers();
  });

  it("records a manual paper decision", async () => {
    const runtime = {
      health: vi.fn(),
      ready: vi.fn(),
      status: vi.fn(),
      dashboardSummary: vi.fn(),
      runHistoricalImport: vi.fn(),
      runAiTuning: vi.fn(),
      runDailyReview: vi.fn(),
      recordPaperDecision: vi.fn().mockResolvedValue({
        ok: true,
        strategyRunId: "f5bf1c6e-f63f-4cb1-8cb8-7107ec0382a8",
        strategyName: "candidate_1m_spread_guard",
        action: "retire_candidate",
        status: "retired",
      }),
    } as unknown as WorkerRuntime;

    const response = await createWorkerApp(runtime).request("/paper-decisions", {
      method: "POST",
      body: JSON.stringify({
        strategyRunId: "f5bf1c6e-f63f-4cb1-8cb8-7107ec0382a8",
        action: "retire_candidate",
      }),
      headers: { "content-type": "application/json" },
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      ok: true,
      strategyRunId: "f5bf1c6e-f63f-4cb1-8cb8-7107ec0382a8",
      strategyName: "candidate_1m_spread_guard",
      action: "retire_candidate",
      status: "retired",
    });
    expect(runtime.recordPaperDecision).toHaveBeenCalledWith({
      strategyRunId: "f5bf1c6e-f63f-4cb1-8cb8-7107ec0382a8",
      action: "retire_candidate",
    });
  });

  it("rejects invalid paper decision requests", async () => {
    const runtime = {
      recordPaperDecision: vi.fn(),
    } as unknown as WorkerRuntime;

    const response = await createWorkerApp(runtime).request("/paper-decisions", {
      method: "POST",
      body: JSON.stringify({
        strategyRunId: "not-a-uuid",
        action: "retire_candidate",
      }),
      headers: { "content-type": "application/json" },
    });

    expect(response.status).toBe(400);
    expect(runtime.recordPaperDecision).not.toHaveBeenCalled();
  });

  it("forwards account query to dashboardSummary when provided", async () => {
    const runtime = {
      dashboardSummary: vi.fn().mockResolvedValue({
        selectedAccountName: "baseline_1m",
        accounts: [],
        trades: [],
        candidates: [],
        dailyReviews: [],
        accountDetail: { name: "baseline_1m" },
      }),
    } as unknown as WorkerRuntime;

    const response = await createWorkerApp(runtime).request("/dashboard?account=baseline_1m");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(runtime.dashboardSummary).toHaveBeenCalledWith({ accountName: "baseline_1m" });
    expect(body).toMatchObject({
      ok: true,
      summary: {
        selectedAccountName: "baseline_1m",
        accountDetail: { name: "baseline_1m" },
      },
    });
  });

  it("omits accountName when account query is missing or blank", async () => {
    const runtime = {
      dashboardSummary: vi.fn().mockResolvedValue({
        selectedAccountName: null,
        accounts: [],
        trades: [],
        candidates: [],
        dailyReviews: [],
        accountDetail: null,
      }),
    } as unknown as WorkerRuntime;

    const response = await createWorkerApp(runtime).request("/dashboard?account=");

    expect(response.status).toBe(200);
    expect(runtime.dashboardSummary).toHaveBeenCalledWith({});
  });

  it("returns recent candles with default query parameters", async () => {
    const runtime = {
      recentCandles: vi.fn().mockResolvedValue({
        symbol: "USD_JPY",
        timeframe: "1m",
        priceType: "mid",
        candles: [
          {
            openedAt: "2026-05-24T00:00:00.000Z",
            open: 156.1,
            high: 156.2,
            low: 156.09,
            close: 156.19,
          },
        ],
      }),
    } as unknown as WorkerRuntime;

    const response = await createWorkerApp(runtime).request("/candles");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(runtime.recentCandles).toHaveBeenCalledWith({
      symbol: "USD_JPY",
      timeframe: "1m",
      priceType: "mid",
      limit: 500,
      before: undefined,
    });
    expect(body).toMatchObject({
      ok: true,
      symbol: "USD_JPY",
      timeframe: "1m",
      priceType: "mid",
      candles: [
        {
          openedAt: "2026-05-24T00:00:00.000Z",
          open: 156.1,
          high: 156.2,
          low: 156.09,
          close: 156.19,
        },
      ],
    });
  });

  it("rejects candles requests with invalid timeframe", async () => {
    const runtime = {
      recentCandles: vi.fn(),
    } as unknown as WorkerRuntime;

    const response = await createWorkerApp(runtime).request("/candles?timeframe=2m");

    expect(response.status).toBe(400);
    expect(runtime.recentCandles).not.toHaveBeenCalled();
  });

  it("clamps candles limit to the allowed range", async () => {
    const runtime = {
      recentCandles: vi.fn(),
    } as unknown as WorkerRuntime;

    const response = await createWorkerApp(runtime).request("/candles?limit=0");

    expect(response.status).toBe(400);
    expect(runtime.recentCandles).not.toHaveBeenCalled();
  });

  it("accepts a before cursor for paged candle lookup", async () => {
    const runtime = {
      recentCandles: vi.fn().mockResolvedValue({
        symbol: "USD_JPY",
        timeframe: "1m",
        priceType: "mid",
        candles: [],
      }),
    } as unknown as WorkerRuntime;

    const response = await createWorkerApp(runtime).request(
      "/candles?limit=5000&before=2026-05-25T05%3A00%3A00.000Z",
    );

    expect(response.status).toBe(200);
    expect(runtime.recentCandles).toHaveBeenCalledWith({
      symbol: "USD_JPY",
      timeframe: "1m",
      priceType: "mid",
      limit: 5000,
      before: new Date("2026-05-25T05:00:00.000Z"),
    });
  });

  it("returns agent detail from the runtime", async () => {
    const runtime = {
      getAgentDetail: vi.fn().mockResolvedValue({
        id: "agent-1",
        name: "Ceres",
        memories: [],
        proposals: [],
        reviews: [],
        runs: [],
        versions: [],
      }),
    } as unknown as WorkerRuntime;

    const response = await createWorkerApp(runtime).request("/agents/agent-1");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.agent.name).toBe("Ceres");
    expect(runtime.getAgentDetail).toHaveBeenCalledWith("agent-1");
  });

  it("rolls back an agent version through a new version", async () => {
    const runtime = {
      rollbackAgentVersion: vi.fn().mockResolvedValue({ version: 4 }),
    } as unknown as WorkerRuntime;

    const response = await createWorkerApp(runtime).request("/agents/agent-1/versions/2/rollback", {
      method: "POST",
      body: JSON.stringify({ note: "rollback" }),
      headers: { "content-type": "application/json" },
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.version).toBe(4);
    expect(runtime.rollbackAgentVersion).toHaveBeenCalledWith({
      agentId: "agent-1",
      sourceVersion: 2,
      note: "rollback",
    });
  });

  it("deletes agent memory through the runtime", async () => {
    const runtime = {
      deleteAgentMemory: vi.fn().mockResolvedValue({ deleted: true }),
    } as unknown as WorkerRuntime;

    const response = await createWorkerApp(runtime).request("/agents/agent-1/memories/memory-1", {
      method: "DELETE",
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.deleted).toBe(true);
    expect(runtime.deleteAgentMemory).toHaveBeenCalledWith({
      agentId: "agent-1",
      memoryId: "memory-1",
    });
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

  async start(jobName: string, metadata?: JobRunMetadata): Promise<StartedJobRun> {
    const id = `job-run-${this.records.length + 1}`;
    this.records.push({
      id,
      jobName,
      status: "running",
      metadata,
    });

    return { id };
  }

  async succeed(jobRunId: string, metadata?: JobRunMetadata): Promise<void> {
    this.update(jobRunId, {
      status: "succeeded",
      metadata,
    });
  }

  async fail(jobRunId: string, errorSummary: string, metadata?: JobRunMetadata): Promise<void> {
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
