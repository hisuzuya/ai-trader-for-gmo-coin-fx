import { createServer } from "node:http";
import { env } from "@ai-trade/config";
import { getRequestListener } from "@hono/node-server";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

import { createMcpAgentResearchApp } from "./hono-app.js";
import { createAgentResearchMcpServer } from "./mcp-server.js";

const port = env.MCP_AGENT_RESEARCH_PORT;
const app = createMcpAgentResearchApp();
const appListener = getRequestListener(app.fetch, { hostname: "0.0.0.0" });

createServer(async (req, res) => {
  if (req.url?.startsWith("/mcp")) {
    const mcpServer = createAgentResearchMcpServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => {
      void transport.close();
    });

    await mcpServer.connect(transport);
    await transport.handleRequest(req, res);
    return;
  }

  await appListener(req, res);
}).listen(port, "0.0.0.0");

console.log(`mcp-agent-research listening on :${port}`);
