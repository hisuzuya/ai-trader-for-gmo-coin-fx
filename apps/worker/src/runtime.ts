import {
  checkDbConnection,
  DbJobRunRecorder,
  type JobRunRecorder,
  runRecordedJob,
} from "@ai-trade/db";
import {
  type HistoricalImportResult,
  type HistoricalImporter,
  StubHistoricalImporter,
} from "./jobs/historical-importer.js";
import type { ServiceHealth, WorkerService, WorkerStatus } from "./types.js";

export class WorkerRuntime {
  private readonly startedAt = new Date();
  private started = false;

  constructor(
    private readonly services: WorkerService[],
    private readonly historicalImporter: HistoricalImporter = new StubHistoricalImporter(),
    private readonly jobRunRecorder: JobRunRecorder = new DbJobRunRecorder(),
  ) {}

  async start(): Promise<void> {
    if (this.started) {
      return;
    }

    for (const service of this.services) {
      await service.start();
    }

    this.started = true;
  }

  async stop(): Promise<void> {
    for (const service of [...this.services].reverse()) {
      await service.stop();
    }

    this.started = false;
  }

  async health(): Promise<{ ok: true; service: "worker"; timestamp: string }> {
    return {
      ok: true,
      service: "worker",
      timestamp: new Date().toISOString(),
    };
  }

  async ready(): Promise<{
    ok: boolean;
    checks: {
      db: boolean;
      collector: boolean;
      scheduler: boolean;
      claudeCliProvider: boolean;
    };
  }> {
    const services = await this.serviceHealth();
    const db = await checkDbConnection().catch(() => false);
    const collector = services.some(
      (service) => service.name === "collector" && service.state === "ready",
    );

    const checks = {
      db,
      collector,
      scheduler: this.started,
      claudeCliProvider: true,
    };

    return {
      ok: Object.values(checks).every(Boolean),
      checks,
    };
  }

  async status(): Promise<WorkerStatus> {
    const services = await this.serviceHealth();
    const collector = services.find((service) => service.name === "collector");

    return {
      startedAt: this.startedAt.toISOString(),
      services,
      latestTickerTimestamp: detailString(collector, "latestTickerTimestamp"),
      latestCandleOpenedAt: null,
      websocketConnected: detailBoolean(collector, "websocketConnected"),
      lastReconnectReason: detailString(collector, "lastReconnectReason"),
      lastAiInvocationStatus: null,
    };
  }

  async runHistoricalImport(date: string): Promise<{
    jobRunId: string;
    result: HistoricalImportResult;
  }> {
    return runRecordedJob(
      this.jobRunRecorder,
      "historical-import",
      { date },
      () => this.historicalImporter.importDate({ date }),
    );
  }

  private async serviceHealth(): Promise<ServiceHealth[]> {
    return Promise.all(this.services.map((service) => service.health()));
  }
}

function detailString(
  service: ServiceHealth | undefined,
  key: string,
): string | null {
  const value = service?.details?.[key];
  return typeof value === "string" ? value : null;
}

function detailBoolean(
  service: ServiceHealth | undefined,
  key: string,
): boolean {
  return service?.details?.[key] === true;
}
