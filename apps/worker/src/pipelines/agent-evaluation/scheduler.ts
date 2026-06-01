import { randomUUID } from "node:crypto";
import { env } from "@ai-trade/config";
import { AiAgentRepository } from "@ai-trade/db";
import type {
  AgentDefinition,
  AgentRunRequest,
  AgentRunResponse,
} from "@ai-trade/domain/ai-agents";

import type { ServiceHealth, ServiceState, WorkerService } from "../../types.js";

export class AgentRunEnvelopeBuilder {
  build(agent: AgentDefinition): string {
    const timeframe = selectAgentTimeframe(agent);

    return JSON.stringify({
      agent: {
        id: agent.id,
        name: agent.name,
        version: agent.currentVersion,
        timeframe,
        sharedMemoryEnabled: agent.sharedMemoryEnabled,
      },
      requiredInitialToolRequest: {
        name: "get_context_snapshot",
        args: { agentId: agent.id, timeframe },
      },
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
    private readonly runEnvelopeBuilder = new AgentRunEnvelopeBuilder(),
    private readonly outputProcessor = new AgentOutputProcessor(repository),
    private readonly aiRunnerUrl = env.AI_RUNNER_INTERNAL_URL,
  ) {}

  async start(): Promise<void> {
    await this.repository.seedResearchAgent();
    // Auto-seed all 6 crew characters as active agents (idempotent) so the system
    // explores with diversity instead of relying on a single manually created agent.
    await this.repository.seedCrewAgents();
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

    const runEnvelope = this.runEnvelopeBuilder.build(agent);
    // Research-heavy roles (risk auditor / news analyst / skill curator) perform many MCP tool
    // hops and were hitting the 120s ceiling — killed mid-run with zero output. Give them more
    // headroom while keeping traders snappy. Kept under undici's 300s fetch body timeout.
    const isResearchHeavyRole =
      agent.role === "risk_auditor" ||
      agent.role === "news_analyst" ||
      agent.role === "skill_curator";
    const request: AgentRunRequest = {
      agent,
      runEnvelope,
      version: agent.currentVersion,
      maxToolHops: 5,
      timeoutMs: isResearchHeavyRole ? 240_000 : 120_000,
      outputSizeLimitBytes: 128 * 1024,
    };
    const response = await this.callAgentRunner(request);
    await this.outputProcessor.persistRun({
      runId: randomUUID(),
      agent,
      requestSummary: {
        runEnvelopeBytes: Buffer.byteLength(runEnvelope, "utf8"),
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
