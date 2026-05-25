import { getCharacter } from "@ai-trade/domain/ai-agents/characters";
import Link from "next/link";
import { CharacterPickerModal } from "@/components/agents/CharacterPickerModal";
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
  const characterParam = typeof query.character === "string" ? query.character : null;
  const errorParam = typeof query.error === "string" ? query.error : null;
  const warningParam = typeof query.warning === "string" ? query.warning : null;
  const agents = await getAgents();

  const filtered =
    filter === "active"
      ? agents.filter((agent) => agent.status === "active")
      : filter === "paused"
        ? agents.filter((agent) => agent.status === "paused")
        : agents;

  const unassignedAgents = filtered.filter((agent) => !getCharacter(agent.characterId));
  const assignedAgents = filtered.filter((agent) => getCharacter(agent.characterId));

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
          <a href="#picker" className="btn-primary">
            ＋ New Agent
          </a>
        </div>
      </header>

      {/* 上段: 既存のエージェント */}
      <section className="panel">
        <div className="panel-title">
          <h2>編成済みエージェント ({assignedAgents.length})</h2>
        </div>
        {assignedAgents.length === 0 ? (
          <p className="text-muted">
            まだエージェントがいません。下のキャラクターから 1 体選んで編成してください。
          </p>
        ) : (
          <div className="crew-grid">
            {assignedAgents.map((agent) => {
              const character = getCharacter(agent.characterId);
              if (!character) return null;
              const summary: CrewAgentSummary = {
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
              };
              return <CrewTile key={agent.id} character={character} agent={summary} />;
            })}
          </div>
        )}
      </section>

      {/* キャラ未設定のエージェント (旧データ向け) */}
      {unassignedAgents.length > 0 ? (
        <section className="panel">
          <div className="panel-title">
            <h2>キャラ未設定のエージェント ({unassignedAgents.length})</h2>
          </div>
          <p className="mb-3 text-muted">
            既存のエージェントにキャラが未割り当てです。詳細画面の Edit
            からキャラを選択してください。
          </p>
          <div className="flex flex-col gap-2">
            {unassignedAgents.map((agent) => (
              <Link key={agent.id} href={`/agents/${agent.id}`} className="activity-row">
                <span className="character-avatar size-unassigned placeholder" aria-hidden>
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

      {/* 下段: キャラクターピッカー (モーダル起動) */}
      <div id="picker" />
      <CharacterPickerModal
        initialCharacterId={characterParam}
        initialError={errorParam}
        initialWarning={warningParam}
      />
    </section>
  );
}
