import { serve } from "@hono/node-server";

import { createAiRunnerApp } from "./hono-app";

const port = parsePort(process.env.AI_RUNNER_PORT);

const server = serve({
  fetch: createAiRunnerApp().fetch,
  hostname: "0.0.0.0",
  port,
});

const shutdown = () => {
  server.close(() => {
    process.exit(0);
  });
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

console.log(`ai-runner listening on :${port}`);

function parsePort(value: string | undefined) {
  if (value === undefined) {
    return 8788;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error("AI_RUNNER_PORT must be a positive integer.");
  }

  return parsed;
}
