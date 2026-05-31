import { randomUUID } from "node:crypto";

import type {
  AiSkillCuration,
  AiSkillCurationResponse,
  SkillCurationCandidate,
  SkillCurationInput,
} from "@ai-trade/domain/ai-tuning";
import { describe, expect, it } from "vitest";

import {
  InMemorySkillCuratorStore,
  type SkillCuratorContext,
  type SkillCuratorContextProvider,
  type SkillCuratorProvider,
  SkillCuratorService,
} from "./skill-curator.js";

const NOW = new Date("2026-06-01T00:00:00Z");
const PRIVATE_SKILL_ID = "11111111-1111-4111-8111-111111111111";
const SHARED_SKILL_ID = "22222222-2222-4222-8222-222222222222";
const CURATOR_AGENT_ID = "33333333-3333-4333-8333-333333333333";

class FakeProvider implements SkillCuratorProvider {
  readonly calls: SkillCurationInput[] = [];

  constructor(
    private readonly curation: AiSkillCuration | undefined,
    private readonly errorSummary?: string,
  ) {}

  async generateSkillCuration(input: SkillCurationInput): Promise<AiSkillCurationResponse> {
    this.calls.push(input);
    return {
      invocation: {
        id: randomUUID(),
        provider: "claude_cli",
        status: this.curation ? "succeeded" : "failed",
        promptHash: "hash",
        promptRedacted: "redacted",
        timeoutMs: 180_000,
        startedAt: NOW.toISOString(),
        finishedAt: NOW.toISOString(),
        errorSummary: this.errorSummary,
      },
      curation: this.curation,
    };
  }
}

class StaticContextProvider implements SkillCuratorContextProvider {
  constructor(private readonly contexts: SkillCuratorContext[]) {}

  async listCuratorContexts(): Promise<SkillCuratorContext[]> {
    return this.contexts;
  }
}

function candidate(overrides: Partial<SkillCurationCandidate> = {}): SkillCurationCandidate {
  return {
    skillId: PRIVATE_SKILL_ID,
    agentId: "agent-1",
    agentName: "yura",
    scope: "private",
    status: "active",
    title: "押し目買いのチェックリスト",
    tags: ["entry", "trend"],
    reason: "直近で再現性のある根拠になった。",
    bodyPreview: "トレンド方向に沿ってのみエントリーする。",
    createdAt: NOW.toISOString(),
    ageDays: 20,
    ...overrides,
  };
}

function context(overrides: Partial<SkillCuratorContext> = {}): SkillCuratorContext {
  return {
    curatorAgentId: CURATOR_AGENT_ID,
    curatorAgentName: "ceres",
    candidates: [candidate()],
    ...overrides,
  };
}

function buildService(options: {
  contexts: SkillCuratorContext[];
  provider: FakeProvider;
  store: InMemorySkillCuratorStore;
}) {
  return new SkillCuratorService({
    enabled: true,
    intervalMs: null,
    provider: options.provider,
    contextProvider: new StaticContextProvider(options.contexts),
    store: options.store,
  });
}

describe("SkillCuratorService.runOnce", () => {
  it("returns an empty disabled result when the curator is off", async () => {
    const provider = new FakeProvider({ decisions: [], reasoning: "n/a" });
    const service = new SkillCuratorService({
      enabled: false,
      intervalMs: null,
      provider,
      contextProvider: new StaticContextProvider([context()]),
      store: new InMemorySkillCuratorStore(),
    });

    const result = await service.runOnce();

    expect(result.enabled).toBe(false);
    expect(result.curators).toHaveLength(0);
    expect(provider.calls).toHaveLength(0);
  });

  it("applies promote and retire decisions deterministically", async () => {
    const store = new InMemorySkillCuratorStore();
    const provider = new FakeProvider({
      decisions: [
        {
          action: "promote",
          skill_id: PRIVATE_SKILL_ID,
          reason: "他のクルーでも再利用できる汎用的な手順。",
          confidence: "high",
        },
        {
          action: "retire",
          skill_id: SHARED_SKILL_ID,
          reason: "前提が古くなり矛盾しているため退役。",
          confidence: "medium",
        },
      ],
      reasoning: "再利用価値の高い私有スキルを共有化し、陳腐化したものを退役する。",
    });
    const service = buildService({
      contexts: [
        context({
          candidates: [
            candidate({ skillId: PRIVATE_SKILL_ID, scope: "private" }),
            candidate({ skillId: SHARED_SKILL_ID, scope: "shared", agentName: "noah" }),
          ],
        }),
      ],
      provider,
      store,
    });

    const result = await service.runOnce();

    expect(result.enabled).toBe(true);
    expect(result.appliedDecisionCount).toBe(2);
    expect(result.curators[0]?.decision).toBe("applied");
    expect(result.curators[0]?.promotedCount).toBe(1);
    expect(result.curators[0]?.retiredCount).toBe(1);
    expect(store.promotions).toEqual([PRIVATE_SKILL_ID]);
    expect(store.retirements).toEqual([SHARED_SKILL_ID]);
    expect(store.curations).toHaveLength(2);
    expect(store.curations[0]?.status).toBe("applied");
    expect(store.invocations[0]?.purpose).toBe("skill_curation");
    // The curator references the host-supplied id, not one it invents.
    expect(provider.calls[0]?.candidates).toHaveLength(2);
  });

  it("records idempotent skips without counting them as applied", async () => {
    const store = new InMemorySkillCuratorStore(
      new Set([PRIVATE_SKILL_ID]),
      new Set([SHARED_SKILL_ID]),
    );
    const provider = new FakeProvider({
      decisions: [
        {
          action: "promote",
          skill_id: PRIVATE_SKILL_ID,
          reason: "すでに共有済みなので冪等にスキップされる想定。",
          confidence: "low",
        },
        {
          action: "retire",
          skill_id: SHARED_SKILL_ID,
          reason: "すでに退役済みなので冪等にスキップされる想定。",
          confidence: "low",
        },
      ],
      reasoning: "重複適用を避ける。",
    });
    const service = buildService({
      contexts: [
        context({
          candidates: [
            candidate({ skillId: PRIVATE_SKILL_ID }),
            candidate({ skillId: SHARED_SKILL_ID, scope: "shared" }),
          ],
        }),
      ],
      provider,
      store,
    });

    const result = await service.runOnce();

    expect(result.appliedDecisionCount).toBe(0);
    expect(result.curators[0]?.decision).toBe("applied");
    expect(result.curators[0]?.skippedCount).toBe(2);
    expect(store.curations.every((curation) => curation.status === "skipped")).toBe(true);
  });

  it("reports no_candidates without calling the runner", async () => {
    const store = new InMemorySkillCuratorStore();
    const provider = new FakeProvider({ decisions: [], reasoning: "n/a" });
    const service = buildService({
      contexts: [context({ candidates: [] })],
      provider,
      store,
    });

    const result = await service.runOnce();

    expect(result.curators[0]?.decision).toBe("no_candidates");
    expect(provider.calls).toHaveLength(0);
    expect(store.invocations).toHaveLength(0);
  });

  it("reports no_decisions when the curator returns an empty plan", async () => {
    const store = new InMemorySkillCuratorStore();
    const provider = new FakeProvider({
      decisions: [],
      reasoning: "現状の共有スキルは健全で変更不要。",
    });
    const service = buildService({ contexts: [context()], provider, store });

    const result = await service.runOnce();

    expect(result.curators[0]?.decision).toBe("no_decisions");
    expect(store.promotions).toHaveLength(0);
    expect(store.retirements).toHaveLength(0);
    expect(store.curations).toHaveLength(0);
    // The invocation is still recorded for audit even when nothing is applied.
    expect(store.invocations).toHaveLength(1);
  });

  it("rejects when the runner returns no curation", async () => {
    const store = new InMemorySkillCuratorStore();
    const provider = new FakeProvider(undefined, "runner timed out");
    const service = buildService({ contexts: [context()], provider, store });

    const result = await service.runOnce();

    expect(result.curators[0]?.decision).toBe("rejected");
    expect(result.curators[0]?.reason).toBe("runner timed out");
    expect(store.curations).toHaveLength(0);
  });

  it("rejects a curation that references an unknown skill id", async () => {
    const store = new InMemorySkillCuratorStore();
    const provider = new FakeProvider({
      decisions: [
        {
          action: "promote",
          skill_id: "99999999-9999-4999-8999-999999999999",
          reason: "存在しないIDを参照しているため拒否される想定。",
          confidence: "high",
        },
      ],
      reasoning: "捏造IDの適用を防ぐ。",
    });
    const service = buildService({ contexts: [context()], provider, store });

    const result = await service.runOnce();

    expect(result.curators[0]?.decision).toBe("rejected");
    expect(store.promotions).toHaveLength(0);
    expect(store.curations).toHaveLength(0);
  });

  it("rejects a curation whose reason contains a forbidden phrase", async () => {
    const store = new InMemorySkillCuratorStore();
    const provider = new FakeProvider({
      decisions: [
        {
          action: "promote",
          skill_id: PRIVATE_SKILL_ID,
          reason: "損切りなしで運用するスキルなので共有したい。",
          confidence: "high",
        },
      ],
      reasoning: "リスク管理を無視した提案。",
    });
    const service = buildService({ contexts: [context()], provider, store });

    const result = await service.runOnce();

    expect(result.curators[0]?.decision).toBe("rejected");
    expect(store.promotions).toHaveLength(0);
    expect(store.curations).toHaveLength(0);
  });
});
