import Link from "next/link";

import { getCharacter } from "@ai-trade/domain/ai-agents/characters";

import { CharacterAvatar } from "@/components/agents/CharacterAvatar";

export const dynamic = "force-dynamic";

type ProposalRow = {
  id: string;
  agentId: string;
  strategyName: string;
  validationStatus: "accepted" | "rejected";
  rejectionReasons: unknown;
  insertedStrategyRunId: string | null;
  strategyRunStatus: string | null;
  createdAt: string;
};

type AgentSummary = {
  id: string;
  name: string;
  characterId?: string | null;
};

async function fetchProposals(filter: {
  agentId?: string;
  status?: "accepted" | "rejected";
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

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function ProposalsPage({ searchParams }: PageProps) {
  const query = await searchParams;
  const agentId = typeof query.agentId === "string" ? query.agentId : undefined;
  const statusRaw = typeof query.status === "string" ? query.status : undefined;
  const status: "accepted" | "rejected" | undefined =
    statusRaw === "accepted" || statusRaw === "rejected" ? statusRaw : undefined;

  const [proposals, agents] = await Promise.all([
    fetchProposals({ agentId, status, limit: 100 }),
    fetchAgents(),
  ]);

  const agentMap = new Map(agents.map((agent) => [agent.id, agent]));

  return (
    <section className="page-shell">
      <header className="page-header">
        <div>
          <p className="page-kicker">Activity</p>
          <h1>Proposals</h1>
        </div>
        <div className="page-actions">
          <Link
            href="/proposals"
            className={!status ? "btn-secondary" : "btn-ghost"}
          >
            All
          </Link>
          <Link
            href="/proposals?status=accepted"
            className={status === "accepted" ? "btn-secondary" : "btn-ghost"}
          >
            Accepted
          </Link>
          <Link
            href="/proposals?status=rejected"
            className={status === "rejected" ? "btn-secondary" : "btn-ghost"}
          >
            Rejected
          </Link>
        </div>
      </header>

      <section className="panel">
        <div className="panel-title">
          <h2>{proposals.length} proposals</h2>
          {agentId ? (
            <Link href="/proposals" className="btn-ghost">
              Clear agent filter
            </Link>
          ) : null}
        </div>

        {proposals.length === 0 ? (
          <p style={{ color: "var(--muted)" }}>No proposals match the current filter.</p>
        ) : null}

        {proposals.map((proposal) => {
          const agent = agentMap.get(proposal.agentId);
          const character = getCharacter(agent?.characterId);
          return (
            <Link
              key={proposal.id}
              href={`/agents/${proposal.agentId}?tab=proposals`}
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
        })}
      </section>
    </section>
  );
}
