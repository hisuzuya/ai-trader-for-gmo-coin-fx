import {
  AGENT_RESEARCH_TOOL_NAMES,
  type AgentDefinition,
  type AgentRunOutput,
  type AgentRunResponse,
  type AgentStrategyProposal,
  type AgentToolCallLog,
} from "@ai-trade/domain/ai-agents";
import { validateAiStrategyProposal } from "@ai-trade/domain/strategies";
import { eq, sql } from "drizzle-orm";

import { db } from "../client.js";
import {
  aiAgentCandidateReviews,
  aiAgentMemories,
  aiAgentObservations,
  aiAgentRuns,
  aiAgentStrategyProposals,
  aiAgents,
  aiAgentVersions,
  strategyRuns,
} from "../schema/index.js";

type AiAgentDatabase = Pick<typeof db, "insert" | "select" | "transaction">;
type AiAgentWriteDatabase = Pick<typeof db, "insert" | "update">;
const SECRET_LIKE_PATTERN =
  /(sk-[A-Za-z0-9_-]{16,}|[A-Z0-9_]*(?:SECRET|TOKEN|PASSWORD|API_KEY)[A-Z0-9_]*\s*[:=]\s*["']?[^"',\s}]+)/;
const SECRET_LIKE_GLOBAL_PATTERN =
  /(sk-[A-Za-z0-9_-]{16,}|[A-Z0-9_]*(?:SECRET|TOKEN|PASSWORD|API_KEY)[A-Z0-9_]*\s*[:=]\s*["']?[^"',\s}]+)/g;

export const RESEARCH_AGENT_SEED_ID = "11111111-1111-4111-8111-111111111111";

export type AgentVersionInput = {
  agentId: string;
  systemPrompt: string;
  allowedTools: string[];
  note?: string;
};

export type AgentRunRecordInput = {
  id: string;
  agentId: string;
  agentVersion: number;
  requestSummary: unknown;
  response: AgentRunResponse;
};

export class AiAgentRepository {
  constructor(private readonly database: AiAgentDatabase = db) {}

  async listAgents(): Promise<AgentDefinition[]> {
    const rows = await this.database.select().from(aiAgents);
    return rows.map(toAgentDefinition);
  }

  async seedResearchAgent(): Promise<void> {
    await this.database
      .insert(aiAgents)
      .values(toResearchAgentSeedRow())
      .onConflictDoNothing({ target: aiAgents.id });

    await this.database
      .insert(aiAgentVersions)
      .values({
        id: "22222222-2222-4222-8222-222222222222",
        agentId: RESEARCH_AGENT_SEED_ID,
        version: "1",
        systemPrompt: RESEARCH_AGENT_SYSTEM_PROMPT,
        allowedTools: [...AGENT_RESEARCH_TOOL_NAMES],
        note: "Initial Research Agent 01 seed.",
      })
      .onConflictDoNothing({
        target: [aiAgentVersions.agentId, aiAgentVersions.version],
      });
  }

  async createVersion(input: AgentVersionInput): Promise<{ version: number }> {
    return this.database.transaction(async (tx) => {
      const allowedTools = filterAllowedTools(input.allowedTools);
      const updatedRows = await tx
        .update(aiAgents)
        .set({
          systemPrompt: input.systemPrompt,
          allowedTools,
          currentVersion: sql`${aiAgents.currentVersion} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(aiAgents.id, input.agentId))
        .returning({ version: aiAgents.currentVersion });
      const updated = updatedRows[0];

      if (!updated) {
        throw new Error("Agent not found.");
      }

      const nextVersion = Number(updated.version);

      await tx.insert(aiAgentVersions).values({
        agentId: input.agentId,
        version: String(nextVersion),
        systemPrompt: input.systemPrompt,
        allowedTools,
        note: input.note,
      });

      return { version: nextVersion };
    });
  }

  async recordRun(input: AgentRunRecordInput): Promise<void> {
    await this.database.transaction(async (tx) => {
      await tx.insert(aiAgentRuns).values(toAgentRunInsertRow(input));

      if (!input.response.output) {
        return;
      }

      await recordAcceptedOutput(tx, input.id, input.agentId, input.response.output);
    });
  }
}

export function toResearchAgentSeedRow() {
  return {
    id: RESEARCH_AGENT_SEED_ID,
    name: "Research Agent 01",
    persona: "USD/JPY paper strategy researcher",
    systemPrompt: RESEARCH_AGENT_SYSTEM_PROMPT,
    allowedTools: [...AGENT_RESEARCH_TOOL_NAMES],
    status: "active" as const,
    currentVersion: "1",
    runIntervalSec: "3600",
    model: "claude-sonnet-4-5",
  };
}

export function toAgentRunInsertRow(input: AgentRunRecordInput) {
  return {
    id: input.id,
    agentId: input.agentId,
    agentVersion: String(input.agentVersion),
    startedAt: new Date(input.response.startedAt),
    finishedAt: new Date(input.response.finishedAt),
    status: input.response.status,
    inputSummary: input.requestSummary,
    outputSummary: input.response.outputSummary,
    toolCalls: redactToolCalls(input.response.toolCalls),
    tokenUsage: redactUnknown(input.response.tokenUsage),
    error: input.response.error ? redactSecretLikeText(input.response.error) : undefined,
  };
}

export function summarizeAgentOutput(output: AgentRunOutput) {
  return {
    observations: output.observations.length,
    strategyProposals: output.strategyProposals.length,
    candidateReviews: output.candidateReviews.length,
    memoryWrites: output.memoryWrites.length,
  };
}

async function recordAcceptedOutput(
  tx: AiAgentWriteDatabase,
  runId: string,
  agentId: string,
  output: AgentRunOutput,
) {
  if (output.observations.length > 0) {
    await tx.insert(aiAgentObservations).values(
      output.observations.map((observation) => ({
        runId,
        agentId,
        kind: observation.kind,
        summary: observation.summary,
        evidence: observation.evidence,
        tags: observation.tags,
      })),
    );
  }

  for (const proposal of output.strategyProposals) {
    await recordStrategyProposal(tx, runId, agentId, proposal);
  }

  if (output.candidateReviews.length > 0) {
    await tx.insert(aiAgentCandidateReviews).values(
      output.candidateReviews.map((review) => ({
        runId,
        agentId,
        strategyName: review.strategyName,
        recommendation: review.recommendation,
        confidence: review.confidence,
        reason: review.reason,
        evidence: review.evidence,
        applied: false,
      })),
    );
  }

  if (output.memoryWrites.length > 0) {
    await tx.insert(aiAgentMemories).values(
      output.memoryWrites.map((memory) => ({
        agentId,
        type: memory.type,
        content: memory.content,
        tags: memory.tags,
        sourceRefs: memory.sourceRefs,
        searchVector: memory.content,
      })),
    );
  }
}

async function recordStrategyProposal(
  tx: AiAgentWriteDatabase,
  runId: string,
  agentId: string,
  proposal: AgentStrategyProposal,
) {
  const validation = validateAiStrategyProposal({
    rationale: proposal.rationale,
    strategy: proposal.strategy,
  });
  const proposalRows = await tx
    .insert(aiAgentStrategyProposals)
    .values({
      runId,
      agentId,
      strategyName: proposal.strategy.meta.name,
      proposalJson: proposal,
      validationStatus: validation.status === "accepted" ? "accepted" : "rejected",
      rejectionReasons: validation.status === "rejected" ? validation.reasons : undefined,
    })
    .returning({ id: aiAgentStrategyProposals.id });
  const proposalId = proposalRows[0]?.id;

  if (validation.status !== "accepted" || !proposalId) {
    return;
  }

  await tx.insert(strategyRuns).values({
    id: proposalId,
    strategyName: validation.proposal.strategy.meta.name,
    symbol: validation.proposal.strategy.meta.symbol,
    timeframe: validation.proposal.strategy.meta.timeframe,
    status: "proposed",
    strategyDefinition: validation.proposal.strategy,
    sourceAgentId: agentId,
    sourceProposalId: proposalId,
    startedAt: new Date(),
    finishedAt: new Date(),
    metadata: {
      source: "agent_strategy_proposal",
      agentId,
      proposalId,
      candidateSlot: true,
    },
  });

  await tx
    .update(aiAgentStrategyProposals)
    .set({ insertedStrategyRunId: proposalId })
    .where(eq(aiAgentStrategyProposals.id, proposalId));
}

function toAgentDefinition(row: typeof aiAgents.$inferSelect): AgentDefinition {
  return {
    id: row.id,
    name: row.name,
    persona: row.persona,
    systemPrompt: row.systemPrompt,
    allowedTools: filterAllowedTools(row.allowedTools),
    status: row.status,
    currentVersion: Number(row.currentVersion),
    runIntervalSec: Number(row.runIntervalSec),
    model: row.model,
  };
}

function filterAllowedTools(input: unknown): AgentDefinition["allowedTools"] {
  if (!Array.isArray(input)) {
    return [];
  }

  return input.filter((tool): tool is AgentDefinition["allowedTools"][number] =>
    (AGENT_RESEARCH_TOOL_NAMES as readonly string[]).includes(String(tool)),
  );
}

function redactToolCalls(toolCalls: AgentToolCallLog[]) {
  return toolCalls.map((call) => ({
    name: call.name,
    argsSummary: redactUnknown(call.argsSummary),
    resultSummary: redactUnknown(call.resultSummary),
  }));
}

function redactUnknown(value: unknown): unknown {
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

function redactSecretLikeText(input: string): string {
  return input.replace(SECRET_LIKE_GLOBAL_PATTERN, "[REDACTED]");
}

const RESEARCH_AGENT_SYSTEM_PROMPT = [
  "あなたはUSD/JPYのpaper trading戦略を研究するAI agentです。",
  "あなたは注文、決済、baseline昇格、candidate停止を直接実行してはいけません。",
  "あなたの役割は、市場状態、候補成績、過去の失敗理由、自分のmemoryを観察し、Strategy Definition候補、Candidate Review、Observation、Memory WriteをJSONで出力することです。",
  "Strategy Definitionは許可済みDSLだけを使い、risk gateを緩和してはいけません。",
].join("\n");
