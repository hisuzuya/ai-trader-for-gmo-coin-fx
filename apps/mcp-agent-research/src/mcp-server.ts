import { appendFileSync } from "node:fs";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import {
  calcIndicator,
  getCandidatePerformance,
  getRejectionHistory,
  getSkill,
  readBars,
  recallMemory,
  recallSkills,
} from "./tools.js";

export const MCP_SERVER_NAME = "agent_research";
export const MCP_TOOL_NAMES = [
  "read_bars",
  "calc_indicator",
  "get_candidate_performance",
  "get_rejection_history",
  "recall_memory",
  "recall_skills",
  "get_skill",
] as const;

export function createAgentResearchMcpServer() {
  const server = new McpServer({
    name: "ai-trade-agent-research",
    version: "1.0.0",
  });

  server.registerTool(
    "read_bars",
    {
      title: "Read Recent Bars",
      description: "Read recent USD/JPY candle bars from the read-only market data store.",
      inputSchema: z.object({
        symbol: z.string().default("USD_JPY"),
        timeframe: z.string().default("1m"),
        count: z.number().int().positive().max(500).default(100),
        priceType: z.enum(["bid", "ask", "mid"]).default("mid"),
      }),
    },
    async (input) =>
      toToolResult(await recordToolActivity("read_bars", input, () => readBars(input))),
  );

  server.registerTool(
    "calc_indicator",
    {
      title: "Calculate Indicator",
      description: "Calculate SMA, EMA, or RSI from read-only market data.",
      inputSchema: z.object({
        symbol: z.string().default("USD_JPY"),
        timeframe: z.string().default("1m"),
        indicator: z.enum(["sma", "ema", "rsi"]),
        params: z.object({ period: z.number().int().positive().optional() }).default({}),
        count: z.number().int().positive().max(500).default(100),
      }),
    },
    async (input) =>
      toToolResult(await recordToolActivity("calc_indicator", input, () => calcIndicator(input))),
  );

  server.registerTool(
    "get_candidate_performance",
    {
      title: "Get Candidate Performance",
      description: "Read the latest paper-trading performance summary for one strategy.",
      inputSchema: z.object({
        strategyName: z.string().min(1),
      }),
    },
    async (input) =>
      toToolResult(
        await recordToolActivity("get_candidate_performance", input, () =>
          getCandidatePerformance(input),
        ),
      ),
  );

  server.registerTool(
    "get_rejection_history",
    {
      title: "Get Rejection History",
      description: "Read recent rejected strategy proposal history.",
      inputSchema: z.object({
        strategyName: z.string().min(1).optional(),
        limit: z.number().int().positive().max(500).optional(),
      }),
    },
    async (input) =>
      toToolResult(
        await recordToolActivity("get_rejection_history", input, () => getRejectionHistory(input)),
      ),
  );

  server.registerTool(
    "recall_memory",
    {
      title: "Recall Agent Memory",
      description: "Read matching private/shared agent memories.",
      inputSchema: z.object({
        agentId: z.string().min(1),
        query: z.string().optional(),
        types: z.array(z.string()).optional(),
        limit: z.number().int().positive().max(500).optional(),
      }),
    },
    async (input) =>
      toToolResult(await recordToolActivity("recall_memory", input, () => recallMemory(input))),
  );

  server.registerTool(
    "recall_skills",
    {
      title: "Recall Agent Skills",
      description: "Read matching Japanese private/shared agent skills.",
      inputSchema: z.object({
        agentId: z.string().min(1),
        query: z.string().optional(),
        scopes: z.array(z.enum(["private", "shared"])).optional(),
        tags: z.array(z.string()).optional(),
        limit: z.number().int().positive().max(500).optional(),
      }),
    },
    async (input) =>
      toToolResult(await recordToolActivity("recall_skills", input, () => recallSkills(input))),
  );

  server.registerTool(
    "get_skill",
    {
      title: "Get Agent Skill",
      description: "Read one Japanese private/shared agent skill by id.",
      inputSchema: z.object({
        agentId: z.string().min(1),
        skillId: z.string().min(1),
      }),
    },
    async (input) =>
      toToolResult(await recordToolActivity("get_skill", input, () => getSkill(input))),
  );

  return server;
}

async function recordToolActivity<T>(
  toolName: (typeof MCP_TOOL_NAMES)[number],
  input: unknown,
  callback: () => Promise<T>,
): Promise<T> {
  const startedAt = new Date();

  try {
    const result = await callback();
    appendToolActivity({
      transport: "stdio",
      toolName,
      input,
      status: "succeeded",
      result: summarizeActivityValue(result),
      startedAt: startedAt.toISOString(),
      finishedAt: new Date().toISOString(),
    });
    return result;
  } catch (error) {
    appendToolActivity({
      transport: "stdio",
      toolName,
      input,
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
      startedAt: startedAt.toISOString(),
      finishedAt: new Date().toISOString(),
    });
    throw error;
  }
}

function appendToolActivity(entry: unknown) {
  const filePath = process.env.MCP_AGENT_RESEARCH_ACTIVITY_LOG;
  if (!filePath) {
    return;
  }

  appendFileSync(filePath, `${JSON.stringify(entry)}\n`, { encoding: "utf8" });
}

function toToolResult(result: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(result) }],
    structuredContent: { result },
  };
}

function summarizeActivityValue(value: unknown): unknown {
  if (typeof value === "string") {
    return truncate(value);
  }

  if (Array.isArray(value)) {
    return value.slice(0, 10).map(summarizeActivityValue);
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .slice(0, 20)
        .map(([key, entry]) => [key, summarizeActivityValue(entry)]),
    );
  }

  return value;
}

function truncate(value: string) {
  return value.length > 2_000 ? `${value.slice(0, 2_000)}...<truncated>` : value;
}
