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
  toolCalls: unknown;
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

const ACTIVITY_ROW_CLS =
  "grid grid-cols-[40px_minmax(0,1fr)_auto] items-center gap-3.5 rounded-lg border border-line-soft bg-surface-muted px-3.5 py-3 min-h-[64px] transition-colors hover:border-line";
const ACTIVITY_TITLE_CLS = "truncate text-[13px] font-medium text-text-strong";
const ACTIVITY_META_CLS = "truncate font-mono text-[11px] text-muted";
const ACTIVITY_TOOLS_CLS = "mt-1 truncate font-mono text-[11px] text-accent-strong/85";
const ACTIVITY_ERROR_CLS = "mt-1 truncate font-mono text-[11px] text-loss-strong/85";

function RunList({ runs, agentMap }: { runs: RunRow[]; agentMap: Map<string, AgentSummary> }) {
  if (runs.length === 0) {
    return <p className="text-xs text-muted">No runs match the current filter.</p>;
  }

  return (
    <div className="flex flex-col gap-2">
      {runs.map((run) => {
        const agent = agentMap.get(run.agentId);
        const character = getCharacter(agent?.characterId);
        const toolSummary = summarizeToolCalls(run.toolCalls);
        return (
          <Link
            key={run.id}
            href={`/agents/${run.agentId}?tab=activity`}
            className={ACTIVITY_ROW_CLS}
          >
            <CharacterAvatar character={character} size="sm" />
            <div className="flex min-w-0 flex-col">
              <span className={ACTIVITY_TITLE_CLS}>
                {agent?.name ?? run.agentId.slice(0, 8)} · v{run.agentVersion}
              </span>
              <span className={ACTIVITY_META_CLS}>{formatTimestamp(run.startedAt)}</span>
              {toolSummary ? (
                <span className={ACTIVITY_TOOLS_CLS} title={toolSummary}>
                  MCP/tools: {toolSummary}
                </span>
              ) : null}
              {run.error ? (
                <span className={ACTIVITY_ERROR_CLS} title={run.error}>
                  {run.error}
                </span>
              ) : null}
            </div>
            <span className={`status-pill ${runStatusTone(run.status)}`}>{run.status}</span>
          </Link>
        );
      })}
    </div>
  );
}

function ProposalList({
  proposals,
  agentMap,
}: {
  proposals: ProposalRow[];
  agentMap: Map<string, AgentSummary>;
}) {
  if (proposals.length === 0) {
    return <p className="text-xs text-muted">No proposals match the current filter.</p>;
  }

  return (
    <div className="flex flex-col gap-2">
      {proposals.map((proposal) => {
        const agent = agentMap.get(proposal.agentId);
        const character = getCharacter(agent?.characterId);
        const metaParts = [
          agent?.name ?? proposal.agentId.slice(0, 8),
          formatTimestamp(proposal.createdAt),
        ];
        if (proposal.strategyRunStatus) {
          metaParts.push(proposal.strategyRunStatus);
        }
        return (
          <Link
            key={proposal.id}
            href={`/agents/${proposal.agentId}?tab=strategy`}
            className={ACTIVITY_ROW_CLS}
          >
            <CharacterAvatar character={character} size="sm" />
            <div className="flex min-w-0 flex-col">
              <span className={ACTIVITY_TITLE_CLS}>{proposal.strategyName}</span>
              <span className={ACTIVITY_META_CLS}>{metaParts.join(" · ")}</span>
            </div>
            <span
              className={`status-pill ${
                proposal.validationStatus === "accepted" ? "active" : "paused"
              }`}
            >
              {proposal.validationStatus}
            </span>
          </Link>
        );
      })}
    </div>
  );
}

function runStatusTone(status: RunStatus) {
  if (status === "succeeded") return "active";
  if (status === "rejected_output" || status === "timeout") return "unassigned";
  return "paused";
}

function formatTimestamp(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("ja-JP", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
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

function summarizeToolCalls(toolCalls: unknown) {
  if (!Array.isArray(toolCalls) || toolCalls.length === 0) {
    return "";
  }

  const names = toolCalls
    .flatMap((call): string[] => {
      if (typeof call !== "object" || call === null || !("name" in call)) {
        return [];
      }
      return typeof call.name === "string" ? [call.name] : [];
    })
    .slice(0, 3);

  if (names.length === 0) {
    return `${toolCalls.length}`;
  }

  const suffix = toolCalls.length > names.length ? ` +${toolCalls.length - names.length}` : "";
  return `${names.join(", ")}${suffix}`;
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
