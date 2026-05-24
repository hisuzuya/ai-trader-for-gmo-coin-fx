import { Hono } from "hono";

export type AiRunnerProviderState = {
  name: "claude_cli";
  mode: "disabled";
  implementation: "stub";
  enabled: false;
  reason: string;
};

export type AiRunnerHealth = {
  ok: true;
  service: "ai-runner";
  provider: AiRunnerProviderState;
};

const providerState: AiRunnerProviderState = {
  name: "claude_cli",
  mode: "disabled",
  implementation: "stub",
  enabled: false,
  reason: "Claude CLI execution is not implemented in this stub.",
};

export function createAiRunnerApp() {
  const app = new Hono();

  app.get("/health", (c) =>
    c.json({
      ok: true,
      service: "ai-runner",
      provider: providerState,
    } satisfies AiRunnerHealth),
  );

  app.get("/ready", (c) =>
    c.json({
      ok: true,
      service: "ai-runner",
      provider: providerState,
    } satisfies AiRunnerHealth),
  );

  return app;
}
