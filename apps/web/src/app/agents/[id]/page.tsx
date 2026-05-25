import { getCharacter } from "@ai-trade/domain/ai-agents/characters";
import { AGENT_RESEARCH_TOOL_NAMES } from "@ai-trade/domain/ai-agents/types";
import Link from "next/link";
import { notFound } from "next/navigation";

import { CharacterHero } from "@/components/agents/CharacterHero";

import { deleteAgentMemory, rollbackAgentVersion, saveAgentVersion } from "../actions";

export const dynamic = "force-dynamic";

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "portfolio", label: "Portfolio" },
  { id: "prompt", label: "Prompt" },
  { id: "memory", label: "Memory" },
  { id: "proposals", label: "Proposals" },
  { id: "reviews", label: "Reviews" },
  { id: "runs", label: "Runs" },
  { id: "versions", label: "Versions" },
] as const;

type TabId = (typeof TABS)[number]["id"];

type PaperAccountDetail = {
  accountId: string;
  balanceJpy: number;
  initialBalanceJpy: number;
  pnlJpy: number;
  pnlPct: number;
  openPositionCount: number;
  closedTradeCount: number;
  totalRealizedPnlJpy: number;
  openPositions: {
    id: string;
    strategyRunId: string | null;
    symbol: string;
    side: "long" | "short";
    quantity: number;
    entryPrice: number;
    openedAt: string;
    stopLossPrice: number;
    takeProfitPrice: number;
    spreadPips: number;
  }[];
  recentTrades: {
    id: string;
    strategyRunId: string | null;
    symbol: string;
    side: "long" | "short";
    quantity: number;
    entryPrice: number;
    exitPrice: number;
    pnlJpy: number;
    closeReason: string;
    openedAt: string;
    closedAt: string;
  }[];
};

type AgentDetail = {
  id: string;
  name: string;
  persona: string;
  systemPrompt: string;
  allowedTools: string[];
  status: "active" | "paused";
  currentVersion: number;
  runIntervalSec: number;
  model: string;
  maxConsecutiveFailures: number;
  consecutiveFailures: number;
  tokenBudgetPerRun: number;
  costBudgetPerRunUsd: number;
  pausedReason?: string;
  sharedMemoryEnabled: boolean;
  characterId?: string | null;
  initialBalanceJpy: number;
  paperAccount: PaperAccountDetail | null;
  observations: {
    id: string;
    kind: string;
    summary: string;
    evidence: unknown;
    tags: string[];
    createdAt: string;
  }[];
  memories: {
    id: string;
    type: string;
    content: string;
    tags: string[];
    sourceRefs: unknown;
    createdAt: string;
  }[];
  proposals: {
    id: string;
    strategyName: string;
    validationStatus: string;
    rejectionReasons: unknown;
    insertedStrategyRunId: string | null;
    strategyRunStatus: string | null;
    createdAt: string;
  }[];
  reviews: {
    id: string;
    strategyName: string;
    recommendation: string;
    confidence: string;
    reason: string;
    evidence: unknown;
    applied: boolean;
    createdAt: string;
  }[];
  runs: {
    id: string;
    agentVersion: number;
    status: string;
    outputSummary: unknown;
    toolCalls: unknown;
    tokenUsage: unknown;
    error: string | null;
    startedAt: string;
    finishedAt: string | null;
  }[];
  versions: {
    id: string;
    version: number;
    systemPrompt: string;
    allowedTools: string[];
    note: string | null;
    createdAt: string;
  }[];
};

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

async function getAgent(id: string): Promise<AgentDetail | null> {
  const response = await fetch(
    new URL(`/agents/${id}`, process.env.WORKER_INTERNAL_URL ?? "http://localhost:8787"),
    { cache: "no-store" },
  ).catch(() => null);

  if (!response?.ok) return null;
  const body = (await response.json()) as { agent?: AgentDetail };
  return body.agent ?? null;
}

function isTab(value: unknown): value is TabId {
  return typeof value === "string" && TABS.some((t) => t.id === value);
}

export default async function AgentDetailPage({ params, searchParams }: PageProps) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const agent = await getAgent(id);
  if (!agent) notFound();

  const activeTab: TabId = isTab(query.tab) ? query.tab : "overview";
  const saveAction = saveAgentVersion.bind(null, agent.id);
  const rollbackAction = rollbackAgentVersion.bind(null, agent.id);
  const deleteMemoryAction = deleteAgentMemory.bind(null, agent.id);
  const character = getCharacter(agent.characterId);

  const saved = query.saved === "1";
  const created = query.created === "1";
  const rolledBack = query.rolledBack === "1";
  const memoryDeleted = query.memoryDeleted === "1";
  const warningSecret = query.warning === "secret_like";
  const errorEmpty = query.error === "empty_prompt";
  const errorSave = query.error === "save_failed";

  const totalRuns = agent.runs.length;
  const succeededRuns = agent.runs.filter((run) => run.status === "succeeded").length;
  const acceptedProposals = agent.proposals.filter((p) => p.validationStatus === "accepted").length;
  const totalProposals = agent.proposals.length;
  const account = agent.paperAccount;
  const pnlTone: "profit" | "loss" | "neutral" = account
    ? account.pnlJpy > 0
      ? "profit"
      : account.pnlJpy < 0
        ? "loss"
        : "neutral"
    : "neutral";
  const balanceLabel = account ? formatJpy(account.balanceJpy) : "—";
  const pnlLabel = account
    ? `${account.pnlJpy >= 0 ? "+" : ""}${formatJpy(account.pnlJpy)} (${
        account.pnlPct >= 0 ? "+" : ""
      }${account.pnlPct.toFixed(2)}%)`
    : "—";

  return (
    <section className="page-shell">
      <div className="flex items-center justify-between">
        <Link href="/agents" className="btn-ghost">
          ← Agents
        </Link>
        <div className="flex gap-1.5">
          {created ? <span className="panel-toast">Created</span> : null}
          {saved ? <span className="panel-toast">Saved</span> : null}
          {rolledBack ? <span className="panel-toast">Rolled back</span> : null}
          {memoryDeleted ? <span className="panel-toast">Memory deleted</span> : null}
          {warningSecret ? (
            <span className="panel-toast warn">
              シークレットを検出。削除してから保存してください
            </span>
          ) : null}
          {errorEmpty ? <span className="panel-toast warn">Prompt is empty</span> : null}
          {errorSave ? <span className="panel-toast warn">保存に失敗しました</span> : null}
          <Link href={`/agents/${agent.id}/edit`} className="btn-secondary">
            Edit settings
          </Link>
        </div>
      </div>

      <CharacterHero
        character={character}
        agentName={agent.name}
        persona={agent.persona}
        status={agent.status}
        version={agent.currentVersion}
        pausedReason={agent.pausedReason}
        kpis={[
          { label: "Balance", value: balanceLabel },
          { label: "PnL", value: pnlLabel, tone: pnlTone },
          {
            label: "Open positions",
            value: account ? String(account.openPositionCount) : "—",
          },
          { label: "Runs ok", value: `${succeededRuns}/${totalRuns}` },
          {
            label: "Accept",
            value: `${acceptedProposals}/${totalProposals}`,
          },
          { label: "Interval", value: `${agent.runIntervalSec}s` },
        ]}
      />

      <nav className="tabs-nav" aria-label="Agent sections">
        {TABS.map((tab) => (
          <Link
            key={tab.id}
            href={`/agents/${agent.id}?tab=${tab.id}`}
            className={activeTab === tab.id ? "active" : ""}
          >
            {tab.label}
          </Link>
        ))}
      </nav>

      {activeTab === "overview" ? <OverviewPanel agent={agent} /> : null}
      {activeTab === "portfolio" ? <PortfolioPanel agent={agent} /> : null}
      {activeTab === "prompt" ? <PromptPanel agent={agent} action={saveAction} /> : null}
      {activeTab === "memory" ? <MemoryPanel agent={agent} action={deleteMemoryAction} /> : null}
      {activeTab === "proposals" ? <ProposalsPanel agent={agent} /> : null}
      {activeTab === "reviews" ? <ReviewsPanel agent={agent} /> : null}
      {activeTab === "runs" ? <RunsPanel agent={agent} /> : null}
      {activeTab === "versions" ? <VersionsPanel agent={agent} action={rollbackAction} /> : null}
    </section>
  );
}

function OverviewPanel({ agent }: { agent: AgentDetail }) {
  return (
    <>
      <section className="panel">
        <div className="panel-title">
          <h2>Latest observations</h2>
          <Link href={`/agents/${agent.id}?tab=runs`} className="btn-ghost">
            See runs →
          </Link>
        </div>
        {agent.observations.slice(0, 3).map((obs) => (
          <div key={obs.id} className="activity-row">
            <span className="meta-pill subtle">{obs.kind}</span>
            <div>
              <div className="activity-row-title">{obs.summary}</div>
              <div className="activity-row-meta">{obs.createdAt}</div>
            </div>
            <span className="activity-row-status">{obs.tags.slice(0, 2).join(", ")}</span>
          </div>
        ))}
        {agent.observations.length === 0 ? (
          <p className="text-muted">No observations yet.</p>
        ) : null}
      </section>

      <section className="panel">
        <div className="panel-title">
          <h2>Recent proposals</h2>
          <Link href={`/proposals?agentId=${agent.id}`} className="btn-ghost">
            See all →
          </Link>
        </div>
        {agent.proposals.slice(0, 3).map((p) => (
          <div key={p.id} className="activity-row">
            <span
              className={`status-pill ${p.validationStatus === "accepted" ? "active" : "paused"}`}
            >
              {p.validationStatus}
            </span>
            <div>
              <div className="activity-row-title">{p.strategyName}</div>
              <div className="activity-row-meta">{p.createdAt}</div>
            </div>
            <span className="activity-row-status">{p.strategyRunStatus ?? "-"}</span>
          </div>
        ))}
        {agent.proposals.length === 0 ? <p className="text-muted">No proposals yet.</p> : null}
      </section>

      <section className="panel">
        <div className="panel-title">
          <h2>Candidate reviews</h2>
        </div>
        {agent.reviews.slice(0, 3).map((r) => (
          <div key={r.id} className="activity-row">
            <span className="meta-pill">{r.recommendation}</span>
            <div>
              <div className="activity-row-title">{r.strategyName}</div>
              <div className="activity-row-meta">{r.reason}</div>
            </div>
            <span className="activity-row-status">{r.confidence}</span>
          </div>
        ))}
        {agent.reviews.length === 0 ? <p className="text-muted">No reviews yet.</p> : null}
      </section>
    </>
  );
}

function PromptPanel({
  agent,
  action,
}: {
  agent: AgentDetail;
  action: (formData: FormData) => void;
}) {
  return (
    <section className="panel">
      <div className="panel-title">
        <h2>System prompt</h2>
        <span className="meta-pill subtle">v{agent.currentVersion}</span>
      </div>
      <form action={action} className="prompt-form">
        <textarea name="systemPrompt" defaultValue={agent.systemPrompt} required />
        <div>
          <p className="mb-1.5 text-[11px] uppercase tracking-[0.08em] text-subtle">
            Allowed tools
          </p>
          <div className="tool-chips">
            {AGENT_RESEARCH_TOOL_NAMES.map((tool) => (
              <label key={tool}>
                <input
                  type="checkbox"
                  name="allowedTools"
                  value={tool}
                  defaultChecked={agent.allowedTools.includes(tool)}
                />
                <span>{tool}</span>
              </label>
            ))}
          </div>
        </div>
        <input name="note" placeholder="Version note (optional)" />
        <div className="flex gap-2">
          <button type="submit" className="btn-primary">
            Save new version
          </button>
        </div>
      </form>
    </section>
  );
}

function MemoryPanel({
  agent,
  action,
}: {
  agent: AgentDetail;
  action: (formData: FormData) => void;
}) {
  return (
    <section className="panel">
      <div className="panel-title">
        <h2>Memories ({agent.memories.length})</h2>
      </div>
      {agent.memories.length === 0 ? <p className="text-muted">No memories yet.</p> : null}
      {agent.memories.map((m) => (
        <article key={m.id} className="memory-card">
          <header>
            <span>{m.type}</span>
            <span>{m.createdAt}</span>
          </header>
          <pre>{m.content}</pre>
          <form action={action}>
            <input type="hidden" name="memoryId" value={m.id} />
            <button type="submit">Delete</button>
          </form>
        </article>
      ))}
    </section>
  );
}

function ProposalsPanel({ agent }: { agent: AgentDetail }) {
  return (
    <section className="panel">
      <div className="panel-title">
        <h2>Proposals (latest {agent.proposals.length})</h2>
        <Link href={`/proposals?agentId=${agent.id}`} className="btn-ghost">
          See all →
        </Link>
      </div>
      {agent.proposals.map((p) => (
        <div key={p.id} className="activity-row">
          <span
            className={`status-pill ${p.validationStatus === "accepted" ? "active" : "paused"}`}
          >
            {p.validationStatus}
          </span>
          <div>
            <div className="activity-row-title">{p.strategyName}</div>
            <div className="activity-row-meta">{p.createdAt}</div>
          </div>
          <span className="activity-row-status">{p.strategyRunStatus ?? "-"}</span>
        </div>
      ))}
      {agent.proposals.length === 0 ? <p className="text-muted">No proposals yet.</p> : null}
    </section>
  );
}

function ReviewsPanel({ agent }: { agent: AgentDetail }) {
  return (
    <section className="panel">
      <div className="panel-title">
        <h2>Reviews (latest {agent.reviews.length})</h2>
      </div>
      {agent.reviews.map((r) => (
        <div key={r.id} className="activity-row">
          <span className="meta-pill">{r.recommendation}</span>
          <div>
            <div className="activity-row-title">{r.strategyName}</div>
            <div className="activity-row-meta">{r.reason}</div>
          </div>
          <span className="activity-row-status">{r.confidence}</span>
        </div>
      ))}
      {agent.reviews.length === 0 ? <p className="text-muted">No reviews yet.</p> : null}
    </section>
  );
}

function RunsPanel({ agent }: { agent: AgentDetail }) {
  return (
    <section className="panel">
      <div className="panel-title">
        <h2>Runs (latest {agent.runs.length})</h2>
        <Link href={`/runs?agentId=${agent.id}`} className="btn-ghost">
          See all →
        </Link>
      </div>
      {agent.runs.map((run) => (
        <div key={run.id} className="activity-row">
          <span className={`status-pill ${run.status === "succeeded" ? "active" : "paused"}`}>
            {run.status}
          </span>
          <div>
            <div className="activity-row-title">v{run.agentVersion}</div>
            <div className="activity-row-meta">{run.startedAt}</div>
          </div>
          <span className="activity-row-status">{run.error ? "error" : "ok"}</span>
        </div>
      ))}
      {agent.runs.length === 0 ? <p className="text-muted">No runs yet.</p> : null}
    </section>
  );
}

function VersionsPanel({
  agent,
  action,
}: {
  agent: AgentDetail;
  action: (formData: FormData) => void;
}) {
  return (
    <section className="panel">
      <div className="panel-title">
        <h2>Versions ({agent.versions.length})</h2>
      </div>
      {agent.versions.map((version) => (
        <article key={version.id} className="memory-card">
          <header>
            <strong>v{version.version}</strong>
            <span>{version.createdAt}</span>
          </header>
          {version.note ? <p className="mb-1.5 text-xs text-muted">{version.note}</p> : null}
          <pre>
            {version.systemPrompt.slice(0, 300)}
            {version.systemPrompt.length > 300 ? "..." : ""}
          </pre>
          <form action={action}>
            <input type="hidden" name="sourceVersion" value={version.version} />
            <button type="submit" disabled={version.version === agent.currentVersion}>
              {version.version === agent.currentVersion ? "Current" : "Rollback as new version"}
            </button>
          </form>
        </article>
      ))}
    </section>
  );
}

function PortfolioPanel({ agent }: { agent: AgentDetail }) {
  const account = agent.paperAccount;
  if (!account) {
    return (
      <section className="panel">
        <div className="panel-title">
          <h2>Paper account</h2>
        </div>
        <p className="text-muted">
          このエージェントには専用のペーパー口座がまだ作成されていません。
          {agent.initialBalanceJpy
            ? ` 初期資金は ${formatJpy(agent.initialBalanceJpy)} の設定です。`
            : ""}
        </p>
      </section>
    );
  }

  const pnlTone = account.pnlJpy > 0 ? "profit" : account.pnlJpy < 0 ? "loss" : "neutral";

  return (
    <>
      <section className="panel">
        <div className="panel-title">
          <h2>Paper account summary</h2>
          <span className="meta-pill subtle">{account.accountId.slice(0, 8)}</span>
        </div>
        <div className="portfolio-summary-grid">
          <div className="portfolio-summary-cell">
            <span>Balance</span>
            <strong>{formatJpy(account.balanceJpy)}</strong>
          </div>
          <div className="portfolio-summary-cell">
            <span>Initial</span>
            <strong>{formatJpy(account.initialBalanceJpy)}</strong>
          </div>
          <div className="portfolio-summary-cell">
            <span>Unrealized + Realized PnL</span>
            <strong className={`tone-${pnlTone}`}>
              {account.pnlJpy >= 0 ? "+" : ""}
              {formatJpy(account.pnlJpy)} ({account.pnlPct >= 0 ? "+" : ""}
              {account.pnlPct.toFixed(2)}%)
            </strong>
          </div>
          <div className="portfolio-summary-cell">
            <span>Open positions</span>
            <strong>{account.openPositionCount}</strong>
          </div>
          <div className="portfolio-summary-cell">
            <span>Closed trades (latest 20)</span>
            <strong>{account.closedTradeCount}</strong>
          </div>
          <div className="portfolio-summary-cell">
            <span>Realized (latest 20)</span>
            <strong
              className={
                account.totalRealizedPnlJpy > 0
                  ? "tone-profit"
                  : account.totalRealizedPnlJpy < 0
                    ? "tone-loss"
                    : undefined
              }
            >
              {account.totalRealizedPnlJpy >= 0 ? "+" : ""}
              {formatJpy(account.totalRealizedPnlJpy)}
            </strong>
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-title">
          <h2>Open positions ({account.openPositionCount})</h2>
        </div>
        {account.openPositions.length === 0 ? (
          <p className="text-muted">現在オープン中のポジションはありません。</p>
        ) : (
          <table className="portfolio-table">
            <thead>
              <tr>
                <th>Symbol</th>
                <th>Side</th>
                <th>Qty</th>
                <th>Entry</th>
                <th>SL / TP</th>
                <th>Opened</th>
                <th>Strategy</th>
              </tr>
            </thead>
            <tbody>
              {account.openPositions.map((pos) => (
                <tr key={pos.id}>
                  <td>{pos.symbol}</td>
                  <td>
                    <span className={`status-pill ${pos.side === "long" ? "active" : "paused"}`}>
                      {pos.side}
                    </span>
                  </td>
                  <td>{pos.quantity}</td>
                  <td>{pos.entryPrice.toFixed(3)}</td>
                  <td>
                    {pos.stopLossPrice.toFixed(3)} / {pos.takeProfitPrice.toFixed(3)}
                  </td>
                  <td>{pos.openedAt.slice(0, 19).replace("T", " ")}</td>
                  <td>{pos.strategyRunId ? pos.strategyRunId.slice(0, 8) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="panel">
        <div className="panel-title">
          <h2>Recent trades ({account.closedTradeCount})</h2>
        </div>
        {account.recentTrades.length === 0 ? (
          <p className="text-muted">確定済みのトレードはまだありません。</p>
        ) : (
          <table className="portfolio-table">
            <thead>
              <tr>
                <th>Closed</th>
                <th>Symbol</th>
                <th>Side</th>
                <th>Entry → Exit</th>
                <th>PnL</th>
                <th>Reason</th>
              </tr>
            </thead>
            <tbody>
              {account.recentTrades.map((trade) => (
                <tr key={trade.id}>
                  <td>{trade.closedAt.slice(0, 19).replace("T", " ")}</td>
                  <td>{trade.symbol}</td>
                  <td>
                    <span className={`status-pill ${trade.side === "long" ? "active" : "paused"}`}>
                      {trade.side}
                    </span>
                  </td>
                  <td>
                    {trade.entryPrice.toFixed(3)} → {trade.exitPrice.toFixed(3)}
                  </td>
                  <td
                    className={
                      trade.pnlJpy > 0 ? "tone-profit" : trade.pnlJpy < 0 ? "tone-loss" : undefined
                    }
                  >
                    {trade.pnlJpy >= 0 ? "+" : ""}
                    {formatJpy(trade.pnlJpy)}
                  </td>
                  <td>{trade.closeReason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}

function formatJpy(value: number): string {
  return `¥${Math.round(value).toLocaleString("ja-JP")}`;
}
