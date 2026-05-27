import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

async function main() {
  const agentId = process.env.AGENT_ID;
  if (!agentId) {
    throw new Error("AGENT_ID is required");
  }

  const timeframe = process.env.CONTEXT_SNAPSHOT_TIMEFRAME ?? "1h";
  const serverScript =
    process.env.MCP_STDIO_SERVER_SCRIPT ??
    firstExistingPath([
      resolve(process.cwd(), "apps/mcp-agent-research/dist/mcp-stdio.cjs"),
      resolve(process.cwd(), "dist/mcp-stdio.cjs"),
    ]);

  if (!existsSync(serverScript)) {
    throw new Error(`MCP stdio server script not found: ${serverScript}`);
  }

  const client = new Client({ name: "ai-trade-mcp-context-snapshot-smoke", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: process.env.MCP_STDIO_SERVER_COMMAND ?? process.execPath,
    args: [serverScript],
  });

  try {
    await client.connect(transport);
    const result = await client.callTool({
      name: "get_context_snapshot",
      arguments: { agentId, timeframe },
    });
    const snapshot = extractContextSnapshot(result);

    if (!snapshot) {
      throw new Error(`get_context_snapshot did not return a snapshot: ${summarizeResult(result)}`);
    }

    console.log(
      JSON.stringify({
        ok: true,
        transport: "stdio",
        tool: "get_context_snapshot",
        agentId,
        timeframe: snapshot.timeframe,
        candleCount: snapshot.market.candleCount,
        candidates: Array.isArray(snapshot.candidates) ? snapshot.candidates.length : null,
        memories: Array.isArray(snapshot.memories) ? snapshot.memories.length : null,
      }),
    );
  } finally {
    await client.close();
  }
}

type ContextSnapshot = {
  timeframe: string;
  market: {
    candleCount: number;
  };
  candidates?: unknown[];
  memories?: unknown[];
};

function extractContextSnapshot(result: unknown): ContextSnapshot | undefined {
  return findContextSnapshot(result, 0);
}

function findContextSnapshot(value: unknown, depth: number): ContextSnapshot | undefined {
  if (depth > 6) {
    return undefined;
  }

  if (typeof value === "string") {
    try {
      return findContextSnapshot(JSON.parse(value), depth + 1);
    } catch {
      return undefined;
    }
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = findContextSnapshot(entry, depth + 1);
      if (found) {
        return found;
      }
    }

    return undefined;
  }

  if (!isRecord(value)) {
    return undefined;
  }

  if (typeof value.text === "string") {
    const found = findContextSnapshot(value.text, depth + 1);
    if (found) {
      return found;
    }
  }

  if (isContextSnapshot(value)) {
    return value;
  }

  for (const entry of Object.values(value)) {
    const found = findContextSnapshot(entry, depth + 1);
    if (found) {
      return found;
    }
  }

  return undefined;
}

function isContextSnapshot(value: Record<string, unknown>): value is ContextSnapshot {
  if (typeof value.timeframe !== "string" || !isRecord(value.market)) {
    return false;
  }

  return typeof value.market.candleCount === "number";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function firstExistingPath(paths: string[]) {
  const found = paths.find((path) => existsSync(path));
  if (!found) {
    return paths[0] ?? "";
  }

  return found;
}

function summarizeResult(value: unknown) {
  const text = JSON.stringify(value);
  if (!text) {
    return String(value);
  }

  return text.length > 1_000 ? `${text.slice(0, 1_000)}...<truncated>` : text;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
