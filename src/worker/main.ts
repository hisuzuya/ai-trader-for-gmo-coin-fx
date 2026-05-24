import { serve } from "@hono/node-server";

import { env } from "@/shared/env/server";
import { createWorkerApp } from "@/worker/hono-app";
import { WorkerRuntime } from "@/worker/runtime";
import { StaticWorkerService } from "@/worker/services/static-service";

const runtime = new WorkerRuntime([
  new StaticWorkerService("collector"),
  new StaticWorkerService("paper-trader"),
  new StaticWorkerService("ai-tuner"),
  new StaticWorkerService("ai-daily-reviewer"),
]);

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
