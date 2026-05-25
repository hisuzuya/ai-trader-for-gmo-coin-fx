import { describe, expect, it } from "vitest";

import { createMcpAgentResearchApp } from "./hono-app.js";

describe("mcp-agent-research Hono app", () => {
  it("returns health without exposing mutation tools", async () => {
    const response = await createMcpAgentResearchApp().request("/health");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ ok: true, service: "mcp-agent-research" });
  });
});
