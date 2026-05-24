import { describe, expect, it } from "vitest";

import { createAiRunnerApp } from "./hono-app";

describe("ai-runner Hono app", () => {
  it("returns liveness health with disabled stub provider state", async () => {
    const response = await createAiRunnerApp().request("/health");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      ok: true,
      service: "ai-runner",
      provider: {
        name: "claude_cli",
        mode: "disabled",
        implementation: "stub",
        enabled: false,
        reason: "Claude CLI execution is not implemented in this stub.",
      },
    });
  });

  it("returns readiness without requiring DB or GMO secrets", async () => {
    const response = await createAiRunnerApp().request("/ready");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      service: "ai-runner",
      provider: {
        mode: "disabled",
        implementation: "stub",
        enabled: false,
      },
    });
  });
});
