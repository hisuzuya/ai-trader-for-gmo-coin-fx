import type { AgentCharacter } from "@ai-trade/domain/ai-agents/characters";
import Image from "next/image";
import Link from "next/link";

export type CrewAgentSummary = {
  id: string;
  name: string;
  status: "active" | "paused";
  currentVersion: number;
  acceptedProposalCount: number;
  proposalCount: number;
  succeededRunCount: number;
  failedRunCount: number;
  latestRunStatus: string | null;
  balanceJpy: number | null;
  initialBalanceJpy: number | null;
  pnlJpy: number | null;
  openPositionCount: number | null;
};

export function CrewTile({
  character,
  agent,
}: {
  character: AgentCharacter;
  agent: CrewAgentSummary | null;
}) {
  const href = agent ? `/agents/${agent.id}` : `/agents?character=${character.id}#picker`;
  const pnlTone =
    agent?.pnlJpy !== null && agent?.pnlJpy !== undefined
      ? agent.pnlJpy > 0
        ? "profit"
        : agent.pnlJpy < 0
          ? "loss"
          : "neutral"
      : null;

  return (
    <Link
      href={href}
      className={`crew-tile character-theme-${character.id}${agent ? "" : " unassigned"}`}
      data-character-id={character.id}
    >
      <div className="crew-tile-portrait">
        <Image
          src={character.imagePath}
          alt={`${character.name} portrait`}
          width={240}
          height={320}
          unoptimized
        />
        <span className="crew-tile-codename" aria-hidden>
          {character.codename}
        </span>
      </div>
      <div className="crew-tile-body">
        <div className="crew-tile-head">
          <span className="crew-tile-name">
            {character.nameJa}
            <small className="ml-1.5 font-normal text-muted">{character.name}</small>
          </span>
          {agent ? (
            <span className={`status-pill ${agent.status}`}>{agent.status}</span>
          ) : (
            <span className="status-pill unassigned">unassigned</span>
          )}
        </div>
        <p className="crew-tile-tagline">{character.catchphrase}</p>
        {agent ? (
          <dl className="crew-tile-kpis">
            <div>
              <dt>Balance</dt>
              <dd>{agent.balanceJpy !== null ? formatCompactJpy(agent.balanceJpy) : "—"}</dd>
            </div>
            <div>
              <dt>PnL</dt>
              <dd className={pnlTone ? `tone-${pnlTone}` : undefined}>
                {agent.pnlJpy !== null
                  ? `${agent.pnlJpy >= 0 ? "+" : ""}${formatCompactJpy(agent.pnlJpy)}`
                  : "—"}
              </dd>
            </div>
            <div>
              <dt>Open</dt>
              <dd>{agent.openPositionCount ?? 0}</dd>
            </div>
            <div>
              <dt>Runs ok</dt>
              <dd>
                {agent.succeededRunCount}/{agent.succeededRunCount + agent.failedRunCount}
              </dd>
            </div>
          </dl>
        ) : (
          <p className="crew-tile-cta">＋ このキャラでエージェントを作成</p>
        )}
      </div>
    </Link>
  );
}

function formatCompactJpy(value: number): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (abs >= 100_000_000) return `${sign}¥${(abs / 100_000_000).toFixed(2)}億`;
  if (abs >= 10_000) return `${sign}¥${(abs / 10_000).toFixed(1)}万`;
  return `${sign}¥${Math.round(abs).toLocaleString("ja-JP")}`;
}
