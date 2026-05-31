import { randomUUID } from "node:crypto";

import { env } from "@ai-trade/config";
import {
  AiAgentRepository,
  type AiInvocationRecordInput,
  AiTuningRepository,
  type PromoteSkillResult,
  type RetireSkillResult,
  type SkillCurationRecord,
  type SkillCurationRecordInput,
} from "@ai-trade/db";
import {
  type AiSkillCurationResponse,
  type SkillCurationCandidate,
  type SkillCurationInput,
  validateSkillCuration,
} from "@ai-trade/domain/ai-tuning";

import type { ServiceHealth, ServiceState, WorkerService } from "../types.js";

/**
 * Per-curator outcome of one curation pass. `applied` means at least one
 * decision ran; the remaining values are no-op exits.
 */
export type SkillCuratorAgentDecision =
  | "applied"
  | "no_candidates"
  | "no_decisions"
  | "rejected"
  | "error";

export type SkillCuratorAgentResult = {
  curatorAgentId: string;
  curatorAgentName: string;
  decision: SkillCuratorAgentDecision;
  candidateCount: number;
  appliedCount: number;
  skippedCount: number;
  promotedCount: number;
  retiredCount: number;
  reason: string;
};

export type SkillCuratorRunResult = {
  attemptedAt: string;
  enabled: boolean;
  evaluatedCuratorCount: number;
  appliedDecisionCount: number;
  curators: SkillCuratorAgentResult[];
};

/** Context one curator needs: who it is plus the host-owned candidate set. */
export type SkillCuratorContext = {
  curatorAgentId: string;
  curatorAgentName: string;
  candidates: SkillCurationCandidate[];
};

export interface SkillCuratorProvider {
  generateSkillCuration(input: SkillCurationInput): Promise<AiSkillCurationResponse>;
}

export interface SkillCuratorContextProvider {
  listCuratorContexts(candidateLimit: number): Promise<SkillCuratorContext[]>;
}

export interface SkillCuratorStore {
  promoteSkill(skillId: string): Promise<PromoteSkillResult>;
  retireSkill(skillId: string): Promise<RetireSkillResult>;
  recordCuration(input: SkillCurationRecordInput): Promise<SkillCurationRecord>;
  recordInvocation(input: AiInvocationRecordInput): Promise<void>;
}

export type SkillCuratorServiceOptions = {
  enabled?: boolean;
  intervalMs?: number | null;
  windowDays?: number;
  candidateLimit?: number;
  provider?: SkillCuratorProvider;
  contextProvider?: SkillCuratorContextProvider;
  store?: SkillCuratorStore;
};

/**
 * Autonomous shared-skill curator. For each agent whose role is
 * `skill_curator`, it asks the runner to triage the cross-agent skill commons
 * (promote reusable private skills, retire stale/contradictory ones) and then a
 * DETERMINISTIC applier executes the validated decisions.
 *
 * Safety model (mirrors the prompt optimizer):
 *  - The AI only references skills by host-supplied ids; ids it invents are
 *    rejected before anything is applied.
 *  - The curator never authors or edits skill content.
 *  - Every mutation is reversible: retire = archive (row kept), promote = new
 *    shared copy that preserves the original. Both are idempotent.
 *  - Every decision is recorded in the audit log with its applied/skipped status.
 */
export class SkillCuratorService implements WorkerService {
  readonly name = "skill-curator";

  private state: ServiceState = "stopped";
  private latestResult: SkillCuratorRunResult | null = null;

  private readonly enabled: boolean;
  private readonly intervalMs: number | null;
  private readonly windowDays: number;
  private readonly candidateLimit: number;
  private readonly provider: SkillCuratorProvider;
  private readonly contextProvider: SkillCuratorContextProvider;
  private readonly store: SkillCuratorStore;
  private interval: ReturnType<typeof setInterval> | null = null;

  constructor(options: SkillCuratorServiceOptions = {}) {
    this.enabled = options.enabled ?? env.AI_SKILL_CURATOR_ENABLED;
    this.intervalMs = options.intervalMs === undefined ? 12 * 60 * 60 * 1000 : options.intervalMs;
    this.windowDays = options.windowDays ?? 14;
    this.candidateLimit = options.candidateLimit ?? 50;
    this.provider = options.provider ?? new HttpSkillCurationProvider(env.AI_RUNNER_INTERNAL_URL);
    this.contextProvider = options.contextProvider ?? new DbSkillCuratorContextProvider();
    this.store = options.store ?? new DbSkillCuratorStore();
  }

  async start(): Promise<void> {
    this.state = this.enabled ? "ready" : "stopped";

    if (this.enabled && this.intervalMs !== null && this.interval === null) {
      this.interval = setInterval(() => {
        void this.runScheduledCuration();
      }, this.intervalMs);
      this.interval.unref?.();
    }
  }

  async stop(): Promise<void> {
    if (this.interval !== null) {
      clearInterval(this.interval);
      this.interval = null;
    }

    this.state = "stopped";
  }

  async health(): Promise<ServiceHealth> {
    return {
      name: this.name,
      state: this.state,
      details: {
        enabled: this.enabled,
        latestResult: this.latestResult,
      },
    };
  }

  async runOnce(): Promise<SkillCuratorRunResult> {
    const attemptedAt = new Date().toISOString();

    if (!this.enabled) {
      const result: SkillCuratorRunResult = {
        attemptedAt,
        enabled: false,
        evaluatedCuratorCount: 0,
        appliedDecisionCount: 0,
        curators: [],
      };
      this.latestResult = result;
      return result;
    }

    const contexts = await this.contextProvider.listCuratorContexts(this.candidateLimit);
    const curators: SkillCuratorAgentResult[] = [];

    for (const context of contexts) {
      curators.push(await this.curate(context));
    }

    const result: SkillCuratorRunResult = {
      attemptedAt,
      enabled: true,
      evaluatedCuratorCount: contexts.length,
      appliedDecisionCount: curators.reduce((acc, curator) => acc + curator.appliedCount, 0),
      curators,
    };
    this.latestResult = result;
    return result;
  }

  /** Run one curator: request a curation, validate it, then apply each decision. */
  async curate(context: SkillCuratorContext): Promise<SkillCuratorAgentResult> {
    if (context.candidates.length === 0) {
      return this.result(context, "no_candidates", { reason: "No active skills to curate." });
    }

    const input: SkillCurationInput = {
      curatorAgentId: context.curatorAgentId,
      curatorAgentName: context.curatorAgentName,
      windowDays: this.windowDays,
      candidates: context.candidates,
    };

    const response = await this.provider.generateSkillCuration(input);
    await this.store.recordInvocation(toInvocationRecord(response));

    if (response.curation === undefined) {
      return this.result(context, "rejected", {
        reason: response.invocation.errorSummary ?? "Curator did not return a curation.",
      });
    }

    // Defensive re-validation: the deterministic applier only ever acts on a
    // curation that references host-supplied ids and carries no forbidden phrase.
    const validation = validateSkillCuration(response.curation, {
      allowedSkillIds: context.candidates.map((candidate) => candidate.skillId),
    });

    if (validation.status === "rejected") {
      return this.result(context, "rejected", {
        reason: validation.reasons.map((reason) => reason.message).join("; "),
      });
    }

    const decisions = validation.curation.decisions;

    if (decisions.length === 0) {
      return this.result(context, "no_decisions", { reason: validation.curation.reasoning });
    }

    let appliedCount = 0;
    let skippedCount = 0;
    let promotedCount = 0;
    let retiredCount = 0;

    for (const decision of decisions) {
      if (decision.action === "promote") {
        const outcome = await this.store.promoteSkill(decision.skill_id);
        const status = outcome.status === "promoted" ? "applied" : "skipped";
        if (status === "applied") {
          appliedCount += 1;
          promotedCount += 1;
        } else {
          skippedCount += 1;
        }
        await this.store.recordCuration({
          curatorAgentId: context.curatorAgentId,
          action: "promote",
          status,
          skillId: decision.skill_id,
          resultSkillId: outcome.resultSkillId,
          confidence: decision.confidence,
          reason: decision.reason,
        });
      } else {
        const outcome = await this.store.retireSkill(decision.skill_id);
        const status = outcome.status === "retired" ? "applied" : "skipped";
        if (status === "applied") {
          appliedCount += 1;
          retiredCount += 1;
        } else {
          skippedCount += 1;
        }
        await this.store.recordCuration({
          curatorAgentId: context.curatorAgentId,
          action: "retire",
          status,
          skillId: decision.skill_id,
          resultSkillId: null,
          confidence: decision.confidence,
          reason: decision.reason,
        });
      }
    }

    return this.result(context, "applied", {
      reason: validation.curation.reasoning,
      appliedCount,
      skippedCount,
      promotedCount,
      retiredCount,
    });
  }

  private result(
    context: SkillCuratorContext,
    decision: SkillCuratorAgentDecision,
    overrides: Partial<
      Omit<
        SkillCuratorAgentResult,
        "curatorAgentId" | "curatorAgentName" | "decision" | "candidateCount"
      >
    >,
  ): SkillCuratorAgentResult {
    return {
      curatorAgentId: context.curatorAgentId,
      curatorAgentName: context.curatorAgentName,
      decision,
      candidateCount: context.candidates.length,
      appliedCount: overrides.appliedCount ?? 0,
      skippedCount: overrides.skippedCount ?? 0,
      promotedCount: overrides.promotedCount ?? 0,
      retiredCount: overrides.retiredCount ?? 0,
      reason: overrides.reason ?? "",
    };
  }

  private async runScheduledCuration(): Promise<void> {
    try {
      await this.runOnce();
    } catch (error) {
      this.latestResult = {
        attemptedAt: new Date().toISOString(),
        enabled: this.enabled,
        evaluatedCuratorCount: 0,
        appliedDecisionCount: 0,
        curators: [
          {
            curatorAgentId: "<all>",
            curatorAgentName: "<all>",
            decision: "error",
            candidateCount: 0,
            appliedCount: 0,
            skippedCount: 0,
            promotedCount: 0,
            retiredCount: 0,
            reason: error instanceof Error ? error.message : String(error),
          },
        ],
      };
    }
  }
}

export class HttpSkillCurationProvider implements SkillCuratorProvider {
  constructor(private readonly baseUrl: string) {}

  async generateSkillCuration(input: SkillCurationInput): Promise<AiSkillCurationResponse> {
    const response = await fetch(new URL("/skill-curations", this.baseUrl), {
      method: "POST",
      body: JSON.stringify(input),
      headers: { "content-type": "application/json" },
    });

    if (!response.ok) {
      throw new Error(`ai-runner skill curation failed with status ${response.status}`);
    }

    return (await response.json()) as AiSkillCurationResponse;
  }
}

export class DbSkillCuratorContextProvider implements SkillCuratorContextProvider {
  constructor(private readonly repository = new AiAgentRepository()) {}

  async listCuratorContexts(candidateLimit: number): Promise<SkillCuratorContext[]> {
    const curators = (await this.repository.listAgents()).filter(
      (agent) => agent.status === "active" && agent.role === "skill_curator",
    );

    if (curators.length === 0) {
      return [];
    }

    // The commons is shared, so every curator triages the same candidate set.
    const candidates = await this.repository.listCurationCandidates({ limit: candidateLimit });

    return curators.map((curator) => ({
      curatorAgentId: curator.id,
      curatorAgentName: curator.name,
      candidates,
    }));
  }
}

export class DbSkillCuratorStore implements SkillCuratorStore {
  constructor(
    private readonly agentRepository = new AiAgentRepository(),
    private readonly tuningRepository = new AiTuningRepository(),
  ) {}

  promoteSkill(skillId: string): Promise<PromoteSkillResult> {
    return this.agentRepository.promoteSkill(skillId);
  }

  retireSkill(skillId: string): Promise<RetireSkillResult> {
    return this.agentRepository.retireSkill(skillId);
  }

  recordCuration(input: SkillCurationRecordInput): Promise<SkillCurationRecord> {
    return this.agentRepository.recordSkillCuration(input);
  }

  recordInvocation(input: AiInvocationRecordInput): Promise<void> {
    return this.tuningRepository.recordInvocation(input);
  }
}

export class InMemorySkillCuratorStore implements SkillCuratorStore {
  readonly promotions: string[] = [];
  readonly retirements: string[] = [];
  readonly curations: SkillCurationRecordInput[] = [];
  readonly invocations: AiInvocationRecordInput[] = [];

  /**
   * `alreadyShared` / `alreadyArchived` let a test exercise idempotent skips:
   * promoting an already-shared skill or retiring an already-archived one.
   */
  constructor(
    private readonly alreadyShared: Set<string> = new Set(),
    private readonly alreadyArchived: Set<string> = new Set(),
  ) {}

  async promoteSkill(skillId: string): Promise<PromoteSkillResult> {
    this.promotions.push(skillId);
    if (this.alreadyShared.has(skillId)) {
      return { status: "skipped", resultSkillId: skillId, reason: "already_shared" };
    }
    return { status: "promoted", resultSkillId: `shared-${skillId}` };
  }

  async retireSkill(skillId: string): Promise<RetireSkillResult> {
    this.retirements.push(skillId);
    if (this.alreadyArchived.has(skillId)) {
      return { status: "skipped", reason: "already_archived" };
    }
    return { status: "retired" };
  }

  async recordCuration(input: SkillCurationRecordInput): Promise<SkillCurationRecord> {
    this.curations.push(input);
    return {
      id: randomUUID(),
      curatorAgentId: input.curatorAgentId,
      action: input.action,
      status: input.status,
      skillId: input.skillId,
      resultSkillId: input.resultSkillId ?? null,
      confidence: input.confidence,
      reason: input.reason,
      createdAt: new Date().toISOString(),
    };
  }

  async recordInvocation(input: AiInvocationRecordInput): Promise<void> {
    this.invocations.push(input);
  }
}

function toInvocationRecord(response: AiSkillCurationResponse): AiInvocationRecordInput {
  return {
    id: response.invocation.id,
    provider: response.invocation.provider,
    purpose: "skill_curation",
    promptHash: response.invocation.promptHash,
    promptRedacted: response.invocation.promptRedacted,
    stdoutRaw: response.invocation.stdoutRaw,
    stderrSummary: response.invocation.stderrSummary,
    parsedJson: response.invocation.parsedJson,
    status: response.invocation.status,
    timeoutMs: response.invocation.timeoutMs,
    cliVersion: response.invocation.cliVersion,
    startedAt: new Date(response.invocation.startedAt),
    finishedAt: new Date(response.invocation.finishedAt),
    errorSummary: response.invocation.errorSummary,
  };
}
