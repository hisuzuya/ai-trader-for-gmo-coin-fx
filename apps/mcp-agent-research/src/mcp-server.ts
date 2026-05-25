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
    async (input) => toToolResult(await readBars(input)),
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
    async (input) => toToolResult(await calcIndicator(input)),
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
    async (input) => toToolResult(await getCandidatePerformance(input)),
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
    async (input) => toToolResult(await getRejectionHistory(input)),
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
    async (input) => toToolResult(await recallMemory(input)),
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
    async (input) => toToolResult(await recallSkills(input)),
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
    async (input) => toToolResult(await getSkill(input)),
  );

  return server;
}

function toToolResult(result: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(result) }],
    structuredContent: { result },
  };
}
