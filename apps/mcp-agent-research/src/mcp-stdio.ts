import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { createAgentResearchMcpServer } from "./server/mcp-server.js";

async function main() {
  const server = createAgentResearchMcpServer();
  await server.connect(new StdioServerTransport());
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
