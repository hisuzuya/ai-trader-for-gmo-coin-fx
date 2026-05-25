import { getCharacter } from "@ai-trade/domain/ai-agents/characters";
import { AGENT_RESEARCH_TOOL_NAMES } from "@ai-trade/domain/ai-agents/types";
import Link from "next/link";
import { notFound } from "next/navigation";

import { CharacterHero } from "@/components/agents/CharacterHero";

import { deleteAgentMemory, rollbackAgentVersion, saveAgentVersion } from "../actions";

export const dynamic = "force-dynamic";

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "prompt", label: "Prompt" },
  { id: "memory", label: "Memory" },
  { id: "proposals", label: "Proposals" },
  { id: "reviews", label: "Reviews" },
  { id: "runs", label: "Runs" },
  { id: "versions", label: "Versions" },
] as const;

type TabId = (typeof TABS)[number]["id"];

type AgentDetail = {
  id: string;
  name: string;
  persona: string;
  systemPrompt: string;
  allowedTools: string[];
  status: "active" | "paused";
  currentVersion: number;
  runIntervalSec: number;
  model: string;
  maxConsecutiveFailures: number;
  consecutiveFailures: number;
  tokenBudgetPerRun: number;
  costBudgetPerRunUsd: number;
  pausedReason?: string;
  sharedMemoryEnabled: boolean;
  characterId?: string | null;
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
    allowedTools: string[];
    note: string | null;
    createdAt: string;
  }[];
};

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

async function getAgent(id: string): Promise<AgentDetail | null> {
  const response = await fetch(
    new URL(`/agents/${id}`, process.env.WORKER_INTERNAL_URL ?? "http://localhost:8787"),
    { cache: "no-store" },
  ).catch(() => null);

  if (!response?.ok) return null;
  const body = (await response.json()) as { agent?: AgentDetail };
  return body.agent ?? null;
}

function isTab(value: unknown): value is TabId {
  return typeof value === "string" && TABS.some((t) => t.id === value);
}

export default async function AgentDetailPage({ params, searchParams }: PageProps) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const agent = await getAgent(id);
  if (!agent) notFound();

  const activeTab: TabId = isTab(query.tab) ? query.tab : "overview";
  const saveAction = saveAgentVersion.bind(null, agent.id);
  const rollbackAction = rollbackAgentVersion.bind(null, agent.id);
  const deleteMemoryAction = deleteAgentMemory.bind(null, agent.id);
  const character = getCharacter(agent.characterId);

  const saved = query.saved === "1";
  const created = query.created === "1";
  const rolledBack = query.rolledBack === "1";
  const memoryDeleted = query.memoryDeleted === "1";
  const warningSecret = query.warning === "secret_like";
  const errorEmpty = query.error === "empty_prompt";
  const errorSave = query.error === "save_failed";

  const totalRuns = agent.runs.length;
  const succeededRuns = agent.runs.filter((run) => run.status === "succeeded").length;
  const acceptedProposals = agent.proposals.filter((p) => p.validationStatus === "accepted").length;
  const totalProposals = agent.proposals.length;

  return (
    <section className="page-shell">
      <div className="flex items-center justify-between">
        <Link href="/agents" className="btn-ghost">
          ← Agents
        </Link>
        <div className="flex gap-1.5">
          {created ? <span className="panel-toast">Created</span> : null}
          {saved ? <span className="panel-toast">Saved</span> : null}
          {rolledBack ? <span className="panel-toast">Rolled back</span> : null}
          {memoryDeleted ? <span className="panel-toast">Memory deleted</span> : null}
          {warningSecret ? (
            <span className="panel-toast warn">
              シークレットを検出。削除してから保存してください
            </span>
          ) : null}
          {errorEmpty ? <span className="panel-toast warn">Prompt is empty</span> : null}
          {errorSave ? <span className="panel-toast warn">保存に失敗しました</span> : null}
          <Link href={`/agents/${agent.id}/edit`} className="btn-secondary">
            Edit settings
          </Link>
        </div>
      </div>

      <CharacterHero
        character={character}
        agentName={agent.name}
        persona={agent.persona}
        status={agent.status}
        version={agent.currentVersion}
        pausedReason={agent.pausedReason}
        kpis={[
          { label: "Runs ok", value: `${succeededRuns}/${totalRuns}` },
          {
            label: "Accept",
            value: `${acceptedProposals}/${totalProposals}`,
          },
          { label: "Interval", value: `${agent.runIntervalSec}s` },
          { label: "Cost cap", value: `$${agent.costBudgetPerRunUsd}` },
        ]}
      />

      <nav className="tabs-nav" aria-label="Agent sections">
        {TABS.map((tab) => (
          <Link
            key={tab.id}
            href={`/agents/${agent.id}?tab=${tab.id}`}
            className={activeTab === tab.id ? "active" : ""}
          >
            {tab.label}
          </Link>
        ))}
      </nav>

      {activeTab === "overview" ? <OverviewPanel agent={agent} /> : null}
      {activeTab === "prompt" ? <PromptPanel agent={agent} action={saveAction} /> : null}
      {activeTab === "memory" ? <MemoryPanel agent={agent} action={deleteMemoryAction} /> : null}
      {activeTab === "proposals" ? <ProposalsPanel agent={agent} /> : null}
      {activeTab === "reviews" ? <ReviewsPanel agent={agent} /> : null}
      {activeTab === "runs" ? <RunsPanel agent={agent} /> : null}
      {activeTab === "versions" ? <VersionsPanel agent={agent} action={rollbackAction} /> : null}
    </section>
  );
}

function OverviewPanel({ agent }: { agent: AgentDetail }) {
  return (
    <>
      <section className="panel">
        <div className="panel-title">
          <h2>Latest observations</h2>
          <Link href={`/agents/${agent.id}?tab=runs`} className="btn-ghost">
            See runs →
          </Link>
        </div>
        {agent.observations.slice(0, 3).map((obs) => (
          <div key={obs.id} className="activity-row">
            <span className="meta-pill subtle">{obs.kind}</span>
            <div>
              <div className="activity-row-title">{obs.summary}</div>
              <div className="activity-row-meta">{obs.createdAt}</div>
            </div>
            <span className="activity-row-status">{obs.tags.slice(0, 2).join(", ")}</span>
          </div>
        ))}
        {agent.observations.length === 0 ? (
          <p className="text-muted">No observations yet.</p>
        ) : null}
      </section>

      <section className="panel">
        <div className="panel-title">
          <h2>Recent proposals</h2>
          <Link href={`/proposals?agentId=${agent.id}`} className="btn-ghost">
            See all →
          </Link>
        </div>
        {agent.proposals.slice(0, 3).map((p) => (
          <div key={p.id} className="activity-row">
            <span
              className={`status-pill ${p.validationStatus === "accepted" ? "active" : "paused"}`}
            >
              {p.validationStatus}
            </span>
            <div>
              <div className="activity-row-title">{p.strategyName}</div>
              <div className="activity-row-meta">{p.createdAt}</div>
            </div>
            <span className="activity-row-status">{p.strategyRunStatus ?? "-"}</span>
          </div>
        ))}
        {agent.proposals.length === 0 ? <p className="text-muted">No proposals yet.</p> : null}
      </section>

      <section className="panel">
        <div className="panel-title">
          <h2>Candidate reviews</h2>
        </div>
        {agent.reviews.slice(0, 3).map((r) => (
          <div key={r.id} className="activity-row">
            <span className="meta-pill">{r.recommendation}</span>
            <div>
              <div className="activity-row-title">{r.strategyName}</div>
              <div className="activity-row-meta">{r.reason}</div>
            </div>
            <span className="activity-row-status">{r.confidence}</span>
          </div>
        ))}
        {agent.reviews.length === 0 ? <p className="text-muted">No reviews yet.</p> : null}
      </section>
    </>
  );
}

function PromptPanel({
  agent,
  action,
}: {
  agent: AgentDetail;
  action: (formData: FormData) => void;
}) {
  return (
    <section className="panel">
      <div className="panel-title">
        <h2>System prompt</h2>
        <span className="meta-pill subtle">v{agent.currentVersion}</span>
      </div>
      <form action={action} className="prompt-form">
        <textarea name="systemPrompt" defaultValue={agent.systemPrompt} required />
        <div>
          <p className="mb-1.5 text-[11px] uppercase tracking-[0.08em] text-subtle">
            Allowed tools
          </p>
          <div className="tool-chips">
            {AGENT_RESEARCH_TOOL_NAMES.map((tool) => (
              <label key={tool}>
                <input
                  type="checkbox"
                  name="allowedTools"
                  value={tool}
                  defaultChecked={agent.allowedTools.includes(tool)}
                />
                <span>{tool}</span>
              </label>
            ))}
          </div>
        </div>
        <input name="note" placeholder="Version note (optional)" />
        <div className="flex gap-2">
          <button type="submit" className="btn-primary">
            Save new version
          </button>
        </div>
      </form>
    </section>
  );
}

function MemoryPanel({
  agent,
  action,
}: {
  agent: AgentDetail;
  action: (formData: FormData) => void;
}) {
  return (
    <section className="panel">
      <div className="panel-title">
        <h2>Memories ({agent.memories.length})</h2>
      </div>
      {agent.memories.length === 0 ? <p className="text-muted">No memories yet.</p> : null}
      {agent.memories.map((m) => (
        <article key={m.id} className="memory-card">
          <header>
            <span>{m.type}</span>
            <span>{m.createdAt}</span>
          </header>
          <pre>{m.content}</pre>
          <form action={action}>
            <input type="hidden" name="memoryId" value={m.id} />
            <button type="submit">Delete</button>
          </form>
        </article>
      ))}
    </section>
  );
}

function ProposalsPanel({ agent }: { agent: AgentDetail }) {
  return (
    <section className="panel">
      <div className="panel-title">
        <h2>Proposals (latest {agent.proposals.length})</h2>
        <Link href={`/proposals?agentId=${agent.id}`} className="btn-ghost">
          See all →
        </Link>
      </div>
      {agent.proposals.map((p) => (
        <div key={p.id} className="activity-row">
          <span
            className={`status-pill ${p.validationStatus === "accepted" ? "active" : "paused"}`}
          >
            {p.validationStatus}
          </span>
          <div>
            <div className="activity-row-title">{p.strategyName}</div>
            <div className="activity-row-meta">{p.createdAt}</div>
          </div>
          <span className="activity-row-status">{p.strategyRunStatus ?? "-"}</span>
        </div>
      ))}
      {agent.proposals.length === 0 ? <p className="text-muted">No proposals yet.</p> : null}
    </section>
  );
}

function ReviewsPanel({ agent }: { agent: AgentDetail }) {
  return (
    <section className="panel">
      <div className="panel-title">
        <h2>Reviews (latest {agent.reviews.length})</h2>
      </div>
      {agent.reviews.map((r) => (
        <div key={r.id} className="activity-row">
          <span className="meta-pill">{r.recommendation}</span>
          <div>
            <div className="activity-row-title">{r.strategyName}</div>
            <div className="activity-row-meta">{r.reason}</div>
          </div>
          <span className="activity-row-status">{r.confidence}</span>
        </div>
      ))}
      {agent.reviews.length === 0 ? <p className="text-muted">No reviews yet.</p> : null}
    </section>
  );
}

function RunsPanel({ agent }: { agent: AgentDetail }) {
  return (
    <section className="panel">
      <div className="panel-title">
        <h2>Runs (latest {agent.runs.length})</h2>
        <Link href={`/runs?agentId=${agent.id}`} className="btn-ghost">
          See all →
        </Link>
      </div>
      {agent.runs.map((run) => (
        <div key={run.id} className="activity-row">
          <span className={`status-pill ${run.status === "succeeded" ? "active" : "paused"}`}>
            {run.status}
          </span>
          <div>
            <div className="activity-row-title">v{run.agentVersion}</div>
            <div className="activity-row-meta">{run.startedAt}</div>
          </div>
          <span className="activity-row-status">{run.error ? "error" : "ok"}</span>
        </div>
      ))}
      {agent.runs.length === 0 ? <p className="text-muted">No runs yet.</p> : null}
    </section>
  );
}

function VersionsPanel({
  agent,
  action,
}: {
  agent: AgentDetail;
  action: (formData: FormData) => void;
}) {
  return (
    <section className="panel">
      <div className="panel-title">
        <h2>Versions ({agent.versions.length})</h2>
      </div>
      {agent.versions.map((version) => (
        <article key={version.id} className="memory-card">
          <header>
            <strong>v{version.version}</strong>
            <span>{version.createdAt}</span>
          </header>
          {version.note ? <p className="mb-1.5 text-xs text-muted">{version.note}</p> : null}
          <pre>
            {version.systemPrompt.slice(0, 300)}
            {version.systemPrompt.length > 300 ? "..." : ""}
          </pre>
          <form action={action}>
            <input type="hidden" name="sourceVersion" value={version.version} />
            <button type="submit" disabled={version.version === agent.currentVersion}>
              {version.version === agent.currentVersion ? "Current" : "Rollback as new version"}
            </button>
          </form>
        </article>
      ))}
    </section>
  );
}
