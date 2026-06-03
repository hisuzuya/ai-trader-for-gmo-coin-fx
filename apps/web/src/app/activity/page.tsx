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
    fetchRuns({ agentId, limit: 100 }),
    fetchProposals({ agentId, limit: 100 }),
    fetchAgents(),
  ]);
  const visibleRuns = runStatus ? runs.filter((run) => run.status === runStatus) : runs;
  const visibleProposals = proposalStatus
    ? proposals.filter((proposal) => proposal.validationStatus === proposalStatus)
    : proposals;
  const failedRunCount = runs.filter((run) => run.status !== "succeeded").length;
  const acceptedProposalCount = proposals.filter(
    (proposal) => proposal.validationStatus === "accepted",
  ).length;

  const agentMap = new Map(agents.map((agent) => [agent.id, agent]));

  return (
    <section className="page-shell">
      <header className="page-header">
        <div>
          <p className="page-kicker">Agent Activity</p>
          <h1>AIクルーの活動ログ</h1>
          <p className="page-subtitle">
            AIがいつ調査を走らせ、どの戦略案を出し、どこで止まったかを追跡します。
          </p>
        </div>
        <div className="page-actions">
          <Link
            href={buildActivityHref({ kind: "runs", agentId })}
            className={kind === "runs" ? "btn-secondary" : "btn-ghost"}
          >
            実行ログ
          </Link>
          <Link
            href={buildActivityHref({ kind: "proposals", agentId })}
            className={kind === "proposals" ? "btn-secondary" : "btn-ghost"}
          >
            戦略提案
          </Link>
        </div>
      </header>

      <section className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <ActivityMetric
          label="AI実行"
          value={runs.length}
          detail={failedRunCount > 0 ? `${failedRunCount}件に要確認` : "全件完了"}
          href={buildActivityHref({ kind: "runs", agentId })}
          active={kind === "runs"}
        />
        <ActivityMetric
          label="戦略提案"
          value={proposals.length}
          detail={`${acceptedProposalCount}件が検証通過`}
          href={buildActivityHref({ kind: "proposals", agentId })}
          active={kind === "proposals"}
        />
        <ActivityMetric
          label="表示対象"
          value={kind === "runs" ? visibleRuns.length : visibleProposals.length}
          detail={agentId ? "エージェント絞り込み中" : "直近100件"}
          href={buildActivityHref({ kind, agentId })}
          active={false}
        />
      </section>

      <section className="panel">
        <div className="panel-title">
          <div>
            <h2>{kind === "runs" ? "AI実行ログ" : "戦略提案ログ"}</h2>
            <p className="mt-1 text-xs text-muted">
              {kind === "runs"
                ? "各エージェントが市場データや記憶を参照して、観察・提案・レビューを生成した記録です。"
                : "AIが出したStrategy Definition案と、DSL検証を通過したかどうかの記録です。"}
            </p>
          </div>
          {agentId ? (
            <Link href={buildActivityHref({ kind })} className="btn-ghost">
              絞り込み解除
            </Link>
          ) : null}
        </div>

        <StatusFilters kind={kind} status={query.status} agentId={agentId} />

        {kind === "runs" ? (
          <RunList runs={visibleRuns} agentMap={agentMap} />
        ) : (
          <ProposalList proposals={visibleProposals} agentMap={agentMap} />
        )}
      </section>
    </section>
  );
}

function ActivityMetric({
  label,
  value,
  detail,
  href,
  active,
}: {
  label: string;
  value: number;
  detail: string;
  href: string;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      className={`rounded-lg border bg-surface px-4 py-3 transition-colors ${
        active ? "border-accent/70" : "border-line-soft hover:border-line"
      }`}
    >
      <div className="text-[11px] font-medium uppercase text-muted">{label}</div>
      <div className="mt-1 flex items-end justify-between gap-3">
        <strong className="font-mono text-2xl text-text-strong">{value}</strong>
        <span className="truncate text-xs text-muted">{detail}</span>
      </div>
    </Link>
  );
}

function StatusFilters({
  kind,
  status,
  agentId,
}: {
  kind: ActivityKind;
  status: string | string[] | undefined;
  agentId?: string;
}) {
  const activeStatus = typeof status === "string" ? status : undefined;
  const filters =
    kind === "runs"
      ? [
          ["succeeded", "成功"],
          ["failed", "失敗"],
          ["timeout", "タイムアウト"],
          ["rejected_output", "出力NG"],
        ]
      : [
          ["accepted", "検証通過"],
          ["rejected", "検証NG"],
        ];

  return (
    <nav className="mb-3.5 flex flex-wrap gap-2" aria-label="Activity status">
      <Link
        href={buildActivityHref({ kind, agentId })}
        className={!activeStatus ? "btn-secondary" : "btn-ghost"}
      >
        すべて
      </Link>
      {filters.map(([value, label]) => (
        <Link
          key={value}
          href={buildActivityHref({ kind, status: value, agentId })}
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
    return <p className="text-xs text-muted">現在の条件に合うAI実行ログはありません。</p>;
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
                {agent?.name ?? run.agentId.slice(0, 8)} が調査を実行
              </span>
              <span className={ACTIVITY_META_CLS}>
                開始 {formatTimestamp(run.startedAt)} · prompt v{run.agentVersion}
              </span>
              {toolSummary ? (
                <span className={ACTIVITY_TOOLS_CLS} title={toolSummary}>
                  参照した情報: {toolSummary}
                </span>
              ) : null}
              {run.error ? (
                <span className={ACTIVITY_ERROR_CLS} title={run.error}>
                  停止理由: {run.error}
                </span>
              ) : null}
            </div>
            <span className={`status-pill ${runStatusTone(run.status)}`}>
              {runStatusLabel(run.status)}
            </span>
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
    return <p className="text-xs text-muted">現在の条件に合う戦略提案ログはありません。</p>;
  }

  return (
    <div className="flex flex-col gap-2">
      {proposals.map((proposal) => {
        const agent = agentMap.get(proposal.agentId);
        const character = getCharacter(agent?.characterId);
        const metaParts = [
          `提案者 ${agent?.name ?? proposal.agentId.slice(0, 8)}`,
          `作成 ${formatTimestamp(proposal.createdAt)}`,
        ];
        if (proposal.strategyRunStatus) {
          metaParts.push(`評価状態 ${proposal.strategyRunStatus}`);
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
              {proposalStatusLabel(proposal.validationStatus)}
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

function runStatusLabel(status: RunStatus) {
  const labels: Record<RunStatus, string> = {
    succeeded: "成功",
    failed: "失敗",
    timeout: "時間切れ",
    rejected_output: "出力NG",
  };
  return labels[status];
}

function proposalStatusLabel(status: ProposalStatus) {
  return status === "accepted" ? "検証通過" : "検証NG";
}

function formatTimestamp(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
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

function buildActivityHref({
  kind,
  status,
  agentId,
}: {
  kind: ActivityKind;
  status?: string;
  agentId?: string;
}) {
  const params = new URLSearchParams({ kind });
  if (status) params.set("status", status);
  if (agentId) params.set("agentId", agentId);
  return `/activity?${params.toString()}`;
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
