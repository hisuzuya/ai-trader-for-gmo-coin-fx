import { env } from "@ai-trade/config";
import { serve } from "@hono/node-server";

import { createMcpAgentResearchApp } from "./hono-app.js";

const port = env.MCP_AGENT_RESEARCH_PORT;

serve({
  fetch: createMcpAgentResearchApp().fetch,
  port,
  hostname: "0.0.0.0",
});

console.log(`mcp-agent-research listening on :${port}`);
