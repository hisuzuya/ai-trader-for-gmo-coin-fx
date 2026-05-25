import { env } from "@ai-trade/config";
import {
  AGENT_RESEARCH_TOOL_NAMES,
  type AgentResearchToolName,
  type AgentRunRequest,
  type AgentRunResponse,
  type AgentToolCallLog,
  validateAgentRunOutput,
} from "@ai-trade/domain/ai-agents";

import type { StrategyProposalProvider } from "./claude-cli-provider.js";

const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_TOOL_HOPS = 5;
const DEFAULT_OUTPUT_SIZE_LIMIT_BYTES = 128 * 1024;
const ESTIMATED_USD_PER_1K_TOKENS = 0.003;
const SECRET_LIKE_PATTERN =
  /(sk-[A-Za-z0-9_-]{16,}|[A-Z0-9_]*(?:SECRET|TOKEN|PASSWORD|API_KEY)[A-Z0-9_]*\s*[:=]\s*["']?[^"',\s}]+)/;
const SECRET_LIKE_GLOBAL_PATTERN =
  /(sk-[A-Za-z0-9_-]{16,}|[A-Z0-9_]*(?:SECRET|TOKEN|PASSWORD|API_KEY)[A-Z0-9_]*\s*[:=]\s*["']?[^"',\s}]+)/g;

export interface AgentRunner {
  run(input: AgentRunRequest): Promise<AgentRunResponse>;
}

export interface AgentToolClient {
  call(input: { name: AgentResearchToolName; args: unknown }): Promise<unknown>;
}

export class AiAgentRunner implements AgentRunner {
  constructor(
    private readonly provider: StrategyProposalProvider,
    private readonly toolClient: AgentToolClient = new HttpAgentToolClient(
      env.MCP_AGENT_RESEARCH_INTERNAL_URL,
    ),
  ) {}

  async run(input: AgentRunRequest): Promise<AgentRunResponse> {
    const startedAt = new Date();
    const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const maxToolHops = input.maxToolHops ?? DEFAULT_MAX_TOOL_HOPS;
    const outputSizeLimitBytes = input.outputSizeLimitBytes ?? DEFAULT_OUTPUT_SIZE_LIMIT_BYTES;
    const toolCalls: AgentToolCallLog[] = [];
    let prompt = buildAgentPrompt(input, maxToolHops, toolCalls);
    let totalInputTokens = 0;
    let totalOutputTokens = 0;

    for (let hop = 0; hop <= maxToolHops; hop += 1) {
      const inputTokens = estimateTokens(prompt);
      totalInputTokens += inputTokens;

      if (totalInputTokens > input.agent.tokenBudgetPerRun) {
        return {
          ok: false,
          status: "rejected_output",
          toolCalls: toolCalls.map(redactToolCall),
          tokenUsage: buildTokenUsage(totalInputTokens, totalOutputTokens),
          error: "Agent exceeded tokenBudgetPerRun before invocation.",
          startedAt: startedAt.toISOString(),
          finishedAt: new Date().toISOString(),
        };
      }

      const invocation = await this.provider.invoke({ prompt, timeoutMs });
      const finishedAt = new Date();

      if (!invocation.ok) {
        return {
          ok: false,
          status: invocation.error.includes("timed out") ? "timeout" : "failed",
          toolCalls: toolCalls.map(redactToolCall),
          tokenUsage: buildTokenUsage(totalInputTokens, totalOutputTokens),
          error: redactSecretLikeText(invocation.error),
          startedAt: invocation.startedAt,
          finishedAt: invocation.finishedAt,
        };
      }

      totalOutputTokens += estimateTokens(invocation.stdout);

      if (Buffer.byteLength(invocation.stdout, "utf8") > outputSizeLimitBytes) {
        return {
          ok: false,
          status: "rejected_output",
          toolCalls: toolCalls.map(redactToolCall),
          tokenUsage: buildTokenUsage(totalInputTokens, totalOutputTokens),
          error: "Agent output exceeded outputSizeLimitBytes.",
          startedAt: startedAt.toISOString(),
          finishedAt: finishedAt.toISOString(),
        };
      }

      if (totalInputTokens + totalOutputTokens > input.agent.tokenBudgetPerRun) {
        return {
          ok: false,
          status: "rejected_output",
          toolCalls: toolCalls.map(redactToolCall),
          tokenUsage: buildTokenUsage(totalInputTokens, totalOutputTokens),
          error: "Agent exceeded tokenBudgetPerRun.",
          startedAt: startedAt.toISOString(),
          finishedAt: finishedAt.toISOString(),
        };
      }

      const validation = validateAgentRunOutput(invocation.stdout);

      if (validation.status === "accepted") {
        return {
          ok: true,
          status: "succeeded",
          output: validation.output,
          outputSummary: {
            observations: validation.output.observations.length,
            strategyProposals: validation.output.strategyProposals.length,
            candidateReviews: validation.output.candidateReviews.length,
            memoryWrites: validation.output.memoryWrites.length,
          },
          toolCalls: toolCalls.map(redactToolCall),
          tokenUsage: buildTokenUsage(totalInputTokens, totalOutputTokens),
          startedAt: invocation.startedAt,
          finishedAt: invocation.finishedAt,
        };
      }

      const toolRequests = parseToolRequests(invocation.stdout);

      if (toolRequests.length === 0) {
        return {
          ok: false,
          status: "rejected_output",
          outputSummary: { rejectionReasons: validation.reasons },
          toolCalls: toolCalls.map(redactToolCall),
          tokenUsage: buildTokenUsage(totalInputTokens, totalOutputTokens),
          error: validation.reasons.map((reason) => reason.message).join("; "),
          startedAt: invocation.startedAt,
          finishedAt: invocation.finishedAt,
        };
      }

      if (toolCalls.length + toolRequests.length > maxToolHops) {
        return {
          ok: false,
          status: "rejected_output",
          toolCalls: toolCalls.map(redactToolCall),
          tokenUsage: buildTokenUsage(totalInputTokens, totalOutputTokens),
          error: "Agent exceeded maxToolHops.",
          startedAt: startedAt.toISOString(),
          finishedAt: finishedAt.toISOString(),
        };
      }

      for (const request of toolRequests) {
        const result = await this.executeToolRequest(input, request);
        toolCalls.push(result);
      }

      prompt = buildAgentPrompt(input, maxToolHops, toolCalls);
    }

    return {
      ok: false,
      status: "rejected_output",
      toolCalls: toolCalls.map(redactToolCall),
      tokenUsage: buildTokenUsage(totalInputTokens, totalOutputTokens),
      error: "Agent did not produce structured output before maxToolHops.",
      startedAt: startedAt.toISOString(),
      finishedAt: new Date().toISOString(),
    };
  }

  private async executeToolRequest(
    input: AgentRunRequest,
    request: AgentToolRequest,
  ): Promise<AgentToolCallLog> {
    if (!input.agent.allowedTools.includes(request.name)) {
      return {
        name: request.name,
        argsSummary: request.args,
        resultSummary: { ok: false, error: "Tool is not allowed for this agent." },
      };
    }

    try {
      return {
        name: request.name,
        argsSummary: request.args,
        resultSummary: await this.toolClient.call({ name: request.name, args: request.args }),
      };
    } catch (error) {
      return {
        name: request.name,
        argsSummary: request.args,
        resultSummary: {
          ok: false,
          error: error instanceof Error ? error.message : "Tool call failed.",
        },
      };
    }
  }
}

export function buildAgentPrompt(
  input: AgentRunRequest,
  maxToolHops = DEFAULT_MAX_TOOL_HOPS,
  toolResults: AgentToolCallLog[] = [],
) {
  return JSON.stringify({
    instruction:
      'Return JSON only. You are a research and evaluation agent, not a trader. Do not place orders, close positions, write SQL, mutate repositories, access files, call shell commands, or produce live trading instructions. Use only the provided deterministic context and the listed read-only tools. If additional read-only data is required, return {"toolRequests":[{"name":"read_bars|calc_indicator|get_candidate_performance|get_rejection_history|recall_memory","args":{...}}]}. After tool results are provided, return the final AgentRunOutput JSON. All natural-language text MUST be written in Japanese.',
    agent: {
      id: input.agent.id,
      name: input.agent.name,
      persona: input.agent.persona,
      version: input.version,
      model: input.agent.model,
      allowedTools: input.agent.allowedTools,
    },
    systemPrompt: redactSecretLikeText(input.agent.systemPrompt),
    contextSummary: redactSecretLikeText(input.contextSummary),
    limits: {
      maxToolHops,
      outputSizeLimitBytes: input.outputSizeLimitBytes ?? DEFAULT_OUTPUT_SIZE_LIMIT_BYTES,
      tokenBudgetPerRun: input.agent.tokenBudgetPerRun,
      costBudgetPerRunUsd: input.agent.costBudgetPerRunUsd,
    },
    toolResults: toolResults.map(redactToolCall),
    outputSchema: {
      observations:
        "array of { kind: market|candidate_performance|risk|operations, summary, evidence: string[], tags: string[] }",
      strategyProposals:
        "array of { rationale, strategy: StrategyDefinition, expectedEdge, risks: string[], memoryRefs: string[] }",
      candidateReviews:
        "array of { strategyName, recommendation: continue|retire|promote, confidence: low|medium|high, reason, evidence: string[] }",
      memoryWrites:
        "array of { type: market_observation|strategy_hypothesis|proposal_review|rejection_learning, content, tags: string[], sourceRefs: string[] }",
    },
  });
}

type AgentToolRequest = {
  name: AgentResearchToolName;
  args: unknown;
};

class HttpAgentToolClient implements AgentToolClient {
  constructor(private readonly baseUrl: string) {}

  async call(input: { name: AgentResearchToolName; args: unknown }): Promise<unknown> {
    const response = await fetch(new URL(`/tools/${input.name}`, this.baseUrl), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input.args ?? {}),
    });
    const body = (await response.json().catch(() => null)) as unknown;

    if (!response.ok) {
      throw new Error(`Tool ${input.name} failed with HTTP ${response.status}.`);
    }

    return body;
  }
}

function parseToolRequests(output: string): AgentToolRequest[] {
  const parsed = parseJsonObject(output);

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("toolRequests" in parsed) ||
    !Array.isArray(parsed.toolRequests)
  ) {
    return [];
  }

  return parsed.toolRequests.flatMap((request): AgentToolRequest[] => {
    if (
      typeof request !== "object" ||
      request === null ||
      !("name" in request) ||
      typeof request.name !== "string" ||
      !(AGENT_RESEARCH_TOOL_NAMES as readonly string[]).includes(request.name)
    ) {
      return [];
    }

    return [
      { name: request.name as AgentResearchToolName, args: "args" in request ? request.args : {} },
    ];
  });
}

function parseJsonObject(input: string): unknown {
  try {
    return JSON.parse(stripJsonFence(input));
  } catch {
    return null;
  }
}

function stripJsonFence(input: string): string {
  const trimmed = input.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);

  return fenced?.[1] ?? trimmed;
}

export function redactToolCall(call: AgentToolCallLog): AgentToolCallLog {
  return {
    name: call.name,
    argsSummary: redactUnknown(call.argsSummary),
    resultSummary: redactUnknown(call.resultSummary),
  };
}

export function redactUnknown(value: unknown): unknown {
  if (typeof value === "string") {
    return redactSecretLikeText(value);
  }

  if (Array.isArray(value)) {
    return value.map(redactUnknown);
  }

  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        SECRET_LIKE_PATTERN.test(key) ? "[REDACTED]" : redactUnknown(entry),
      ]),
    );
  }

  return value;
}

export function redactSecretLikeText(input: string): string {
  return input.replace(SECRET_LIKE_GLOBAL_PATTERN, "[REDACTED]");
}

function estimateTokens(input: string): number {
  return Math.ceil(Buffer.byteLength(input, "utf8") / 4);
}

function buildTokenUsage(inputTokens: number, outputTokens: number) {
  const totalTokens = inputTokens + outputTokens;

  return {
    inputTokens,
    outputTokens,
    totalTokens,
    estimatedCostUsd: Number(((totalTokens / 1000) * ESTIMATED_USD_PER_1K_TOKENS).toFixed(6)),
  };
}
