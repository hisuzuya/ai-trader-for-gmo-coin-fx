import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

import { extractSkills } from "./mcp-stdio-recall-skills.js";

async function main() {
  const agentId = process.env.AGENT_ID;
  if (!agentId) {
    throw new Error("AGENT_ID is required");
  }

  const limit = Number.parseInt(process.env.RECALL_SKILLS_LIMIT ?? "3", 10);
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error(
      `RECALL_SKILLS_LIMIT must be a positive integer: ${process.env.RECALL_SKILLS_LIMIT}`,
    );
  }

  const serverScript =
    process.env.MCP_STDIO_SERVER_SCRIPT ??
    firstExistingPath([
      resolve(process.cwd(), "apps/mcp-agent-research/dist/mcp-stdio.cjs"),
      resolve(process.cwd(), "dist/mcp-stdio.cjs"),
    ]);

  if (!existsSync(serverScript)) {
    throw new Error(`MCP stdio server script not found: ${serverScript}`);
  }

  const client = new Client({ name: "ai-trade-mcp-recall-skills-smoke", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: process.env.MCP_STDIO_SERVER_COMMAND ?? process.execPath,
    args: [serverScript],
  });

  try {
    await client.connect(transport);
    const result = await client.callTool({
      name: "recall_skills",
      arguments: { agentId, limit },
    });
    const skills = extractSkills(result);

    if (!Array.isArray(skills)) {
      throw new Error("recall_skills did not return an array");
    }

    if (process.argv.includes("--count")) {
      console.log(String(skills.length));
      return;
    }

    console.log(
      JSON.stringify({
        ok: true,
        transport: "stdio",
        tool: "recall_skills",
        agentId,
        limit,
        skillCount: skills.length,
      }),
    );
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
