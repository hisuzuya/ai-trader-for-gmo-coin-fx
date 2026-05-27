import { env } from "@ai-trade/config";
import { CandleRepository } from "@ai-trade/db";
import { serve } from "@hono/node-server";

import { createWorkerApp } from "./hono-app.js";
import { AgentScheduler } from "./pipelines/agent-evaluation/scheduler.js";
import { CollectorService } from "./pipelines/market-data/collector.js";
import { GmoHistoricalImporter } from "./pipelines/market-data/historical-importer.js";
import {
  DbCandidateStrategyRepository,
  PaperTraderService,
} from "./pipelines/paper-trading/paper-trader.js";
import { WorkerRuntime } from "./runtime.js";
import { AiDailyReviewerService } from "./services/ai-daily-reviewer.js";
import { AiTunerService } from "./services/ai-tuner.js";

const runtime = new WorkerRuntime(
  [
    new CollectorService({ candleWriter: new CandleRepository() }),
    new PaperTraderService({ candidateRepository: new DbCandidateStrategyRepository() }),
    new AiTunerService(),
    new AiDailyReviewerService(),
    new AgentScheduler(),
  ],
  new GmoHistoricalImporter(),
);

async function main() {
  await runtime.start();

  const server = serve({
    fetch: createWorkerApp(runtime).fetch,
    port: env.WORKER_PORT,
    hostname: "0.0.0.0",
  });

  const shutdown = async () => {
    await runtime.stop();
    server.close(() => {
      process.exit(0);
    });
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  console.log(`worker listening on :${env.WORKER_PORT}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
