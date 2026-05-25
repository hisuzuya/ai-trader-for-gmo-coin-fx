import type { AgentCharacter } from "@ai-trade/domain/ai-agents/characters";
import Image from "next/image";

export function CharacterHero({
  character,
  agentName,
  persona,
  status,
  version,
  kpis,
  pausedReason,
}: {
  character: AgentCharacter | null;
  agentName: string;
  persona: string;
  status: "active" | "paused";
  version: number;
  kpis: { label: string; value: string }[];
  pausedReason?: string | null;
}) {
  const tagline = character?.catchphrase ?? persona;

  return (
    <section
      className={`character-hero ${character ? `character-theme-${character.id}` : ""}`}
      data-character-id={character?.id ?? "unassigned"}
    >
      <div className="character-hero-art">
        {character ? (
          <Image
            src={character.imagePath}
            alt={`${character.name} portrait`}
            width={420}
            height={560}
            className="character-hero-image"
            priority
            unoptimized
          />
        ) : (
          <div className="character-hero-image-placeholder" aria-hidden>
            <span>?</span>
          </div>
        )}
        <span className="character-hero-codename" aria-hidden>
          {character?.codename ?? "—"}
        </span>
      </div>
      <div className="character-hero-info">
        <p className="character-hero-kicker">
          {character ? `${character.nameJa} · ${character.name}` : "Unassigned"}
          {character ? ` · ${character.type}` : ""}
        </p>
        <h1 className="character-hero-name">{agentName}</h1>
        <p className="character-hero-tagline">{tagline}</p>
        <div className="character-hero-pills">
          <span className={`status-pill ${status}`}>{status}</span>
          <span className="meta-pill">v{version}</span>
          {character?.recommendedFocus.map((focus) => (
            <span key={focus} className="meta-pill subtle">
              {focus}
            </span>
          ))}
        </div>
        {pausedReason ? <p className="character-hero-paused">{pausedReason}</p> : null}
        <dl className="character-hero-kpis">
          {kpis.map((kpi) => (
            <div key={kpi.label}>
              <dt>{kpi.label}</dt>
              <dd>{kpi.value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
