import type { AgentCharacter, AgentRole } from "@ai-trade/domain/ai-agents/characters";
import Image from "next/image";
import Link from "next/link";

export type CrewAgentSummary = {
  id: string;
  name: string;
  role: AgentRole;
  status: "active" | "paused";
  currentVersion: number;
  acceptedProposalCount: number;
  proposalCount: number;
  observationCount: number;
  candidateReviewCount: number;
  appliedCandidateReviewCount: number;
  skillCurationCount: number;
  appliedSkillCurationCount: number;
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
  const role = agent?.role ?? character.defaultRole;
  const runTotal = (agent?.succeededRunCount ?? 0) + (agent?.failedRunCount ?? 0);
  const roleKpis = buildRoleKpis({ agent, role, pnlTone });

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
          <span className="crew-tile-badges">
            <span className={`role-pill role-${role}`}>{formatRoleLabel(role)}</span>
            {agent ? (
              <span className={`status-pill ${agent.status}`}>{agent.status}</span>
            ) : (
              <span className="status-pill unassigned">unassigned</span>
            )}
          </span>
        </div>
        <p className="crew-tile-tagline">{character.catchphrase}</p>
        {agent ? (
          <dl className="crew-tile-kpis">
            {roleKpis.map((kpi) => (
              <div key={kpi.label}>
                <dt>{kpi.label}</dt>
                <dd className={kpi.tone ? `tone-${kpi.tone}` : undefined}>{kpi.value}</dd>
              </div>
            ))}
            <div>
              <dt>Runs ok</dt>
              <dd>
                {agent.succeededRunCount}/{runTotal}
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

type RoleKpi = {
  label: string;
  value: string | number;
  tone?: "profit" | "loss" | "neutral";
};

function buildRoleKpis({
  agent,
  role,
  pnlTone,
}: {
  agent: CrewAgentSummary | null;
  role: AgentRole;
  pnlTone: "profit" | "loss" | "neutral" | null;
}): RoleKpi[] {
  if (!agent) return [];

  const pnlValue =
    agent.pnlJpy !== null
      ? `${agent.pnlJpy >= 0 ? "+" : ""}${formatCompactJpy(agent.pnlJpy)}`
      : "—";

  if (role === "trader") {
    return [
      {
        label: "PnL",
        value: pnlValue,
        tone: pnlTone ?? undefined,
      },
      {
        label: "Open",
        value: agent.openPositionCount ?? 0,
      },
      {
        label: "Proposals",
        value: `${agent.acceptedProposalCount}/${agent.proposalCount}`,
      },
    ];
  }

  if (role === "skill_curator") {
    return [
      {
        label: "Curations",
        value: `${agent.appliedSkillCurationCount}/${agent.skillCurationCount}`,
      },
      {
        label: "Signals",
        value: agent.observationCount,
      },
      {
        label: "Balance",
        value: agent.balanceJpy !== null ? formatCompactJpy(agent.balanceJpy) : "—",
      },
    ];
  }

  if (role === "risk_auditor") {
    return [
      {
        label: "Reviews",
        value: `${agent.appliedCandidateReviewCount}/${agent.candidateReviewCount}`,
      },
      {
        label: "Open risk",
        value: agent.openPositionCount ?? 0,
      },
      {
        label: "PnL guard",
        value: pnlValue,
        tone: pnlTone ?? undefined,
      },
    ];
  }

  return [
    {
      label: "Signals",
      value: agent.observationCount,
    },
    {
      label: "Proposals",
      value: `${agent.acceptedProposalCount}/${agent.proposalCount}`,
    },
    {
      label: "Balance",
      value: agent.balanceJpy !== null ? formatCompactJpy(agent.balanceJpy) : "—",
    },
  ];
}

function formatRoleLabel(role: AgentRole): string {
  if (role === "skill_curator") return "Skill Curator";
  if (role === "risk_auditor") return "Risk Auditor";
  if (role === "news_analyst") return "News Analyst";
  return "Trader";
}

function formatCompactJpy(value: number): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (abs >= 100_000_000) return `${sign}¥${(abs / 100_000_000).toFixed(2)}億`;
  if (abs >= 10_000) return `${sign}¥${(abs / 10_000).toFixed(1)}万`;
  return `${sign}¥${Math.round(abs).toLocaleString("ja-JP")}`;
}
