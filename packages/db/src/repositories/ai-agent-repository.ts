import {
  AGENT_RESEARCH_TOOL_NAMES,
  type AgentDefinition,
  type AgentRunOutput,
  type AgentRunResponse,
  type AgentStrategyProposal,
  type AgentToolCallLog,
  type CharacterId,
  isCharacterId,
} from "@ai-trade/domain/ai-agents";
import { validateAiStrategyProposal } from "@ai-trade/domain/strategies";
import { and, desc, eq, sql } from "drizzle-orm";

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

type AiAgentDatabase = Pick<typeof db, "delete" | "insert" | "select" | "transaction" | "update">;
type AiAgentWriteDatabase = Pick<typeof db, "insert" | "select" | "update">;
const SECRET_LIKE_PATTERN =
  /(sk-[A-Za-z0-9_-]{16,}|[A-Z0-9_]*(?:SECRET|TOKEN|PASSWORD|API_KEY)[A-Z0-9_]*\s*[:=]\s*["']?[^"',\s}]+)/;
const SECRET_LIKE_GLOBAL_PATTERN =
  /(sk-[A-Za-z0-9_-]{16,}|[A-Z0-9_]*(?:SECRET|TOKEN|PASSWORD|API_KEY)[A-Z0-9_]*\s*[:=]\s*["']?[^"',\s}]+)/g;

export const RESEARCH_AGENT_SEED_ID = "11111111-1111-4111-8111-111111111111";
export const RESEARCH_AGENT_1H_SEED_ID = "33333333-3333-4333-8333-333333333333";

export type AgentVersionInput = {
  agentId: string;
  systemPrompt: string;
  allowedTools: string[];
  note?: string;
};

export type CreateAgentInput = {
  name: string;
  persona: string;
  systemPrompt: string;
  allowedTools: string[];
  runIntervalSec: number;
  model: string;
  characterId: CharacterId | null;
  maxConsecutiveFailures?: number;
  tokenBudgetPerRun?: number;
  costBudgetPerRunUsd?: number;
  sharedMemoryEnabled?: boolean;
  note?: string;
};

export type UpdateAgentSettingsInput = {
  agentId: string;
  name?: string;
  persona?: string;
  characterId?: CharacterId | null;
  status?: "active" | "paused";
  runIntervalSec?: number;
  model?: string;
  tokenBudgetPerRun?: number;
  costBudgetPerRunUsd?: number;
  sharedMemoryEnabled?: boolean;
  pausedReason?: string | null;
};

export type AgentRunRecordInput = {
  id: string;
  agentId: string;
  agentVersion: number;
  requestSummary: unknown;
  response: AgentRunResponse;
};

export type AgentSummary = AgentDefinition & {
  latestRun: {
    status: string;
    startedAt: string;
    finishedAt: string | null;
  } | null;
  proposalCount: number;
  acceptedProposalCount: number;
  rejectedProposalCount: number;
  succeededRunCount: number;
  failedRunCount: number;
};

export type AgentDetail = AgentDefinition & {
  observations: {
    id: string;
    kind: string;
    summary: string;
    evidence: unknown;
    tags: string[];
    createdAt: string;
  }[];
  memories: {
    id: string;
    type: string;
    content: string;
    tags: string[];
    sourceRefs: unknown;
    createdAt: string;
  }[];
  proposals: {
    id: string;
    strategyName: string;
    validationStatus: string;
    rejectionReasons: unknown;
    insertedStrategyRunId: string | null;
    strategyRunStatus: string | null;
    createdAt: string;
  }[];
  reviews: {
    id: string;
    strategyName: string;
    recommendation: string;
    confidence: string;
    reason: string;
    evidence: unknown;
    applied: boolean;
    createdAt: string;
  }[];
  runs: {
    id: string;
    agentVersion: number;
    status: string;
    outputSummary: unknown;
    toolCalls: unknown;
    tokenUsage: unknown;
    error: string | null;
    startedAt: string;
    finishedAt: string | null;
  }[];
  versions: {
    id: string;
    version: number;
    systemPrompt: string;
    allowedTools: AgentDefinition["allowedTools"];
    note: string | null;
    createdAt: string;
  }[];
};

export class AiAgentRepository {
  constructor(private readonly database: AiAgentDatabase = db) {}

  async listAgents(): Promise<AgentDefinition[]> {
    const rows = await this.database.select().from(aiAgents);
    return rows.map(toAgentDefinition);
  }

  async listAgentSummaries(): Promise<AgentSummary[]> {
    const agents = await this.listAgents();

    return Promise.all(
      agents.map(async (agent) => {
        const [latestRun] = await this.database
          .select({
            status: aiAgentRuns.status,
            startedAt: aiAgentRuns.startedAt,
            finishedAt: aiAgentRuns.finishedAt,
          })
          .from(aiAgentRuns)
          .where(eq(aiAgentRuns.agentId, agent.id))
          .orderBy(desc(aiAgentRuns.startedAt))
          .limit(1);
        const [proposalRows, runRows] = await Promise.all([
          this.database
            .select({ validationStatus: aiAgentStrategyProposals.validationStatus })
            .from(aiAgentStrategyProposals)
            .where(eq(aiAgentStrategyProposals.agentId, agent.id)),
          this.database
            .select({ status: aiAgentRuns.status })
            .from(aiAgentRuns)
            .where(eq(aiAgentRuns.agentId, agent.id)),
        ]);

        return {
          ...agent,
          latestRun: latestRun
            ? {
                status: latestRun.status,
                startedAt: latestRun.startedAt.toISOString(),
                finishedAt: latestRun.finishedAt?.toISOString() ?? null,
              }
            : null,
          proposalCount: proposalRows.length,
          acceptedProposalCount: proposalRows.filter(
            (proposal) => proposal.validationStatus === "accepted",
          ).length,
          rejectedProposalCount: proposalRows.filter(
            (proposal) => proposal.validationStatus === "rejected",
          ).length,
          succeededRunCount: runRows.filter((run) => run.status === "succeeded").length,
          failedRunCount: runRows.filter((run) => run.status !== "succeeded").length,
        };
      }),
    );
  }

  async getAgentDetail(agentId: string): Promise<AgentDetail | null> {
    const [agent] = (await this.listAgents()).filter((candidate) => candidate.id === agentId);

    if (!agent) {
      return null;
    }

    const [observations, memories, proposals, reviews, runs, versions] = await Promise.all([
      this.database
        .select({
          id: aiAgentObservations.id,
          kind: aiAgentObservations.kind,
          summary: aiAgentObservations.summary,
          evidence: aiAgentObservations.evidence,
          tags: aiAgentObservations.tags,
          createdAt: aiAgentObservations.createdAt,
        })
        .from(aiAgentObservations)
        .where(eq(aiAgentObservations.agentId, agentId))
        .orderBy(desc(aiAgentObservations.createdAt))
        .limit(20),
      this.database
        .select({
          id: aiAgentMemories.id,
          type: aiAgentMemories.type,
          content: aiAgentMemories.content,
          tags: aiAgentMemories.tags,
          sourceRefs: aiAgentMemories.sourceRefs,
          createdAt: aiAgentMemories.createdAt,
        })
        .from(aiAgentMemories)
        .where(eq(aiAgentMemories.agentId, agentId))
        .orderBy(desc(aiAgentMemories.createdAt))
        .limit(50),
      this.database
        .select({
          id: aiAgentStrategyProposals.id,
          strategyName: aiAgentStrategyProposals.strategyName,
          validationStatus: aiAgentStrategyProposals.validationStatus,
          rejectionReasons: aiAgentStrategyProposals.rejectionReasons,
          insertedStrategyRunId: aiAgentStrategyProposals.insertedStrategyRunId,
          strategyRunStatus: strategyRuns.status,
          createdAt: aiAgentStrategyProposals.createdAt,
        })
        .from(aiAgentStrategyProposals)
        .leftJoin(strategyRuns, eq(strategyRuns.id, aiAgentStrategyProposals.insertedStrategyRunId))
        .where(eq(aiAgentStrategyProposals.agentId, agentId))
        .orderBy(desc(aiAgentStrategyProposals.createdAt))
        .limit(50),
      this.database
        .select({
          id: aiAgentCandidateReviews.id,
          strategyName: aiAgentCandidateReviews.strategyName,
          recommendation: aiAgentCandidateReviews.recommendation,
          confidence: aiAgentCandidateReviews.confidence,
          reason: aiAgentCandidateReviews.reason,
          evidence: aiAgentCandidateReviews.evidence,
          applied: aiAgentCandidateReviews.applied,
          createdAt: aiAgentCandidateReviews.createdAt,
        })
        .from(aiAgentCandidateReviews)
        .where(eq(aiAgentCandidateReviews.agentId, agentId))
        .orderBy(desc(aiAgentCandidateReviews.createdAt))
        .limit(50),
      this.database
        .select({
          id: aiAgentRuns.id,
          agentVersion: aiAgentRuns.agentVersion,
          status: aiAgentRuns.status,
          outputSummary: aiAgentRuns.outputSummary,
          toolCalls: aiAgentRuns.toolCalls,
          tokenUsage: aiAgentRuns.tokenUsage,
          error: aiAgentRuns.error,
          startedAt: aiAgentRuns.startedAt,
          finishedAt: aiAgentRuns.finishedAt,
        })
        .from(aiAgentRuns)
        .where(eq(aiAgentRuns.agentId, agentId))
        .orderBy(desc(aiAgentRuns.startedAt))
        .limit(50),
      this.database
        .select({
          id: aiAgentVersions.id,
          version: aiAgentVersions.version,
          systemPrompt: aiAgentVersions.systemPrompt,
          allowedTools: aiAgentVersions.allowedTools,
          note: aiAgentVersions.note,
          createdAt: aiAgentVersions.createdAt,
        })
        .from(aiAgentVersions)
        .where(eq(aiAgentVersions.agentId, agentId))
        .orderBy(desc(aiAgentVersions.version))
        .limit(50),
    ]);

    return {
      ...agent,
      observations: observations.map((observation) => ({
        ...observation,
        createdAt: observation.createdAt.toISOString(),
      })),
      memories: memories.map((memory) => ({
        ...memory,
        createdAt: memory.createdAt.toISOString(),
      })),
      proposals: proposals.map((proposal) => ({
        ...proposal,
        strategyRunStatus: proposal.strategyRunStatus ?? null,
        createdAt: proposal.createdAt.toISOString(),
      })),
      reviews: reviews.map((review) => ({
        ...review,
        createdAt: review.createdAt.toISOString(),
      })),
      runs: runs.map((run) => ({
        ...run,
        agentVersion: Number(run.agentVersion),
        startedAt: run.startedAt.toISOString(),
        finishedAt: run.finishedAt?.toISOString() ?? null,
      })),
      versions: versions.map((version) => ({
        ...version,
        version: Number(version.version),
        allowedTools: filterAllowedTools(version.allowedTools),
        createdAt: version.createdAt.toISOString(),
      })),
    };
  }

  async seedResearchAgent(): Promise<void> {
    await this.database
      .insert(aiAgents)
      .values([toResearchAgentSeedRow(), toResearchAgent1hSeedRow()])
      .onConflictDoNothing({ target: aiAgents.id });

    await this.database
      .insert(aiAgentVersions)
      .values([
        {
          id: "22222222-2222-4222-8222-222222222222",
          agentId: RESEARCH_AGENT_SEED_ID,
          version: "1",
          systemPrompt: RESEARCH_AGENT_SYSTEM_PROMPT,
          allowedTools: [...AGENT_RESEARCH_TOOL_NAMES],
          note: "Initial Research Agent 01 seed.",
        },
        {
          id: "44444444-4444-4444-8444-444444444444",
          agentId: RESEARCH_AGENT_1H_SEED_ID,
          version: "1",
          systemPrompt: RESEARCH_AGENT_1H_SYSTEM_PROMPT,
          allowedTools: [...AGENT_RESEARCH_TOOL_NAMES],
          note: "Initial Research Agent 1H seed.",
        },
      ])
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

  async createVersionFromVersion(input: {
    agentId: string;
    sourceVersion: number;
    note?: string;
  }): Promise<{ version: number }> {
    const [source] = await this.database
      .select({
        systemPrompt: aiAgentVersions.systemPrompt,
        allowedTools: aiAgentVersions.allowedTools,
      })
      .from(aiAgentVersions)
      .where(
        and(
          eq(aiAgentVersions.agentId, input.agentId),
          eq(aiAgentVersions.version, String(input.sourceVersion)),
        ),
      )
      .limit(1);

    if (!source) {
      throw new Error("Agent version not found.");
    }

    return this.createVersion({
      agentId: input.agentId,
      systemPrompt: source.systemPrompt,
      allowedTools: filterAllowedTools(source.allowedTools),
      note: input.note ?? `Rollback to version ${input.sourceVersion}.`,
    });
  }

  async listProposalRecords(filter: {
    agentId?: string;
    status?: "accepted" | "rejected";
    limit?: number;
    before?: Date;
  }): Promise<
    {
      id: string;
      agentId: string;
      strategyName: string;
      validationStatus: string;
      rejectionReasons: unknown;
      insertedStrategyRunId: string | null;
      strategyRunStatus: string | null;
      createdAt: string;
    }[]
  > {
    const conditions = [] as ReturnType<typeof eq>[];
    if (filter.agentId) conditions.push(eq(aiAgentStrategyProposals.agentId, filter.agentId));
    if (filter.status)
      conditions.push(eq(aiAgentStrategyProposals.validationStatus, filter.status));

    const limit = Math.min(Math.max(filter.limit ?? 50, 1), 200);
    const baseQuery = this.database
      .select({
        id: aiAgentStrategyProposals.id,
        agentId: aiAgentStrategyProposals.agentId,
        strategyName: aiAgentStrategyProposals.strategyName,
        validationStatus: aiAgentStrategyProposals.validationStatus,
        rejectionReasons: aiAgentStrategyProposals.rejectionReasons,
        insertedStrategyRunId: aiAgentStrategyProposals.insertedStrategyRunId,
        strategyRunStatus: strategyRuns.status,
        createdAt: aiAgentStrategyProposals.createdAt,
      })
      .from(aiAgentStrategyProposals)
      .leftJoin(strategyRuns, eq(strategyRuns.id, aiAgentStrategyProposals.insertedStrategyRunId));

    const filtered =
      conditions.length > 0
        ? baseQuery.where(conditions.length === 1 ? conditions[0] : and(...conditions))
        : baseQuery;

    const rows = await filtered.orderBy(desc(aiAgentStrategyProposals.createdAt)).limit(limit);

    return rows.map((row) => ({
      ...row,
      createdAt: row.createdAt.toISOString(),
    }));
  }

  async listRunRecords(filter: {
    agentId?: string;
    status?: "succeeded" | "failed" | "timeout" | "rejected_output";
    limit?: number;
  }): Promise<
    {
      id: string;
      agentId: string;
      agentVersion: number;
      status: string;
      outputSummary: unknown;
      toolCalls: unknown;
      tokenUsage: unknown;
      error: string | null;
      startedAt: string;
      finishedAt: string | null;
    }[]
  > {
    const conditions = [] as ReturnType<typeof eq>[];
    if (filter.agentId) conditions.push(eq(aiAgentRuns.agentId, filter.agentId));
    if (filter.status) conditions.push(eq(aiAgentRuns.status, filter.status));

    const limit = Math.min(Math.max(filter.limit ?? 50, 1), 200);
    const baseQuery = this.database
      .select({
        id: aiAgentRuns.id,
        agentId: aiAgentRuns.agentId,
        agentVersion: aiAgentRuns.agentVersion,
        status: aiAgentRuns.status,
        outputSummary: aiAgentRuns.outputSummary,
        toolCalls: aiAgentRuns.toolCalls,
        tokenUsage: aiAgentRuns.tokenUsage,
        error: aiAgentRuns.error,
        startedAt: aiAgentRuns.startedAt,
        finishedAt: aiAgentRuns.finishedAt,
      })
      .from(aiAgentRuns);

    const filtered =
      conditions.length > 0
        ? baseQuery.where(conditions.length === 1 ? conditions[0] : and(...conditions))
        : baseQuery;

    const rows = await filtered.orderBy(desc(aiAgentRuns.startedAt)).limit(limit);

    return rows.map((row) => ({
      ...row,
      agentVersion: Number(row.agentVersion),
      startedAt: row.startedAt.toISOString(),
      finishedAt: row.finishedAt?.toISOString() ?? null,
    }));
  }

  async createAgent(input: CreateAgentInput): Promise<{ id: string }> {
    return this.database.transaction(async (tx) => {
      const allowedTools = filterAllowedTools(input.allowedTools);
      const rows = await tx
        .insert(aiAgents)
        .values({
          name: input.name,
          persona: input.persona,
          systemPrompt: input.systemPrompt,
          allowedTools,
          status: "active",
          currentVersion: "1",
          runIntervalSec: String(input.runIntervalSec),
          model: input.model,
          maxConsecutiveFailures: String(input.maxConsecutiveFailures ?? 3),
          consecutiveFailures: "0",
          tokenBudgetPerRun: String(input.tokenBudgetPerRun ?? 200000),
          costBudgetPerRunUsd: String(input.costBudgetPerRunUsd ?? 5),
          pausedReason: null,
          sharedMemoryEnabled: input.sharedMemoryEnabled ?? false,
          characterId: input.characterId,
        })
        .returning({ id: aiAgents.id });

      const created = rows[0];

      if (!created) {
        throw new Error("Failed to create agent.");
      }

      await tx.insert(aiAgentVersions).values({
        agentId: created.id,
        version: "1",
        systemPrompt: input.systemPrompt,
        allowedTools,
        note: input.note ?? `Created from character ${input.characterId}.`,
      });

      return { id: created.id };
    });
  }

  async updateAgentSettings(input: UpdateAgentSettingsInput): Promise<{ updated: boolean }> {
    const values: Record<string, unknown> = {
      updatedAt: new Date(),
    };
    if (input.name !== undefined) values.name = input.name;
    if (input.persona !== undefined) values.persona = input.persona;
    if (input.characterId !== undefined) values.characterId = input.characterId;
    if (input.status !== undefined) values.status = input.status;
    if (input.runIntervalSec !== undefined) values.runIntervalSec = String(input.runIntervalSec);
    if (input.model !== undefined) values.model = input.model;
    if (input.tokenBudgetPerRun !== undefined)
      values.tokenBudgetPerRun = String(input.tokenBudgetPerRun);
    if (input.costBudgetPerRunUsd !== undefined)
      values.costBudgetPerRunUsd = String(input.costBudgetPerRunUsd);
    if (input.sharedMemoryEnabled !== undefined)
      values.sharedMemoryEnabled = input.sharedMemoryEnabled;
    if (input.pausedReason !== undefined) values.pausedReason = input.pausedReason;

    const rows = await this.database
      .update(aiAgents)
      .set(values)
      .where(eq(aiAgents.id, input.agentId))
      .returning({ id: aiAgents.id });

    return { updated: rows.length > 0 };
  }

  async deleteMemory(input: { agentId: string; memoryId: string }): Promise<{ deleted: boolean }> {
    const rows = await this.database
      .delete(aiAgentMemories)
      .where(
        and(eq(aiAgentMemories.agentId, input.agentId), eq(aiAgentMemories.id, input.memoryId)),
      )
      .returning({ id: aiAgentMemories.id });

    return { deleted: rows.length > 0 };
  }

  async recordRun(input: AgentRunRecordInput): Promise<void> {
    await this.database.transaction(async (tx) => {
      await tx.insert(aiAgentRuns).values(toAgentRunInsertRow(input));
      await updateFailureState(tx, input.agentId, input.response);

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
    maxConsecutiveFailures: "3",
    consecutiveFailures: "0",
    tokenBudgetPerRun: "200000",
    costBudgetPerRunUsd: "5",
    pausedReason: null,
    sharedMemoryEnabled: true,
    characterId: "ceres" satisfies CharacterId,
  };
}

export function toResearchAgent1hSeedRow() {
  return {
    id: RESEARCH_AGENT_1H_SEED_ID,
    name: "Research Agent 1H",
    persona: "USD/JPY 1h paper strategy researcher",
    systemPrompt: RESEARCH_AGENT_1H_SYSTEM_PROMPT,
    allowedTools: [...AGENT_RESEARCH_TOOL_NAMES],
    status: "active" as const,
    currentVersion: "1",
    runIntervalSec: "14400",
    model: "claude-sonnet-4-5",
    maxConsecutiveFailures: "3",
    consecutiveFailures: "0",
    tokenBudgetPerRun: "200000",
    costBudgetPerRunUsd: "5",
    pausedReason: null,
    sharedMemoryEnabled: true,
    characterId: "iris" satisfies CharacterId,
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

async function updateFailureState(
  tx: AiAgentWriteDatabase,
  agentId: string,
  response: AgentRunResponse,
) {
  if (response.ok) {
    await tx
      .update(aiAgents)
      .set({ consecutiveFailures: "0", pausedReason: null, updatedAt: new Date() })
      .where(eq(aiAgents.id, agentId));
    return;
  }

  const [agent] = await tx
    .select({
      maxConsecutiveFailures: aiAgents.maxConsecutiveFailures,
      consecutiveFailures: aiAgents.consecutiveFailures,
    })
    .from(aiAgents)
    .where(eq(aiAgents.id, agentId))
    .limit(1);

  if (!agent) {
    return;
  }

  const nextFailures = Number(agent.consecutiveFailures) + 1;
  const maxFailures = Number(agent.maxConsecutiveFailures);
  const shouldPause = nextFailures >= maxFailures;
  const updateValues = shouldPause
    ? {
        consecutiveFailures: String(nextFailures),
        status: "paused" as const,
        pausedReason: `Paused after ${nextFailures} consecutive agent failures: ${response.status}`,
        updatedAt: new Date(),
      }
    : {
        consecutiveFailures: String(nextFailures),
        updatedAt: new Date(),
      };

  await tx.update(aiAgents).set(updateValues).where(eq(aiAgents.id, agentId));
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
    maxConsecutiveFailures: Number(row.maxConsecutiveFailures),
    consecutiveFailures: Number(row.consecutiveFailures),
    tokenBudgetPerRun: Number(row.tokenBudgetPerRun),
    costBudgetPerRunUsd: Number(row.costBudgetPerRunUsd),
    pausedReason: row.pausedReason ?? undefined,
    sharedMemoryEnabled: row.sharedMemoryEnabled,
    characterId: isCharacterId(row.characterId) ? row.characterId : null,
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
  "あなたはUSD/JPYのPaper Trading戦略を研究するAI Agentです。",
  "あなたはPaper Order、決済、Baseline Strategy昇格、Candidate Strategy停止を直接実行してはいけません。",
  "あなたの役割は、市場状態、Candidate Strategy成績、過去の失敗理由、自分のmemoryを観察し、Strategy Definition候補、Candidate Review、Observation、Memory WriteをJSONで出力することです。",
  "Strategy Definitionは許可済みDSLだけを使い、Risk Gateを緩和してはいけません。",
].join("\n");

const RESEARCH_AGENT_1H_SYSTEM_PROMPT = [
  "あなたはUSD/JPYの1h timeframeに特化したPaper Trading戦略を研究するAI Agentです。",
  "あなたはPaper Order、決済、Baseline Strategy昇格、Candidate Strategy停止を直接実行してはいけません。",
  "あなたの役割は、1h Canonical Candleの市場状態、Candidate Strategy成績、過去の失敗理由、shared memoryを観察し、Strategy Definition候補、Candidate Review、Observation、Memory WriteをJSONで出力することです。",
  "Strategy Definitionは許可済みDSLだけを使い、Risk Gateを緩和してはいけません。",
].join("\n");
