import { AGENT_CHARACTERS, getCharacter } from "@ai-trade/domain/ai-agents/characters";
import Link from "next/link";

import { type CrewAgentSummary, CrewTile } from "./CrewTile";

type AgentSummaryRaw = {
  id: string;
  name: string;
  status: "active" | "paused";
  currentVersion: number;
  characterId?: string | null;
  proposalCount: number;
  acceptedProposalCount: number;
  succeededRunCount: number;
  failedRunCount: number;
  latestRun: { status: string } | null;
};

async function fetchAgentSummaries(): Promise<AgentSummaryRaw[]> {
  const url = new URL("/agents", process.env.WORKER_INTERNAL_URL ?? "http://localhost:8787");
  const response = await fetch(url, { cache: "no-store" }).catch(() => null);

  if (!response?.ok) {
    return [];
  }

  const body = (await response.json()) as { agents?: AgentSummaryRaw[] };
  return Array.isArray(body.agents) ? body.agents : [];
}

export async function CrewPanelSection() {
  const agents = await fetchAgentSummaries();
  const activeCount = agents.filter((agent) => agent.status === "active").length;
  const totalProposals = agents.reduce((sum, a) => sum + a.proposalCount, 0);
  const acceptedProposals = agents.reduce((sum, a) => sum + a.acceptedProposalCount, 0);
  const totalSucceededRuns = agents.reduce((sum, a) => sum + a.succeededRunCount, 0);
  const totalRuns = agents.reduce((sum, a) => sum + a.succeededRunCount + a.failedRunCount, 0);

  return (
    <section className="page-shell">
      <header className="page-header">
        <div>
          <p className="page-kicker">AI Crew</p>
          <h1>エージェント・クルー</h1>
        </div>
        <div className="page-actions">
          <Link href="/agents#picker" className="btn-primary">
            ＋ New Agent
          </Link>
          <Link href="/agents" className="btn-secondary">
            Manage agents
          </Link>
        </div>
      </header>

      <div className="dashboard-grid">
        <div className="crew-grid">
          {AGENT_CHARACTERS.map((character) => {
            const agent = agents.find((a) => a.characterId === character.id) ?? null;
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

        <aside className="panel">
          <div className="panel-title">
            <h2>本日のサマリ</h2>
          </div>
          <dl className="kpi-card-grid">
            <div className="kpi-card">
              <dt>Active</dt>
              <dd>
                {activeCount}
                <small> /{AGENT_CHARACTERS.length}</small>
              </dd>
              <p className="kpi-card-trend">配属中のエージェント</p>
            </div>
            <div className="kpi-card">
              <dt>Proposals</dt>
              <dd>
                {acceptedProposals}
                <small> /{totalProposals}</small>
              </dd>
              <p className="kpi-card-trend">accepted / total</p>
            </div>
            <div className="kpi-card">
              <dt>Runs</dt>
              <dd>
                {totalSucceededRuns}
                <small> /{totalRuns}</small>
              </dd>
              <p className="kpi-card-trend">succeeded / total</p>
            </div>
            <div className="kpi-card">
              <dt>Unassigned</dt>
              <dd>
                {AGENT_CHARACTERS.length - agents.filter((a) => getCharacter(a.characterId)).length}
              </dd>
              <p className="kpi-card-trend">未配属のキャラ</p>
            </div>
          </dl>
          <div className="mt-3.5 flex flex-wrap gap-1.5">
            <Link href="/proposals" className="btn-ghost">
              See all proposals →
            </Link>
            <Link href="/runs" className="btn-ghost">
              See all runs →
            </Link>
          </div>
        </aside>
      </div>
    </section>
  );
}
