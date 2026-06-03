import {
  AGENT_CHARACTERS,
  AGENT_RESEARCH_TOOL_NAMES,
  type AgentDefinition,
  type AgentRole,
  type AgentRunOutput,
  type AgentRunResponse,
  type AgentStrategyProposal,
  type AgentToolCallLog,
  type CharacterId,
  composeSystemPrompt,
  getDefaultRole,
  isAgentRole,
  isCharacterId,
} from "@ai-trade/domain/ai-agents";
import {
  type AgentRoleActivity,
  type AgentScorecard,
  type AgentScorecardMetrics,
  computeAgentScore,
  type SkillCurationAction,
  type SkillCurationCandidate,
} from "@ai-trade/domain/ai-tuning";
import { validateAiStrategyProposal } from "@ai-trade/domain/strategies";
import { and, desc, eq, gte, sql } from "drizzle-orm";

import { db } from "../client.js";
import {
  aiAgentCandidateReviews,
  aiAgentMemories,
  aiAgentObservations,
  aiAgentPromptOptimizations,
  aiAgentRuns,
  aiAgentSkillCurations,
  aiAgentSkills,
  aiAgentStrategyProposals,
  aiAgents,
  aiAgentVersions,
  paperAccounts,
  paperOrders,
  paperPositions,
  paperTrades,
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

/**
 * Fixed UUIDs for the auto-seeded 6-character crew. Stable ids make
 * seedCrewAgents idempotent: a crew agent is only created if its id is absent.
 */
export const CREW_AGENT_SEED_IDS: Record<CharacterId, string> = {
  ceres: "c0000000-0000-4000-8000-000000000001",
  yura: "c0000000-0000-4000-8000-000000000002",
  noah: "c0000000-0000-4000-8000-000000000003",
  iris: "c0000000-0000-4000-8000-000000000004",
  ragna: "c0000000-0000-4000-8000-000000000005",
  chloe: "c0000000-0000-4000-8000-000000000006",
};

/** Paper-money starting balance for each auto-seeded crew agent (JPY). */
export const CREW_AGENT_INITIAL_BALANCE_JPY = "100000";

export type PromptOptimizationStatus = "optimized" | "rolled_back" | "rejected" | "skipped";

export type PromptOptimizationRecordInput = {
  agentId: string;
  status: PromptOptimizationStatus;
  fromVersion: number;
  toVersion?: number | null;
  baselineScore: number;
  observedScore?: number | null;
  scorecard: AgentScorecard;
  reasoning: string;
  promptHash?: string | null;
};

export type PromptOptimizationRecord = {
  id: string;
  agentId: string;
  status: PromptOptimizationStatus;
  fromVersion: number;
  toVersion: number | null;
  baselineScore: number;
  observedScore: number | null;
  scorecard: AgentScorecard;
  reasoning: string;
  promptHash: string | null;
  createdAt: string;
};

/** Audit-log status for a single skill-curation decision. */
export type SkillCurationDecisionStatus = "applied" | "skipped" | "rejected";

export type SkillCurationRecordInput = {
  curatorAgentId: string;
  action: SkillCurationAction;
  status: SkillCurationDecisionStatus;
  skillId: string;
  /** New shared skill id for an applied promotion; null for retire/skip. */
  resultSkillId?: string | null;
  confidence: "low" | "medium" | "high";
  reason: string;
};

export type SkillCurationRecord = {
  id: string;
  curatorAgentId: string;
  action: SkillCurationAction;
  status: SkillCurationDecisionStatus;
  skillId: string;
  resultSkillId: string | null;
  confidence: "low" | "medium" | "high";
  reason: string;
  createdAt: string;
};

/** Outcome of applying a promote decision (idempotent, original preserved). */
export type PromoteSkillResult = {
  status: "promoted" | "skipped";
  resultSkillId: string | null;
  reason?: "not_found" | "already_shared" | "already_promoted";
};

/** Outcome of applying a retire decision (reversible archive, idempotent). */
export type RetireSkillResult = {
  status: "retired" | "skipped";
  reason?: "not_found" | "already_archived";
};

/**
 * Lightweight curator productivity snapshot. The numeric reward (consumed by the
 * optimizer) is intentionally deferred to Phase C role-aware scoring; this is
 * just the raw counts the curator generated over the window.
 */
export type CuratorScorecard = {
  curatorAgentId: string;
  windowDays: number;
  /** Active shared skills across all agents right now (the curated commons). */
  sharedSkillCount: number;
  /** Promote decisions applied within the window. */
  promotionCount: number;
  /** Retire decisions applied within the window. */
  retirementCount: number;
  /** Total curation decisions recorded within the window (any status). */
  decisionCount: number;
};

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
  /** Operational role. Defaults to the character's default role when omitted. */
  role?: AgentRole;
  initialBalanceJpy: number;
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
  observationCount: number;
  candidateReviewCount: number;
  appliedCandidateReviewCount: number;
  skillCurationCount: number;
  appliedSkillCurationCount: number;
  succeededRunCount: number;
  failedRunCount: number;
  paperAccount: AgentPaperAccountSummary | null;
};

export type AgentPaperAccountSummary = {
  accountId: string;
  balanceJpy: number;
  initialBalanceJpy: number;
  pnlJpy: number;
  pnlPct: number;
  openPositionCount: number;
  closedTradeCount: number;
  totalRealizedPnlJpy: number;
};

export type AgentPaperAccountDetail = AgentPaperAccountSummary & {
  openPositions: {
    id: string;
    strategyRunId: string | null;
    symbol: string;
    side: "long" | "short";
    quantity: number;
    entryPrice: number;
    openedAt: string;
    stopLossPrice: number;
    takeProfitPrice: number;
    spreadPips: number;
  }[];
  recentTrades: {
    id: string;
    strategyRunId: string | null;
    symbol: string;
    side: "long" | "short";
    quantity: number;
    entryPrice: number;
    exitPrice: number;
    pnlJpy: number;
    closeReason: string;
    openedAt: string;
    closedAt: string;
  }[];
};

export type AgentDetail = AgentDefinition & {
  paperAccount: AgentPaperAccountDetail | null;
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
  skills: {
    id: string;
    scope: "private" | "shared";
    title: string;
    body: string;
    tags: string[];
    sourceRefs: unknown;
    reason: string;
    status: "draft" | "active" | "archived";
    version: number;
    promotedFromSkillId: string | null;
    createdRunId: string | null;
    createdAt: string;
    updatedAt: string;
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
        const [
          proposalRows,
          observationRows,
          candidateReviewRows,
          skillCurationRows,
          runRows,
          paperAccountRows,
          openPositionRows,
          tradeRows,
        ] = await Promise.all([
          this.database
            .select({ validationStatus: aiAgentStrategyProposals.validationStatus })
            .from(aiAgentStrategyProposals)
            .where(eq(aiAgentStrategyProposals.agentId, agent.id)),
          this.database
            .select({ id: aiAgentObservations.id })
            .from(aiAgentObservations)
            .where(eq(aiAgentObservations.agentId, agent.id)),
          this.database
            .select({ applied: aiAgentCandidateReviews.applied })
            .from(aiAgentCandidateReviews)
            .where(eq(aiAgentCandidateReviews.agentId, agent.id)),
          this.database
            .select({ status: aiAgentSkillCurations.status })
            .from(aiAgentSkillCurations)
            .where(eq(aiAgentSkillCurations.curatorAgentId, agent.id)),
          this.database
            .select({ status: aiAgentRuns.status })
            .from(aiAgentRuns)
            .where(eq(aiAgentRuns.agentId, agent.id)),
          this.database
            .select({
              id: paperAccounts.id,
              balanceJpy: paperAccounts.balanceJpy,
              initialBalanceJpy: paperAccounts.initialBalanceJpy,
            })
            .from(paperAccounts)
            .where(eq(paperAccounts.agentId, agent.id))
            .limit(1),
          this.database
            .select({ id: paperPositions.id })
            .from(paperPositions)
            .innerJoin(paperAccounts, eq(paperAccounts.id, paperPositions.accountId))
            .where(and(eq(paperAccounts.agentId, agent.id), eq(paperPositions.status, "open"))),
          this.database
            .select({ pnlJpy: paperTrades.pnlJpy })
            .from(paperTrades)
            .innerJoin(paperAccounts, eq(paperAccounts.id, paperTrades.accountId))
            .where(eq(paperAccounts.agentId, agent.id)),
        ]);

        const accountRow = paperAccountRows[0];
        const paperAccount: AgentPaperAccountSummary | null = accountRow
          ? {
              accountId: accountRow.id,
              balanceJpy: Number(accountRow.balanceJpy),
              initialBalanceJpy: Number(accountRow.initialBalanceJpy),
              pnlJpy: Number(accountRow.balanceJpy) - Number(accountRow.initialBalanceJpy),
              pnlPct:
                Number(accountRow.initialBalanceJpy) > 0
                  ? ((Number(accountRow.balanceJpy) - Number(accountRow.initialBalanceJpy)) /
                      Number(accountRow.initialBalanceJpy)) *
                    100
                  : 0,
              openPositionCount: openPositionRows.length,
              closedTradeCount: tradeRows.length,
              totalRealizedPnlJpy: tradeRows.reduce((acc, row) => acc + Number(row.pnlJpy), 0),
            }
          : null;

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
          observationCount: observationRows.length,
          candidateReviewCount: candidateReviewRows.length,
          appliedCandidateReviewCount: candidateReviewRows.filter((review) => review.applied)
            .length,
          skillCurationCount: skillCurationRows.length,
          appliedSkillCurationCount: skillCurationRows.filter(
            (curation) => curation.status === "applied",
          ).length,
          succeededRunCount: runRows.filter((run) => run.status === "succeeded").length,
          failedRunCount: runRows.filter((run) => run.status !== "succeeded").length,
          paperAccount,
        };
      }),
    );
  }

  async getAgentDetail(agentId: string): Promise<AgentDetail | null> {
    const [agent] = (await this.listAgents()).filter((candidate) => candidate.id === agentId);

    if (!agent) {
      return null;
    }

    const [observations, memories, skills, proposals, reviews, runs, versions, paperAccount] =
      await Promise.all([
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
            id: aiAgentSkills.id,
            scope: aiAgentSkills.scope,
            title: aiAgentSkills.title,
            body: aiAgentSkills.body,
            tags: aiAgentSkills.tags,
            sourceRefs: aiAgentSkills.sourceRefs,
            reason: aiAgentSkills.reason,
            status: aiAgentSkills.status,
            version: aiAgentSkills.version,
            promotedFromSkillId: aiAgentSkills.promotedFromSkillId,
            createdRunId: aiAgentSkills.createdRunId,
            createdAt: aiAgentSkills.createdAt,
            updatedAt: aiAgentSkills.updatedAt,
          })
          .from(aiAgentSkills)
          .where(eq(aiAgentSkills.agentId, agentId))
          .orderBy(desc(aiAgentSkills.updatedAt))
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
          .leftJoin(
            strategyRuns,
            eq(strategyRuns.id, aiAgentStrategyProposals.insertedStrategyRunId),
          )
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
        this.getAgentPaperAccount(agentId),
      ]);

    return {
      ...agent,
      paperAccount,
      observations: observations.map((observation) => ({
        ...observation,
        createdAt: observation.createdAt.toISOString(),
      })),
      memories: memories.map((memory) => ({
        ...memory,
        createdAt: memory.createdAt.toISOString(),
      })),
      skills: skills.map((skill) => ({
        ...skill,
        version: Number(skill.version),
        createdAt: skill.createdAt.toISOString(),
        updatedAt: skill.updatedAt.toISOString(),
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
    // The legacy Research Agent 01 / 1H seed has been retired. Agents are created
    // through the character picker UI; nothing is auto-seeded here.
  }

  /**
   * Idempotently create all 6 crew characters as active agents, each with its own
   * paper account. Guarded by the fixed crew UUIDs: an agent is only created when
   * its seed id is absent, so this is safe to call on every scheduler start.
   */
  async seedCrewAgents(): Promise<{ created: CharacterId[] }> {
    const created: CharacterId[] = [];

    for (const character of AGENT_CHARACTERS) {
      const seedId = CREW_AGENT_SEED_IDS[character.id];
      const [existing] = await this.database
        .select({ id: aiAgents.id })
        .from(aiAgents)
        .where(eq(aiAgents.id, seedId))
        .limit(1);

      if (existing) {
        continue;
      }

      const allowedTools = filterAllowedTools(character.defaultAllowedTools);
      // Append the role-specific directive after persona + guardrail so the
      // seeded prompt already reflects the agent's specialisation.
      const systemPrompt = composeSystemPrompt(
        character.defaultSystemPrompt,
        character.defaultRole,
      );

      await this.database.transaction(async (tx) => {
        await tx.insert(aiAgents).values({
          id: seedId,
          name: character.name,
          persona: character.defaultPersona,
          systemPrompt,
          allowedTools,
          status: "active",
          currentVersion: "1",
          runIntervalSec: String(character.defaultRunIntervalSec),
          model: character.defaultModel,
          maxConsecutiveFailures: "3",
          consecutiveFailures: "0",
          tokenBudgetPerRun: "200000",
          costBudgetPerRunUsd: "5",
          pausedReason: null,
          sharedMemoryEnabled: true,
          characterId: character.id,
          role: character.defaultRole,
          initialBalanceJpy: CREW_AGENT_INITIAL_BALANCE_JPY,
        });

        await tx.insert(aiAgentVersions).values({
          agentId: seedId,
          version: "1",
          systemPrompt,
          allowedTools,
          note: `Seeded crew agent ${character.id}.`,
        });

        await tx.insert(paperAccounts).values({
          agentId: seedId,
          name: `${character.name} paper account`,
          currency: "JPY",
          initialBalanceJpy: CREW_AGENT_INITIAL_BALANCE_JPY,
          balanceJpy: CREW_AGENT_INITIAL_BALANCE_JPY,
          leverage: "1.00",
          status: "active",
        });
      });

      created.push(character.id);
    }

    return { created };
  }

  async deleteAgent(input: { agentId: string }): Promise<{ deleted: boolean }> {
    return this.database.transaction(async (tx) => {
      const accountRows = await tx
        .select({ id: paperAccounts.id })
        .from(paperAccounts)
        .where(eq(paperAccounts.agentId, input.agentId));
      const accountIds = accountRows.map((row) => row.id);

      if (accountIds.length > 0) {
        for (const accountId of accountIds) {
          await tx.delete(paperTrades).where(eq(paperTrades.accountId, accountId));
          await tx.delete(paperOrders).where(eq(paperOrders.accountId, accountId));
          await tx.delete(paperPositions).where(eq(paperPositions.accountId, accountId));
        }

        await tx.delete(paperAccounts).where(eq(paperAccounts.agentId, input.agentId));
      }

      await tx
        .update(strategyRuns)
        .set({ sourceAgentId: null })
        .where(eq(strategyRuns.sourceAgentId, input.agentId));

      await tx
        .delete(aiAgentCandidateReviews)
        .where(eq(aiAgentCandidateReviews.agentId, input.agentId));
      await tx
        .delete(aiAgentStrategyProposals)
        .where(eq(aiAgentStrategyProposals.agentId, input.agentId));
      await tx.delete(aiAgentObservations).where(eq(aiAgentObservations.agentId, input.agentId));
      await tx.delete(aiAgentSkills).where(eq(aiAgentSkills.agentId, input.agentId));
      await tx.delete(aiAgentMemories).where(eq(aiAgentMemories.agentId, input.agentId));
      await tx.delete(aiAgentRuns).where(eq(aiAgentRuns.agentId, input.agentId));
      await tx.delete(aiAgentVersions).where(eq(aiAgentVersions.agentId, input.agentId));

      const removed = await tx
        .delete(aiAgents)
        .where(eq(aiAgents.id, input.agentId))
        .returning({ id: aiAgents.id });

      return { deleted: removed.length > 0 };
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
    if (!Number.isFinite(input.initialBalanceJpy) || input.initialBalanceJpy <= 0) {
      throw new RangeError("initialBalanceJpy must be a positive finite number");
    }

    return this.database.transaction(async (tx) => {
      const allowedTools = filterAllowedTools(input.allowedTools);
      const balanceString = input.initialBalanceJpy.toFixed(6);
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
          role: input.role ?? getDefaultRole(input.characterId),
          initialBalanceJpy: balanceString,
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

      await tx.insert(paperAccounts).values({
        agentId: created.id,
        name: `${input.name} paper account`,
        currency: "JPY",
        initialBalanceJpy: balanceString,
        balanceJpy: balanceString,
        leverage: "1.00",
        status: "active",
      });

      return { id: created.id };
    });
  }

  async getAgentPaperAccount(agentId: string): Promise<AgentPaperAccountDetail | null> {
    const [account] = await this.database
      .select({
        id: paperAccounts.id,
        balanceJpy: paperAccounts.balanceJpy,
        initialBalanceJpy: paperAccounts.initialBalanceJpy,
      })
      .from(paperAccounts)
      .where(eq(paperAccounts.agentId, agentId))
      .limit(1);

    if (!account) {
      return null;
    }

    const [openPositions, recentTrades] = await Promise.all([
      this.database
        .select({
          id: paperPositions.id,
          strategyRunId: paperPositions.strategyRunId,
          symbol: paperPositions.symbol,
          side: paperPositions.side,
          quantity: paperPositions.quantity,
          entryPrice: paperPositions.entryPrice,
          openedAt: paperPositions.openedAt,
          stopLossPrice: paperPositions.stopLossPrice,
          takeProfitPrice: paperPositions.takeProfitPrice,
          spreadPips: paperPositions.spreadPips,
        })
        .from(paperPositions)
        .where(and(eq(paperPositions.accountId, account.id), eq(paperPositions.status, "open")))
        .orderBy(desc(paperPositions.openedAt))
        .limit(20),
      this.database
        .select({
          id: paperTrades.id,
          strategyRunId: paperTrades.strategyRunId,
          symbol: paperTrades.symbol,
          side: paperTrades.side,
          quantity: paperTrades.quantity,
          entryPrice: paperTrades.entryPrice,
          exitPrice: paperTrades.exitPrice,
          pnlJpy: paperTrades.pnlJpy,
          closeReason: paperTrades.closeReason,
          openedAt: paperTrades.openedAt,
          closedAt: paperTrades.closedAt,
        })
        .from(paperTrades)
        .where(eq(paperTrades.accountId, account.id))
        .orderBy(desc(paperTrades.closedAt))
        .limit(20),
    ]);

    const totalRealizedPnl = recentTrades.reduce((acc, trade) => acc + Number(trade.pnlJpy), 0);
    const balance = Number(account.balanceJpy);
    const initial = Number(account.initialBalanceJpy);
    const pnl = balance - initial;
    const pnlPct = initial > 0 ? (pnl / initial) * 100 : 0;

    return {
      accountId: account.id,
      balanceJpy: balance,
      initialBalanceJpy: initial,
      pnlJpy: pnl,
      pnlPct,
      openPositionCount: openPositions.length,
      closedTradeCount: recentTrades.length,
      totalRealizedPnlJpy: totalRealizedPnl,
      openPositions: openPositions.map((position) => ({
        id: position.id,
        strategyRunId: position.strategyRunId,
        symbol: position.symbol,
        side: position.side,
        quantity: Number(position.quantity),
        entryPrice: Number(position.entryPrice),
        openedAt: position.openedAt.toISOString(),
        stopLossPrice: Number(position.stopLossPrice),
        takeProfitPrice: Number(position.takeProfitPrice),
        spreadPips: Number(position.spreadPips),
      })),
      recentTrades: recentTrades.map((trade) => ({
        id: trade.id,
        strategyRunId: trade.strategyRunId,
        symbol: trade.symbol,
        side: trade.side,
        quantity: Number(trade.quantity),
        entryPrice: Number(trade.entryPrice),
        exitPrice: Number(trade.exitPrice),
        pnlJpy: Number(trade.pnlJpy),
        closeReason: trade.closeReason,
        openedAt: trade.openedAt.toISOString(),
        closedAt: trade.closedAt.toISOString(),
      })),
    };
  }

  /**
   * Realized-PnL-centric scorecard for a single agent over a recent window. Used
   * as the reward signal for prompt optimization. Proposal/adoption counts and
   * realized PnL come from the window; net account PnL is lifetime (secondary).
   */
  async getAgentScorecard(
    agentId: string,
    windowDays: number,
    role: AgentRole = "trader",
  ): Promise<AgentScorecard> {
    const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);

    const [proposalRows, adoptedRows, tradeRows, accountRows, observationRows, reviewRows] =
      await Promise.all([
        this.database
          .select({ validationStatus: aiAgentStrategyProposals.validationStatus })
          .from(aiAgentStrategyProposals)
          .where(
            and(
              eq(aiAgentStrategyProposals.agentId, agentId),
              gte(aiAgentStrategyProposals.createdAt, since),
            ),
          ),
        this.database
          .select({ status: strategyRuns.status })
          .from(strategyRuns)
          .where(and(eq(strategyRuns.sourceAgentId, agentId), gte(strategyRuns.startedAt, since))),
        this.database
          .select({ pnlJpy: paperTrades.pnlJpy })
          .from(paperTrades)
          .innerJoin(paperAccounts, eq(paperAccounts.id, paperTrades.accountId))
          .where(and(eq(paperAccounts.agentId, agentId), gte(paperTrades.closedAt, since))),
        this.database
          .select({
            balanceJpy: paperAccounts.balanceJpy,
            initialBalanceJpy: paperAccounts.initialBalanceJpy,
          })
          .from(paperAccounts)
          .where(eq(paperAccounts.agentId, agentId))
          .limit(1),
        this.database
          .select({ id: aiAgentObservations.id })
          .from(aiAgentObservations)
          .where(
            and(
              eq(aiAgentObservations.agentId, agentId),
              gte(aiAgentObservations.createdAt, since),
            ),
          ),
        this.database
          .select({ applied: aiAgentCandidateReviews.applied })
          .from(aiAgentCandidateReviews)
          .where(
            and(
              eq(aiAgentCandidateReviews.agentId, agentId),
              gte(aiAgentCandidateReviews.createdAt, since),
            ),
          ),
      ]);

    const proposalCount = proposalRows.length;
    const acceptedProposalCount = proposalRows.filter(
      (row) => row.validationStatus === "accepted",
    ).length;
    const adoptedStrategyCount = adoptedRows.filter(
      (row) => row.status === "running_paper" || row.status === "promoted_to_baseline",
    ).length;
    const tradeCount = tradeRows.length;
    const realizedPnlJpy = tradeRows.reduce((acc, row) => acc + Number(row.pnlJpy), 0);
    const account = accountRows[0];
    const netAccountPnlJpy = account
      ? Number(account.balanceJpy) - Number(account.initialBalanceJpy)
      : 0;

    // Curator stewardship counts are only needed (and only meaningful) for the
    // skill_curator role, so the extra queries are skipped for everyone else.
    const curator =
      role === "skill_curator" ? await this.getCuratorScorecard(agentId, windowDays) : null;

    const roleActivity: AgentRoleActivity = {
      observationCount: observationRows.length,
      candidateReviewCount: reviewRows.length,
      appliedReviewCount: reviewRows.filter((row) => row.applied).length,
      curationDecisionCount: curator?.decisionCount ?? 0,
      curationAppliedCount: curator ? curator.promotionCount + curator.retirementCount : 0,
      sharedSkillCount: curator?.sharedSkillCount ?? 0,
    };

    const metrics: AgentScorecardMetrics = {
      agentId,
      windowDays,
      role,
      proposalCount,
      acceptedProposalCount,
      adoptedStrategyCount,
      tradeCount,
      realizedPnlJpy,
      netAccountPnlJpy,
      roleActivity,
    };

    return computeAgentScore(metrics);
  }

  /** Record one prompt-optimization decision (optimized / rolled_back / rejected / skipped). */
  async recordPromptOptimization(
    input: PromptOptimizationRecordInput,
  ): Promise<PromptOptimizationRecord> {
    const [row] = await this.database
      .insert(aiAgentPromptOptimizations)
      .values({
        agentId: input.agentId,
        status: input.status,
        fromVersion: String(input.fromVersion),
        toVersion: input.toVersion == null ? null : String(input.toVersion),
        baselineScore: input.baselineScore.toFixed(6),
        observedScore: input.observedScore == null ? null : input.observedScore.toFixed(6),
        scorecard: input.scorecard,
        reasoning: input.reasoning,
        promptHash: input.promptHash ?? null,
      })
      .returning();

    if (!row) {
      throw new Error("Failed to record prompt optimization.");
    }

    return toPromptOptimizationRecord(row);
  }

  /** Latest prompt-optimization decision for an agent (used to detect a pending trial / rollback). */
  async getLatestPromptOptimization(agentId: string): Promise<PromptOptimizationRecord | null> {
    const [row] = await this.database
      .select()
      .from(aiAgentPromptOptimizations)
      .where(eq(aiAgentPromptOptimizations.agentId, agentId))
      .orderBy(desc(aiAgentPromptOptimizations.createdAt))
      .limit(1);

    return row ? toPromptOptimizationRecord(row) : null;
  }

  /**
   * Cross-agent set of active skills offered to the curator for triage. Private
   * skills are promote candidates; shared skills are retire candidates. Bodies
   * are truncated so the prompt stays bounded, and rows are ordered oldest-first
   * so stale shared skills surface within the cap. The host owns these ids — the
   * curator may only reference ids returned here.
   */
  async listCurationCandidates(
    options: { limit?: number } = {},
  ): Promise<SkillCurationCandidate[]> {
    const limit = options.limit ?? CURATION_CANDIDATE_DEFAULT_LIMIT;
    const rows = await this.database
      .select({
        skillId: aiAgentSkills.id,
        agentId: aiAgentSkills.agentId,
        agentName: aiAgents.name,
        scope: aiAgentSkills.scope,
        status: aiAgentSkills.status,
        title: aiAgentSkills.title,
        body: aiAgentSkills.body,
        tags: aiAgentSkills.tags,
        reason: aiAgentSkills.reason,
        createdAt: aiAgentSkills.createdAt,
      })
      .from(aiAgentSkills)
      .innerJoin(aiAgents, eq(aiAgents.id, aiAgentSkills.agentId))
      .where(eq(aiAgentSkills.status, "active"))
      .orderBy(aiAgentSkills.createdAt)
      .limit(limit);

    const now = Date.now();
    return rows.map((row) => ({
      skillId: row.skillId,
      agentId: row.agentId,
      agentName: row.agentName,
      scope: row.scope,
      status: row.status,
      title: row.title,
      tags: row.tags,
      reason: row.reason,
      bodyPreview: truncateSkillBody(row.body),
      createdAt: row.createdAt.toISOString(),
      ageDays: Math.max(0, Math.floor((now - row.createdAt.getTime()) / DAY_MS)),
    }));
  }

  /**
   * Promote a private skill to the shared commons by creating a NEW shared copy
   * (scope=shared, status=active) linked to the source via promotedFromSkillId.
   * The original is left untouched, so the action is reversible. Idempotent: a
   * repeat call is a no-op once a shared copy exists or the skill is already
   * shared. Runs in a transaction so the existence check and insert are atomic.
   */
  async promoteSkill(skillId: string): Promise<PromoteSkillResult> {
    return this.database.transaction(async (tx) => {
      const [source] = await tx
        .select()
        .from(aiAgentSkills)
        .where(eq(aiAgentSkills.id, skillId))
        .limit(1);

      if (!source) {
        return { status: "skipped", resultSkillId: null, reason: "not_found" };
      }

      if (source.scope === "shared") {
        return { status: "skipped", resultSkillId: source.id, reason: "already_shared" };
      }

      const [existingCopy] = await tx
        .select({ id: aiAgentSkills.id })
        .from(aiAgentSkills)
        .where(eq(aiAgentSkills.promotedFromSkillId, skillId))
        .limit(1);

      if (existingCopy) {
        return { status: "skipped", resultSkillId: existingCopy.id, reason: "already_promoted" };
      }

      const [copy] = await tx
        .insert(aiAgentSkills)
        .values({
          agentId: source.agentId,
          scope: "shared",
          title: source.title,
          body: source.body,
          tags: source.tags,
          sourceRefs: source.sourceRefs,
          reason: source.reason,
          status: "active",
          promotedFromSkillId: source.id,
        })
        .returning({ id: aiAgentSkills.id });

      if (!copy) {
        throw new Error("Failed to promote skill.");
      }

      return { status: "promoted", resultSkillId: copy.id };
    });
  }

  /**
   * Retire a skill by archiving it (status -> archived). Reversible: the row is
   * kept and can be reactivated later. Idempotent and safe on a missing or
   * already-archived skill.
   */
  async retireSkill(skillId: string): Promise<RetireSkillResult> {
    const [current] = await this.database
      .select({ status: aiAgentSkills.status })
      .from(aiAgentSkills)
      .where(eq(aiAgentSkills.id, skillId))
      .limit(1);

    if (!current) {
      return { status: "skipped", reason: "not_found" };
    }

    if (current.status === "archived") {
      return { status: "skipped", reason: "already_archived" };
    }

    await this.database
      .update(aiAgentSkills)
      .set({ status: "archived", updatedAt: new Date() })
      .where(eq(aiAgentSkills.id, skillId));

    return { status: "retired" };
  }

  /** Record one applied/skipped/rejected curation decision in the audit log. */
  async recordSkillCuration(input: SkillCurationRecordInput): Promise<SkillCurationRecord> {
    const [row] = await this.database
      .insert(aiAgentSkillCurations)
      .values({
        curatorAgentId: input.curatorAgentId,
        action: input.action,
        status: input.status,
        skillId: input.skillId,
        resultSkillId: input.resultSkillId ?? null,
        confidence: input.confidence,
        reason: input.reason,
      })
      .returning();

    if (!row) {
      throw new Error("Failed to record skill curation.");
    }

    return toSkillCurationRecord(row);
  }

  /**
   * Raw curator productivity over a recent window. The numeric reward is left to
   * Phase C role-aware scoring; this returns the underlying counts only.
   */
  async getCuratorScorecard(curatorAgentId: string, windowDays: number): Promise<CuratorScorecard> {
    const since = new Date(Date.now() - windowDays * DAY_MS);

    const [sharedRows, curationRows] = await Promise.all([
      this.database
        .select({ id: aiAgentSkills.id })
        .from(aiAgentSkills)
        .where(and(eq(aiAgentSkills.scope, "shared"), eq(aiAgentSkills.status, "active"))),
      this.database
        .select({
          action: aiAgentSkillCurations.action,
          status: aiAgentSkillCurations.status,
        })
        .from(aiAgentSkillCurations)
        .where(
          and(
            eq(aiAgentSkillCurations.curatorAgentId, curatorAgentId),
            gte(aiAgentSkillCurations.createdAt, since),
          ),
        ),
    ]);

    const applied = curationRows.filter((row) => row.status === "applied");

    return {
      curatorAgentId,
      windowDays,
      sharedSkillCount: sharedRows.length,
      promotionCount: applied.filter((row) => row.action === "promote").length,
      retirementCount: applied.filter((row) => row.action === "retire").length,
      decisionCount: curationRows.length,
    };
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

export const RESEARCH_AGENT_DEFAULT_BALANCE_JPY = "100000";

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
    initialBalanceJpy: RESEARCH_AGENT_DEFAULT_BALANCE_JPY,
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
    initialBalanceJpy: RESEARCH_AGENT_DEFAULT_BALANCE_JPY,
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
  const skillWriteIntents = output.skillWriteIntents ?? [];
  return {
    observations: output.observations.length,
    strategyProposals: output.strategyProposals.length,
    candidateReviews: output.candidateReviews.length,
    memoryWrites: output.memoryWrites.length,
    skillWriteIntents: skillWriteIntents.length,
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

  const skillWriteIntents = output.skillWriteIntents ?? [];

  if (skillWriteIntents.length > 0) {
    await tx.insert(aiAgentSkills).values(
      skillWriteIntents.map((skill) => ({
        agentId,
        scope: "private" as const,
        title: skill.title,
        body: skill.body,
        tags: skill.tags,
        sourceRefs: skill.sourceRefs,
        reason:
          skill.desiredScope === "shared"
            ? `${skill.reason}\n\n共有候補: FB Agentの昇格レビュー待ち。`
            : skill.reason,
        status: "active" as const,
        createdRunId: runId,
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
    role: isAgentRole(row.role) ? row.role : "trader",
    initialBalanceJpy: Number(row.initialBalanceJpy),
  };
}

function toPromptOptimizationRecord(
  row: typeof aiAgentPromptOptimizations.$inferSelect,
): PromptOptimizationRecord {
  return {
    id: row.id,
    agentId: row.agentId,
    status: row.status,
    fromVersion: Number(row.fromVersion),
    toVersion: row.toVersion == null ? null : Number(row.toVersion),
    baselineScore: Number(row.baselineScore),
    observedScore: row.observedScore == null ? null : Number(row.observedScore),
    scorecard: row.scorecard as AgentScorecard,
    reasoning: row.reasoning,
    promptHash: row.promptHash ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

const DAY_MS = 24 * 60 * 60 * 1000;
/** Upper bound on candidates handed to the curator, to keep the prompt bounded. */
const CURATION_CANDIDATE_DEFAULT_LIMIT = 100;
/** Max characters of a skill body shown to the curator as a preview. */
const SKILL_BODY_PREVIEW_MAX_CHARS = 280;

function truncateSkillBody(body: string): string {
  if (body.length <= SKILL_BODY_PREVIEW_MAX_CHARS) {
    return body;
  }
  return `${body.slice(0, SKILL_BODY_PREVIEW_MAX_CHARS)}…`;
}

function toSkillCurationRecord(
  row: typeof aiAgentSkillCurations.$inferSelect,
): SkillCurationRecord {
  return {
    id: row.id,
    curatorAgentId: row.curatorAgentId,
    action: row.action,
    status: row.status,
    skillId: row.skillId,
    resultSkillId: row.resultSkillId ?? null,
    confidence: row.confidence,
    reason: row.reason,
    createdAt: row.createdAt.toISOString(),
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
