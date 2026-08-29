import { randomUUID } from "node:crypto";
import { env } from "@ai-trade/config";
import {
  AiAgentRepository,
  aiAgentMemories,
  aiDailyReviews,
  aiTuningProposals,
  CandleRepository,
  db,
  paperAccounts,
  paperTrades,
  strategyRuns,
} from "@ai-trade/db";
import type {
  AgentDefinition,
  AgentRunRequest,
  AgentRunResponse,
} from "@ai-trade/domain/ai-agents";
import { and, desc, eq, sql } from "drizzle-orm";

import type { ServiceHealth, ServiceState, WorkerService } from "../types.js";

export class AgentContextBuilder {
  constructor(private readonly candleReader = new CandleRepository()) {}

  async build(agent: AgentDefinition): Promise<string> {
    const timeframe = selectAgentTimeframe(agent);
    const [candles, candidates, rejections, reviews, accounts, sharedMemories] = await Promise.all([
      this.candleReader.getRecent({
        symbol: "USD_JPY",
        timeframe,
        priceType: "mid",
        limit: 20,
      }),
      db
        .select({
          strategyName: strategyRuns.strategyName,
          status: strategyRuns.status,
          timeframe: strategyRuns.timeframe,
          sourceAgentId: strategyRuns.sourceAgentId,
          sourceProposalId: strategyRuns.sourceProposalId,
          startedAt: strategyRuns.startedAt,
        })
        .from(strategyRuns)
        .orderBy(desc(strategyRuns.startedAt))
        .limit(20),
      db
        .select({
          candidateStrategyName: aiTuningProposals.candidateStrategyName,
          sourceStrategyName: aiTuningProposals.sourceStrategyName,
          rejectReasons: aiTuningProposals.rejectReasons,
          createdAt: aiTuningProposals.createdAt,
        })
        .from(aiTuningProposals)
        .where(eq(aiTuningProposals.status, "rejected"))
        .orderBy(desc(aiTuningProposals.createdAt))
        .limit(10),
      db
        .select({
          reviewDate: aiDailyReviews.reviewDate,
          summary: aiDailyReviews.summary,
          warnings: aiDailyReviews.warnings,
          createdAt: aiDailyReviews.createdAt,
        })
        .from(aiDailyReviews)
        .orderBy(desc(aiDailyReviews.createdAt))
        .limit(3),
      db
        .select({
          name: paperAccounts.name,
          balanceJpy: paperAccounts.balanceJpy,
          initialBalanceJpy: paperAccounts.initialBalanceJpy,
          status: paperAccounts.status,
          updatedAt: paperAccounts.updatedAt,
        })
        .from(paperAccounts)
        .orderBy(desc(paperAccounts.updatedAt))
        .limit(10),
      agent.sharedMemoryEnabled
        ? db
            .select({
              id: aiAgentMemories.id,
              agentId: aiAgentMemories.agentId,
              type: aiAgentMemories.type,
              content: aiAgentMemories.content,
              tags: aiAgentMemories.tags,
              sourceRefs: aiAgentMemories.sourceRefs,
              createdAt: aiAgentMemories.createdAt,
            })
            .from(aiAgentMemories)
            .where(
              and(
                sql`${aiAgentMemories.tags} @> ARRAY['shared_memory']::text[]`,
                sql`${aiAgentMemories.agentId} <> ${agent.id}`,
              ),
            )
            .orderBy(desc(aiAgentMemories.createdAt))
            .limit(10)
        : Promise.resolve([]),
    ]);
    const latestTrades = await db
      .select({
        symbol: paperTrades.symbol,
        side: paperTrades.side,
        pnlJpy: paperTrades.pnlJpy,
        closedAt: paperTrades.closedAt,
      })
      .from(paperTrades)
      .orderBy(desc(paperTrades.closedAt))
      .limit(20);

    return JSON.stringify({
      agent: {
        id: agent.id,
        name: agent.name,
        version: agent.currentVersion,
        timeframe,
        sharedMemoryEnabled: agent.sharedMemoryEnabled,
      },
      market: {
        latestCandleOpenedAt: candles.at(0)?.openedAt.toISOString() ?? null,
        candleCount: candles.length,
        recentCloses: candles.map((candle) => ({
          openedAt: candle.openedAt.toISOString(),
          close: candle.close,
        })),
      },
      paperAccounts: accounts.map((account) => ({
        ...account,
        updatedAt: account.updatedAt.toISOString(),
      })),
      latestTrades: latestTrades.map((trade) => ({
        ...trade,
        closedAt: trade.closedAt.toISOString(),
      })),
      candidates: candidates.map((candidate) => ({
        ...candidate,
        startedAt: candidate.startedAt.toISOString(),
      })),
      rejectionHistory: rejections.map((rejection) => ({
        ...rejection,
        createdAt: rejection.createdAt.toISOString(),
      })),
      dailyReviews: reviews.map((review) => ({
        ...review,
        createdAt: review.createdAt.toISOString(),
      })),
      sharedMemoryShelf: sharedMemories.map((memory) => ({
        ...memory,
        createdAt: memory.createdAt.toISOString(),
      })),
    });
  }
}

export class AgentOutputProcessor {
  constructor(private readonly repository = new AiAgentRepository()) {}

  async persistRun(input: {
    runId: string;
    agent: AgentDefinition;
    requestSummary: unknown;
    response: AgentRunResponse;
  }): Promise<void> {
    await this.repository.recordRun({
      id: input.runId,
      agentId: input.agent.id,
      agentVersion: input.agent.currentVersion,
      requestSummary: input.requestSummary,
      response: input.response,
    });
  }
}

export class AgentScheduler implements WorkerService {
  readonly name = "agent-scheduler";
  private state: ServiceState = "stopped";
  private latestResult: AgentRunResponse | null = null;

  constructor(
    private readonly repository = new AiAgentRepository(),
    private readonly contextBuilder = new AgentContextBuilder(),
    private readonly outputProcessor = new AgentOutputProcessor(repository),
    private readonly aiRunnerUrl = env.AI_RUNNER_INTERNAL_URL,
  ) {}

  async start(): Promise<void> {
    await this.repository.seedResearchAgent();
    this.state = "ready";
  }

  async stop(): Promise<void> {
    this.state = "stopped";
  }

  async health(): Promise<ServiceHealth> {
    return {
      name: this.name,
      state: this.state,
      details: {
        latestResult: this.latestResult
          ? { status: this.latestResult.status, finishedAt: this.latestResult.finishedAt }
          : null,
      },
    };
  }

  async listAgents(): Promise<AgentDefinition[]> {
    await this.repository.seedResearchAgent();
    return this.repository.listAgents();
  }

  async listAgentSummaries() {
    await this.repository.seedResearchAgent();
    return this.repository.listAgentSummaries();
  }

  async getAgentDetail(agentId: string) {
    await this.repository.seedResearchAgent();
    return this.repository.getAgentDetail(agentId);
  }

  async createVersion(input: {
    agentId: string;
    systemPrompt: string;
    allowedTools: string[];
    note?: string;
  }): Promise<{ version: number }> {
    await this.repository.seedResearchAgent();
    return this.repository.createVersion(input);
  }

  async createAgent(input: Parameters<AiAgentRepository["createAgent"]>[0]) {
    await this.repository.seedResearchAgent();
    return this.repository.createAgent(input);
  }

  async deleteAgent(input: Parameters<AiAgentRepository["deleteAgent"]>[0]) {
    return this.repository.deleteAgent(input);
  }

  async updateAgentSettings(input: Parameters<AiAgentRepository["updateAgentSettings"]>[0]) {
    await this.repository.seedResearchAgent();
    return this.repository.updateAgentSettings(input);
  }

  async listProposals(filter: Parameters<AiAgentRepository["listProposalRecords"]>[0]) {
    await this.repository.seedResearchAgent();
    return this.repository.listProposalRecords(filter);
  }

  async listRuns(filter: Parameters<AiAgentRepository["listRunRecords"]>[0]) {
    await this.repository.seedResearchAgent();
    return this.repository.listRunRecords(filter);
  }

  async rollbackVersion(input: { agentId: string; sourceVersion: number; note?: string }) {
    await this.repository.seedResearchAgent();
    return this.repository.createVersionFromVersion(input);
  }

  async deleteMemory(input: { agentId: string; memoryId: string }) {
    await this.repository.seedResearchAgent();
    return this.repository.deleteMemory(input);
  }

  async runOnce(agentId?: string): Promise<AgentRunResponse> {
    const agents = await this.listAgents();
    const agent =
      agentId !== undefined
        ? agents.find((candidate) => candidate.id === agentId)
        : agents.find((candidate) => candidate.status === "active");

    if (!agent) {
      throw new Error("No runnable AI Agent was found.");
    }

    const contextSummary = await this.contextBuilder.build(agent);
    const request: AgentRunRequest = {
      agent,
      contextSummary,
      version: agent.currentVersion,
      maxToolHops: 5,
      timeoutMs: 120_000,
      outputSizeLimitBytes: 128 * 1024,
    };
    const response = await this.callAgentRunner(request);
    await this.outputProcessor.persistRun({
      runId: randomUUID(),
      agent,
      requestSummary: {
        contextSummaryBytes: Buffer.byteLength(contextSummary, "utf8"),
        allowedTools: agent.allowedTools,
      },
      response,
    });
    this.latestResult = response;
    return response;
  }

  async runAll(): Promise<AgentRunResponse[]> {
    const agents = (await this.listAgents()).filter((agent) => agent.status === "active");
    const results: AgentRunResponse[] = [];

    for (const agent of agents) {
      results.push(await this.runOnce(agent.id));
    }

    return results;
  }

  private async callAgentRunner(request: AgentRunRequest): Promise<AgentRunResponse> {
    const response = await fetch(new URL("/agent-runs", this.aiRunnerUrl), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
    });
    const body = (await response.json()) as AgentRunResponse;

    if (!response.ok && body.status === undefined) {
      throw new Error("AI runner agent endpoint failed.");
    }

    return body;
  }
}

function selectAgentTimeframe(agent: AgentDefinition): "1m" | "1h" {
  const profile = `${agent.name} ${agent.persona} ${agent.systemPrompt}`.toLowerCase();
  return profile.includes("1h") || profile.includes("1 hour") ? "1h" : "1m";
}
