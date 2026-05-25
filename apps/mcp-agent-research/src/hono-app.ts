import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { Hono } from "hono";
import { createAgentResearchMcpServer } from "./mcp-server.js";
import {
  calcIndicator,
  getCandidatePerformance,
  getRejectionHistory,
  getSkill,
  readBars,
  recallMemory,
  recallSkills,
} from "./tools.js";

export function createMcpAgentResearchApp() {
  const app = new Hono();

  app.get("/health", (c) => c.json({ ok: true, service: "mcp-agent-research" }));
  app.all("/mcp", async (c) => handleMcpHttpRequest(c.req.raw));
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
  app.post("/tools/recall_skills", async (c) =>
    c.json({ ok: true, result: await recallSkills(await c.req.json()) }),
  );
  app.post("/tools/get_skill", async (c) =>
    c.json({ ok: true, result: await getSkill(await c.req.json()) }),
  );

  return app;
}

async function handleMcpHttpRequest(request: Request) {
  const server = createAgentResearchMcpServer();
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  await server.connect(transport);
  return transport.handleRequest(request);
}
