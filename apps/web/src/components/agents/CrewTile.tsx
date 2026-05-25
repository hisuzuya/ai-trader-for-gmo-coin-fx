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
};

export function CrewTile({
  character,
  agent,
}: {
  character: AgentCharacter;
  agent: CrewAgentSummary | null;
}) {
  const href = agent ? `/agents/${agent.id}` : `/agents?character=${character.id}#picker`;
  const runTotal = (agent?.succeededRunCount ?? 0) + (agent?.failedRunCount ?? 0);

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
              <dt>Version</dt>
              <dd>v{agent.currentVersion}</dd>
            </div>
            <div>
              <dt>Accept</dt>
              <dd>
                {agent.acceptedProposalCount}/{agent.proposalCount}
              </dd>
            </div>
            <div>
              <dt>Runs</dt>
              <dd>
                {agent.succeededRunCount}/{runTotal}
              </dd>
            </div>
            <div>
              <dt>Latest</dt>
              <dd>{agent.latestRunStatus ?? "none"}</dd>
            </div>
          </dl>
        ) : (
          <p className="crew-tile-cta">＋ このキャラでエージェントを作成</p>
        )}
      </div>
    </Link>
  );
}
