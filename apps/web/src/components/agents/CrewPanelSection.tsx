import { AGENT_CHARACTERS, getCharacter } from "@ai-trade/domain/ai-agents/characters";
import Link from "next/link";

import { type CrewAgentSummary, CrewTile } from "./CrewTile";

export type AgentSummaryRaw = {
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
  paperAccount: {
    accountId: string;
    balanceJpy: number;
    initialBalanceJpy: number;
    pnlJpy: number;
    pnlPct: number;
    openPositionCount: number;
    closedTradeCount: number;
    totalRealizedPnlJpy: number;
  } | null;
};

export async function fetchAgentSummaries(): Promise<AgentSummaryRaw[]> {
  const url = new URL("/agents", process.env.WORKER_INTERNAL_URL ?? "http://localhost:8787");
  const response = await fetch(url, { cache: "no-store" }).catch(() => null);

  if (!response?.ok) {
    return [];
  }

  const body = (await response.json()) as { agents?: AgentSummaryRaw[] };
  return Array.isArray(body.agents) ? body.agents : [];
}

export async function CrewPanelSection({
  agents: agentsProp,
}: {
  agents?: AgentSummaryRaw[];
} = {}) {
  const agents = agentsProp ?? (await fetchAgentSummaries());
  const activeCount = agents.filter((agent) => agent.status === "active").length;
  const totalBalance = agents.reduce(
    (sum, agent) => sum + (agent.paperAccount?.balanceJpy ?? 0),
    0,
  );
  const totalInitial = agents.reduce(
    (sum, agent) => sum + (agent.paperAccount?.initialBalanceJpy ?? 0),
    0,
  );
  const totalPnl = totalBalance - totalInitial;
  const totalPnlPct = totalInitial > 0 ? (totalPnl / totalInitial) * 100 : 0;
  const totalOpenPositions = agents.reduce(
    (sum, agent) => sum + (agent.paperAccount?.openPositionCount ?? 0),
    0,
  );

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
                  balanceJpy: agent.paperAccount?.balanceJpy ?? null,
                  initialBalanceJpy: agent.paperAccount?.initialBalanceJpy ?? null,
                  pnlJpy: agent.paperAccount?.pnlJpy ?? null,
                  openPositionCount: agent.paperAccount?.openPositionCount ?? null,
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
              <dt>合計 Balance</dt>
              <dd>{formatCompactJpy(totalBalance)}</dd>
              <p className="kpi-card-trend">全エージェントの口座残高</p>
            </div>
            <div className="kpi-card">
              <dt>合計 PnL</dt>
              <dd className={totalPnl > 0 ? "tone-profit" : totalPnl < 0 ? "tone-loss" : undefined}>
                {totalPnl >= 0 ? "+" : ""}
                {formatCompactJpy(totalPnl)}
                <small>
                  {" "}
                  ({totalPnlPct >= 0 ? "+" : ""}
                  {totalPnlPct.toFixed(2)}%)
                </small>
              </dd>
              <p className="kpi-card-trend">balance − initial の合計</p>
            </div>
            <div className="kpi-card">
              <dt>Open positions</dt>
              <dd>{totalOpenPositions}</dd>
              <p className="kpi-card-trend">クルー全体のオープン数</p>
            </div>
          </dl>
          <div className="mt-3.5 flex flex-wrap gap-1.5">
            <Link href="/activity?kind=proposals" className="btn-ghost">
              See all proposals →
            </Link>
            <Link href="/activity?kind=runs" className="btn-ghost">
              See all runs →
            </Link>
            <span className="text-[11px] text-muted">
              未配属キャラ:{" "}
              {AGENT_CHARACTERS.length - agents.filter((a) => getCharacter(a.characterId)).length}
            </span>
          </div>
        </aside>
      </div>
    </section>
  );
}

function formatCompactJpy(value: number): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (abs >= 100_000_000) return `${sign}¥${(abs / 100_000_000).toFixed(2)}億`;
  if (abs >= 10_000) return `${sign}¥${(abs / 10_000).toFixed(1)}万`;
  return `${sign}¥${Math.round(abs).toLocaleString("ja-JP")}`;
}
