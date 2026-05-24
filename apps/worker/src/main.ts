import { env } from "@ai-trade/config";
import { CandleRepository } from "@ai-trade/db";
import { serve } from "@hono/node-server";

import { createWorkerApp } from "./hono-app.js";
import { GmoHistoricalImporter } from "./jobs/historical-importer.js";
import { WorkerRuntime } from "./runtime.js";
import { CollectorService } from "./services/collector.js";
import { StaticWorkerService } from "./services/static-service.js";

const runtime = new WorkerRuntime(
  [
    new CollectorService({ candleWriter: new CandleRepository() }),
    new StaticWorkerService("paper-trader"),
    new StaticWorkerService("ai-tuner"),
    new StaticWorkerService("ai-daily-reviewer"),
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
