import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

import { MCP_TOOL_NAMES } from "./server/mcp-server.js";

async function main() {
  const serverScript =
    process.env.MCP_STDIO_SERVER_SCRIPT ??
    firstExistingPath([
      resolve(process.cwd(), "apps/mcp-agent-research/dist/mcp-stdio.cjs"),
      resolve(process.cwd(), "dist/mcp-stdio.cjs"),
    ]);

  if (!existsSync(serverScript)) {
    throw new Error(`MCP stdio server script not found: ${serverScript}`);
  }

  const client = new Client({ name: "ai-trade-mcp-stdio-smoke", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: process.env.MCP_STDIO_SERVER_COMMAND ?? process.execPath,
    args: [serverScript],
  });

  try {
    await client.connect(transport);
    const result = await client.listTools();
    const names = result.tools.map((tool) => tool.name).sort();
    const expected = [...MCP_TOOL_NAMES].sort();
    const missing = expected.filter((name) => !names.includes(name));

    if (missing.length > 0) {
      throw new Error(`MCP stdio tools missing: ${missing.join(", ")}`);
    }

    console.log(JSON.stringify({ ok: true, transport: "stdio", tools: names }));
  } finally {
    await client.close();
  }
}

function firstExistingPath(paths: string[]) {
  const found = paths.find((path) => existsSync(path));
  if (!found) {
    return paths[0] ?? "";
  }
  return found;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
