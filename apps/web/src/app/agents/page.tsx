import { AGENT_CHARACTERS, getCharacter } from "@ai-trade/domain/ai-agents/characters";
import Link from "next/link";

import { type CrewAgentSummary, CrewTile } from "@/components/agents/CrewTile";

export const dynamic = "force-dynamic";

type AgentSummary = {
  id: string;
  name: string;
  persona: string;
  status: "active" | "paused";
  currentVersion: number;
  runIntervalSec: number;
  model: string;
  allowedTools: string[];
  maxConsecutiveFailures: number;
  consecutiveFailures: number;
  tokenBudgetPerRun: number;
  costBudgetPerRunUsd: number;
  pausedReason?: string;
  sharedMemoryEnabled: boolean;
  characterId?: string | null;
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

async function getAgents(): Promise<AgentSummary[]> {
  const response = await fetch(
    new URL("/agents", process.env.WORKER_INTERNAL_URL ?? "http://localhost:8787"),
    { cache: "no-store" },
  ).catch(() => null);

  if (!response?.ok) {
    return [];
  }

  const body = (await response.json()) as { agents?: AgentSummary[] };
  return Array.isArray(body.agents) ? body.agents : [];
}

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function AgentsPage({ searchParams }: PageProps) {
  const query = await searchParams;
  const filter = typeof query.filter === "string" ? query.filter : "all";
  const agents = await getAgents();

  const filtered =
    filter === "active"
      ? agents.filter((agent) => agent.status === "active")
      : filter === "paused"
        ? agents.filter((agent) => agent.status === "paused")
        : agents;

  const unassignedAgents = filtered.filter((agent) => !getCharacter(agent.characterId));

  return (
    <section className="page-shell">
      <header className="page-header">
        <div>
          <p className="page-kicker">Crew Roster</p>
          <h1>Agents</h1>
        </div>
        <div className="page-actions">
          <Link
            href="/agents?filter=all"
            className={filter === "all" ? "btn-secondary" : "btn-ghost"}
          >
            All
          </Link>
          <Link
            href="/agents?filter=active"
            className={filter === "active" ? "btn-secondary" : "btn-ghost"}
          >
            Active
          </Link>
          <Link
            href="/agents?filter=paused"
            className={filter === "paused" ? "btn-secondary" : "btn-ghost"}
          >
            Paused
          </Link>
          <Link href="/agents/new" className="btn-primary">
            ＋ New Agent
          </Link>
        </div>
      </header>

      <div className="crew-grid">
        {AGENT_CHARACTERS.map((character) => {
          const agent = filtered.find((a) => a.characterId === character.id) ?? null;
          const summary: CrewAgentSummary | null = agent
            ? {
                id: agent.id,
                name: agent.name,
                status: agent.status,
                currentVersion: agent.currentVersion,
                acceptedProposalCount: agent.acceptedProposalCount,
                proposalCount: agent.proposalCount,
                succeededRunCount: agent.succeededRunCount,
                failedRunCount: agent.failedRunCount,
                latestRunStatus: agent.latestRun?.status ?? null,
              }
            : null;
          return <CrewTile key={character.id} character={character} agent={summary} />;
        })}
      </div>

      {unassignedAgents.length > 0 ? (
        <section className="panel">
          <div className="panel-title">
            <h2>キャラ未設定のエージェント ({unassignedAgents.length})</h2>
          </div>
          <p style={{ color: "var(--muted)", marginBottom: 12 }}>
            既存のエージェントにキャラが未割り当てです。詳細画面の Edit
            からキャラを選択してください。
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {unassignedAgents.map((agent) => (
              <Link key={agent.id} href={`/agents/${agent.id}`} className="activity-row">
                <span
                  className="character-avatar placeholder"
                  style={{ width: 36, height: 36 }}
                  aria-hidden
                >
                  ?
                </span>
                <div>
                  <div className="activity-row-title">{agent.name}</div>
                  <div className="activity-row-meta">{agent.persona}</div>
                </div>
                <span className="activity-row-status">v{agent.currentVersion}</span>
              </Link>
            ))}
          </div>
        </section>
      ) : null}
    </section>
  );
}
