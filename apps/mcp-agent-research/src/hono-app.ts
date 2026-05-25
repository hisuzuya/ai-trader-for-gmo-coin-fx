import { Hono } from "hono";

import {
  calcIndicator,
  getCandidatePerformance,
  getRejectionHistory,
  readBars,
  recallMemory,
} from "./tools.js";

export function createMcpAgentResearchApp() {
  const app = new Hono();

  app.get("/health", (c) => c.json({ ok: true, service: "mcp-agent-research" }));
  app.post("/tools/read_bars", async (c) =>
    c.json({ ok: true, result: await readBars(await c.req.json()) }),
  );
  app.post("/tools/calc_indicator", async (c) =>
    c.json({ ok: true, result: await calcIndicator(await c.req.json()) }),
  );
  app.post("/tools/get_candidate_performance", async (c) =>
    c.json({ ok: true, result: await getCandidatePerformance(await c.req.json()) }),
  );
  app.post("/tools/get_rejection_history", async (c) =>
    c.json({ ok: true, result: await getRejectionHistory(await c.req.json()) }),
  );
  app.post("/tools/recall_memory", async (c) =>
    c.json({ ok: true, result: await recallMemory(await c.req.json()) }),
  );

  return app;
}
