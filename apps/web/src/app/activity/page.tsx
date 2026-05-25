import { getCharacter } from "@ai-trade/domain/ai-agents/characters";
import Link from "next/link";

import { CharacterAvatar } from "@/components/agents/CharacterAvatar";

export const dynamic = "force-dynamic";

type ActivityKind = "runs" | "proposals";

type RunStatus = "succeeded" | "failed" | "timeout" | "rejected_output";
type ProposalStatus = "accepted" | "rejected";

type RunRow = {
  id: string;
  agentId: string;
  agentVersion: number;
  status: RunStatus;
  error: string | null;
  startedAt: string;
};

type ProposalRow = {
  id: string;
  agentId: string;
  strategyName: string;
  validationStatus: ProposalStatus;
  strategyRunStatus: string | null;
  createdAt: string;
};

type AgentSummary = {
  id: string;
  name: string;
  characterId?: string | null;
};

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function ActivityPage({ searchParams }: PageProps) {
  const query = await searchParams;
  const kind = parseKind(query.kind);
  const agentId = typeof query.agentId === "string" ? query.agentId : undefined;
  const runStatus = parseRunStatus(query.status);
  const proposalStatus = parseProposalStatus(query.status);

  const [runs, proposals, agents] = await Promise.all([
    kind === "runs" ? fetchRuns({ agentId, status: runStatus, limit: 100 }) : Promise.resolve([]),
    kind === "proposals"
      ? fetchProposals({ agentId, status: proposalStatus, limit: 100 })
      : Promise.resolve([]),
    fetchAgents(),
  ]);

  const agentMap = new Map(agents.map((agent) => [agent.id, agent]));

  return (
    <section className="page-shell">
      <header className="page-header">
        <div>
          <p className="page-kicker">Agent Activity</p>
          <h1>Activity</h1>
        </div>
        <div className="page-actions">
          <Link
            href="/activity?kind=runs"
            className={kind === "runs" ? "btn-secondary" : "btn-ghost"}
          >
            Runs
          </Link>
          <Link
            href="/activity?kind=proposals"
            className={kind === "proposals" ? "btn-secondary" : "btn-ghost"}
          >
            Proposals
          </Link>
        </div>
      </header>

      <section className="panel">
        <div className="panel-title">
          <h2>{kind === "runs" ? `${runs.length} runs` : `${proposals.length} proposals`}</h2>
          {agentId ? (
            <Link href={`/activity?kind=${kind}`} className="btn-ghost">
              Clear agent filter
            </Link>
          ) : null}
        </div>

        <StatusFilters kind={kind} status={query.status} />

        {kind === "runs" ? (
          <RunList runs={runs} agentMap={agentMap} />
        ) : (
          <ProposalList proposals={proposals} agentMap={agentMap} />
        )}
      </section>
    </section>
  );
}

function StatusFilters({
  kind,
  status,
}: {
  kind: ActivityKind;
  status: string | string[] | undefined;
}) {
  const activeStatus = typeof status === "string" ? status : undefined;
  const filters =
    kind === "runs"
      ? [
          ["succeeded", "Succeeded"],
          ["failed", "Failed"],
          ["timeout", "Timeout"],
          ["rejected_output", "Rejected output"],
        ]
      : [
          ["accepted", "Accepted"],
          ["rejected", "Rejected"],
        ];

  return (
    <nav className="mb-3.5 flex flex-wrap gap-2" aria-label="Activity status">
      <Link
        href={`/activity?kind=${kind}`}
        className={!activeStatus ? "btn-secondary" : "btn-ghost"}
      >
        All
      </Link>
      {filters.map(([value, label]) => (
        <Link
          key={value}
          href={`/activity?kind=${kind}&status=${value}`}
          className={activeStatus === value ? "btn-secondary" : "btn-ghost"}
        >
          {label}
        </Link>
      ))}
    </nav>
  );
}

function RunList({ runs, agentMap }: { runs: RunRow[]; agentMap: Map<string, AgentSummary> }) {
  if (runs.length === 0) {
    return <p className="text-muted">No runs match the current filter.</p>;
  }

  return runs.map((run) => {
    const agent = agentMap.get(run.agentId);
    const character = getCharacter(agent?.characterId);
    return (
      <Link key={run.id} href={`/agents/${run.agentId}?tab=activity`} className="activity-row">
        <CharacterAvatar character={character} size="sm" />
        <div>
          <div className="activity-row-title">
            {agent?.name ?? run.agentId.slice(0, 8)} · v{run.agentVersion}
          </div>
          <div className="activity-row-meta">
            {run.startedAt}
            {run.error ? ` · ${run.error.slice(0, 60)}` : ""}
          </div>
        </div>
        <span className={`status-pill ${run.status === "succeeded" ? "active" : "paused"}`}>
          {run.status}
        </span>
      </Link>
    );
  });
}

function ProposalList({
  proposals,
  agentMap,
}: {
  proposals: ProposalRow[];
  agentMap: Map<string, AgentSummary>;
}) {
  if (proposals.length === 0) {
    return <p className="text-muted">No proposals match the current filter.</p>;
  }

  return proposals.map((proposal) => {
    const agent = agentMap.get(proposal.agentId);
    const character = getCharacter(agent?.characterId);
    return (
      <Link
        key={proposal.id}
        href={`/agents/${proposal.agentId}?tab=strategy`}
        className="activity-row"
      >
        <CharacterAvatar character={character} size="sm" />
        <div>
          <div className="activity-row-title">{proposal.strategyName}</div>
          <div className="activity-row-meta">
            {agent?.name ?? proposal.agentId.slice(0, 8)} · {proposal.createdAt}
            {proposal.strategyRunStatus ? ` · ${proposal.strategyRunStatus}` : ""}
          </div>
        </div>
        <span
          className={`status-pill ${proposal.validationStatus === "accepted" ? "active" : "paused"}`}
        >
          {proposal.validationStatus}
        </span>
      </Link>
    );
  });
}

async function fetchRuns(filter: {
  agentId?: string;
  status?: RunStatus;
  limit?: number;
}): Promise<RunRow[]> {
  const url = new URL("/agents/runs", process.env.WORKER_INTERNAL_URL ?? "http://localhost:8787");
  if (filter.agentId) url.searchParams.set("agentId", filter.agentId);
  if (filter.status) url.searchParams.set("status", filter.status);
  if (filter.limit) url.searchParams.set("limit", String(filter.limit));

  const response = await fetch(url, { cache: "no-store" }).catch(() => null);
  if (!response?.ok) return [];
  const body = (await response.json()) as { runs?: RunRow[] };
  return Array.isArray(body.runs) ? body.runs : [];
}

async function fetchProposals(filter: {
  agentId?: string;
  status?: ProposalStatus;
  limit?: number;
}): Promise<ProposalRow[]> {
  const url = new URL(
    "/agents/proposals",
    process.env.WORKER_INTERNAL_URL ?? "http://localhost:8787",
  );
  if (filter.agentId) url.searchParams.set("agentId", filter.agentId);
  if (filter.status) url.searchParams.set("status", filter.status);
  if (filter.limit) url.searchParams.set("limit", String(filter.limit));

  const response = await fetch(url, { cache: "no-store" }).catch(() => null);
  if (!response?.ok) return [];
  const body = (await response.json()) as { proposals?: ProposalRow[] };
  return Array.isArray(body.proposals) ? body.proposals : [];
}

async function fetchAgents(): Promise<AgentSummary[]> {
  const response = await fetch(
    new URL("/agents", process.env.WORKER_INTERNAL_URL ?? "http://localhost:8787"),
    { cache: "no-store" },
  ).catch(() => null);
  if (!response?.ok) return [];
  const body = (await response.json()) as { agents?: AgentSummary[] };
  return Array.isArray(body.agents) ? body.agents : [];
}

function parseKind(value: unknown): ActivityKind {
  return value === "proposals" ? "proposals" : "runs";
}

function parseRunStatus(value: unknown): RunStatus | undefined {
  return value === "succeeded" ||
    value === "failed" ||
    value === "timeout" ||
    value === "rejected_output"
    ? value
    : undefined;
}

function parseProposalStatus(value: unknown): ProposalStatus | undefined {
  return value === "accepted" || value === "rejected" ? value : undefined;
}
