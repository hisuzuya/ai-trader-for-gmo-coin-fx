import { getCharacter } from "@ai-trade/domain/ai-agents/characters";
import type { UTCTimestamp } from "lightweight-charts";
import Image from "next/image";
import Link from "next/link";
import { type AgentSummaryRaw, fetchAgentSummaries } from "@/components/agents/CrewPanelSection";
import { DailyPnlCalendar, type DailyPnlEntry } from "@/components/DailyPnlCalendar";
import { PnlChart, type PnlPoint } from "@/components/PnlChart";
import { appRouter } from "@/server/trpc/root";

export const dynamic = "force-dynamic";

type AccountDetail = {
  name: string;
  balanceJpy: string;
  initialBalanceJpy: string;
  openPositions: {
    symbol: string;
    side: string;
    quantity: string;
    entryPrice: string;
    stopLossPrice: string;
    takeProfitPrice: string;
    bestPriceSinceOpen: string;
    spreadPips: string;
    openedAt: string;
  }[];
  strategyRun: {
    id: string;
    strategyName: string;
    symbol: string;
    timeframe: string;
    status: string;
    startedAt: string;
    strategyDefinition: unknown;
  } | null;
};

type OpenPositionRow = {
  id: string;
  accountId: string;
  accountName: string;
  agentId: string | null;
  agentName: string | null;
  characterId: string | null;
  symbol: string;
  side: "long" | "short";
  quantity: string;
  entryPrice: string;
  stopLossPrice: string;
  takeProfitPrice: string;
  bestPriceSinceOpen: string;
  spreadPips: string;
  currentPrice: string | null;
  unrealizedPnlJpy: string | null;
  openedAt: string;
};

type AgentBriefingRow = {
  agentId: string;
  agentName: string;
  characterId: string | null;
  status: string;
  todayRealizedPnlJpy: string;
  todayUnrealizedPnlJpy: string;
  todayTradeCount: number;
  todayWinCount: number;
  openPositionCount: number;
  latestRun: {
    id: string;
    startedAt: string;
    finishedAt: string | null;
    status: string;
    observations: { kind: string; summary: string; tags: string[] }[];
    proposals: { strategyName: string; validationStatus: string }[];
  } | null;
  dailyFeedback: string | null;
};

type DashboardSummary = {
  selectedAccountName: string | null;
  accounts: {
    name: string;
    balanceJpy: string;
    status: string;
    updatedAt: string;
  }[];
  trades: {
    symbol: string;
    side: string;
    pnlJpy: string;
    closedAt: string;
  }[];
  candidates: {
    id: string;
    sourceStrategyName: string;
    candidateStrategyName: string | null;
    status: string;
    strategyRunStatus: string | null;
    timeframe: string;
    createdAt: string;
  }[];
  dailyReviews: {
    reviewDate: string;
    status: string;
    summary: string | null;
    baselinePromotionCandidates: unknown;
    candidateRetirementCandidates: unknown;
    warnings: unknown;
    nextActions: unknown;
    createdAt: string;
  }[];
  dailyPnl: {
    date: string;
    pnlJpy: string;
    tradeCount: number;
    winCount: number;
    accounts: {
      accountId: string;
      accountName: string;
      agentId: string | null;
      agentName: string | null;
      characterId: string | null;
      pnlJpy: string;
      tradeCount: number;
      winCount: number;
    }[];
  }[];
  openPositions: OpenPositionRow[];
  agentBriefings: AgentBriefingRow[];
  accountDetail: AccountDetail | null;
};

const EMPTY_DASHBOARD: DashboardSummary = {
  selectedAccountName: null,
  accounts: [],
  trades: [],
  candidates: [],
  dailyReviews: [],
  dailyPnl: [],
  openPositions: [],
  agentBriefings: [],
  accountDetail: null,
};

async function getHealth() {
  const caller = appRouter.createCaller({});
  return caller.health();
}

async function getDashboardSummary(accountName?: string): Promise<DashboardSummary> {
  const baseUrl = process.env.WORKER_INTERNAL_URL ?? "http://localhost:8787";
  const url = new URL("/dashboard", baseUrl);
  if (accountName) {
    url.searchParams.set("account", accountName);
  }
  const response = await fetch(url, { cache: "no-store" }).catch(() => null);

  if (!response?.ok) {
    return EMPTY_DASHBOARD;
  }

  const body = (await response.json()) as { summary?: Partial<DashboardSummary> };
  const summary = body.summary ?? {};

  return {
    selectedAccountName: summary.selectedAccountName ?? null,
    accounts: Array.isArray(summary.accounts) ? summary.accounts : [],
    trades: Array.isArray(summary.trades) ? summary.trades : [],
    candidates: Array.isArray(summary.candidates) ? summary.candidates : [],
    dailyReviews: Array.isArray(summary.dailyReviews) ? summary.dailyReviews : [],
    dailyPnl: Array.isArray(summary.dailyPnl) ? summary.dailyPnl : [],
    openPositions: Array.isArray(summary.openPositions) ? summary.openPositions : [],
    agentBriefings: Array.isArray(summary.agentBriefings) ? summary.agentBriefings : [],
    accountDetail: summary.accountDetail ?? null,
  };
}

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const SECTION_CLS = "flex flex-col gap-3.5";
const SECTION_HEAD_CLS = "flex flex-wrap items-end justify-between gap-4";
const KICKER_CLS =
  "inline-flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.18em] text-muted before:inline-block before:h-px before:w-[18px] before:bg-accent-strong before:content-['']";
const SECTION_TITLE_CLS = "text-lg font-semibold text-text-strong tracking-tight";
const SECTION_DESC_CLS = "max-w-[64ch] text-xs leading-relaxed text-muted";
const CARD_CLS =
  "flex min-w-0 flex-col overflow-hidden rounded-2xl border border-line bg-bg-elevated";
const CARD_HEAD_CLS =
  "flex items-center justify-between gap-2 border-b border-line bg-linear-to-b from-surface to-bg-elevated px-4 py-3";
const CARD_HEAD_TITLE_CLS =
  "inline-flex items-center gap-2 text-xs font-bold tracking-wide text-text-strong before:h-3.5 before:w-[3px] before:rounded-sm before:bg-accent before:content-['']";
const CARD_HEAD_META_CLS =
  "inline-flex items-center gap-1.5 font-mono text-[10px] font-semibold tracking-wide text-muted";
const META_CHIP_CLS = "rounded-full bg-surface px-2 py-0.5 text-text";
const CARD_BODY_CLS = "flex min-h-0 flex-col gap-3 p-4";
const KPI_LABEL_CLS = "text-[10px] font-bold uppercase tracking-[0.1em] text-muted";
const KPI_VALUE_CLS =
  "truncate font-mono text-[22px] font-semibold tracking-tight text-text-strong tabular-nums";
const EMPTY_CLS =
  "grid min-h-[160px] place-items-center rounded-xl border border-dashed border-line p-5 text-center text-xs text-muted";

export default async function DashboardPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const rawAccount = params.account;
  const accountParam =
    typeof rawAccount === "string" && rawAccount.trim().length > 0
      ? rawAccount.trim()
      : Array.isArray(rawAccount) && typeof rawAccount[0] === "string"
        ? rawAccount[0]
        : undefined;

  const [health, dashboard, agentSummaries] = await Promise.all([
    getHealth(),
    getDashboardSummary(accountParam),
    fetchAgentSummaries(),
  ]);
  const selectedAccountName = dashboard.selectedAccountName;
  const isAccountView = selectedAccountName !== null;
  const totalBalance = agentSummaries.reduce(
    (sum, agent) => sum + (agent.paperAccount?.balanceJpy ?? 0),
    0,
  );
  const totalInitialBalance = agentSummaries.reduce(
    (sum, agent) => sum + (agent.paperAccount?.initialBalanceJpy ?? 0),
    0,
  );
  const totalUnrealizedPnl = totalBalance - totalInitialBalance;
  const totalUnrealizedPnlPct =
    totalInitialBalance > 0 ? (totalUnrealizedPnl / totalInitialBalance) * 100 : 0;
  const totalOpenPositions = dashboard.openPositions.length;
  const totalOpenUnrealizedPnl = dashboard.openPositions.reduce(
    (sum, p) => sum + (p.unrealizedPnlJpy !== null ? Number(p.unrealizedPnlJpy) : 0),
    0,
  );
  const activeAgents = agentSummaries.filter((agent) => agent.status === "active").length;
  const totalPnl = dashboard.trades.reduce((sum, trade) => sum + Number(trade.pnlJpy), 0);
  const winningTrades = dashboard.trades.filter((trade) => Number(trade.pnlJpy) > 0).length;
  const winRate = dashboard.trades.length > 0 ? (winningTrades / dashboard.trades.length) * 100 : 0;
  const pnlSeries = buildPnlSeries(dashboard.trades);
  const pnlPositive = totalPnl >= 0;
  const dailyPnlEntries: DailyPnlEntry[] = dashboard.dailyPnl.map((entry) => ({
    date: entry.date,
    pnlJpy: Number(entry.pnlJpy),
    tradeCount: entry.tradeCount,
    winCount: entry.winCount,
    accounts: entry.accounts.map((account) => {
      const character = getCharacter(account.characterId);
      return {
        accountId: account.accountId,
        accountName: account.accountName,
        agentName: account.agentName,
        pnlJpy: Number(account.pnlJpy),
        tradeCount: account.tradeCount,
        characterId: character?.id ?? null,
        avatarPath: character?.avatarPath ?? character?.imagePath ?? null,
        displayName: character?.nameJa ?? account.agentName ?? account.accountName,
      };
    }),
  }));
  const topPerformers = [...agentSummaries]
    .filter((agent) => agent.paperAccount !== null)
    .sort((a, b) => (b.paperAccount?.pnlJpy ?? 0) - (a.paperAccount?.pnlJpy ?? 0))
    .slice(0, 3);
  const topMaxBalance = Math.max(...topPerformers.map((a) => a.paperAccount?.balanceJpy ?? 0), 1);

  return (
    <div className="mx-auto flex w-full max-w-[1480px] flex-col gap-7 px-4 pt-6 pb-14 sm:px-6 lg:px-9">
      {/* === Hero =========================================================== */}
      <section
        aria-label="ダッシュボード概要"
        className="relative grid grid-cols-1 gap-4 overflow-hidden rounded-2xl border border-accent/30 bg-linear-to-b from-surface to-bg-elevated p-5 lg:grid-cols-[minmax(0,1.6fr)_minmax(280px,1fr)]"
        style={{
          backgroundImage:
            "radial-gradient(circle at 0% 0%, rgb(41 98 255 / 0.22), transparent 55%), radial-gradient(circle at 100% 0%, rgb(38 166 154 / 0.14), transparent 55%), linear-gradient(180deg, var(--color-surface) 0%, var(--color-bg-elevated) 100%)",
        }}
      >
        <div className="flex min-w-0 flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className={KICKER_CLS}>AI Crew Overview · USD/JPY · Paper · いま現在</p>
            <div className="inline-flex items-center gap-3.5">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface-muted px-2.5 py-1 text-[11px] text-muted">
                <span className={`tv-status-dot ${health.ok ? "live" : "danger"}`} />
                <span>Worker</span>
                <strong className={health.ok ? "text-profit-strong" : "text-loss-strong"}>
                  {health.ok ? "CONNECTED" : "DEGRADED"}
                </strong>
              </span>
              <span className="font-mono text-[11px] text-muted">
                {formatDateTime(health.timestamp)}
              </span>
            </div>
          </div>

          <div>
            <h1 className="text-[clamp(22px,2.4vw,30px)] font-semibold leading-tight tracking-tight text-text-strong">
              本日の{" "}
              <strong className="bg-linear-to-r from-accent-strong to-profit-strong bg-clip-text font-bold text-transparent">
                AIクルー
              </strong>{" "}
              全体ステータス
            </h1>
            <p className="mt-2 max-w-[56ch] text-[13px] leading-relaxed text-muted">
              {agentSummaries.length}体のクルーがUSD/JPYのペーパー取引を運用中。
              「いま現在」の口座状態と保有ポジションを上に、確定パフォーマンスは下に表示します。
            </p>
          </div>

          <dl className="mt-auto grid grid-cols-1 gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-3">
            <KpiCell
              label="Crew Equity"
              value={formatJpy(totalBalance)}
              foot={`Initial ${formatJpy(totalInitialBalance)}`}
            />
            <KpiCell
              label="Unrealized PnL"
              value={formatJpySigned(totalUnrealizedPnl)}
              tone={totalUnrealizedPnl > 0 ? "profit" : totalUnrealizedPnl < 0 ? "loss" : undefined}
              spark={`${totalUnrealizedPnlPct >= 0 ? "+" : "−"}${Math.abs(
                totalUnrealizedPnlPct,
              ).toFixed(2)}%`}
              sparkTone={totalUnrealizedPnl >= 0 ? "profit" : "loss"}
            />
            <KpiCell
              label="Open Positions"
              value={`${totalOpenPositions}`}
              tone="accent"
              foot={`${activeAgents}/${agentSummaries.length} active · 含み ${formatJpySigned(totalOpenUnrealizedPnl)}`}
            />
          </dl>
        </div>

        {/* Hero right column: Top Crew */}
        <aside
          aria-label="トップ成績エージェント"
          className="flex min-w-0 flex-col gap-2.5 rounded-xl border border-line bg-bg/60 p-4"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-text-strong before:inline-block before:size-1.5 before:rounded-full before:bg-accent-strong before:shadow-[0_0_8px_var(--color-accent-strong)] before:content-['']">
              Top Crew
            </span>
            <Link className="btn-ghost" href="/agents">
              管理 →
            </Link>
          </div>
          {topPerformers.length === 0 ? (
            <p className="text-xs text-muted">
              ペーパー口座を持つエージェントがまだいません。
              <br />
              <Link className="text-accent-strong" href="/agents#picker">
                ＋ クルーを配属する →
              </Link>
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {topPerformers.map((agent) => {
                const character = getCharacter(agent.characterId);
                const pnl = agent.paperAccount?.pnlJpy ?? 0;
                const balance = agent.paperAccount?.balanceJpy ?? 0;
                const initial = agent.paperAccount?.initialBalanceJpy ?? 0;
                const pct = (balance / topMaxBalance) * 100;
                const fillGradient =
                  pnl < 0
                    ? "linear-gradient(90deg, var(--color-warning) 0%, var(--color-loss-strong) 100%)"
                    : pnl === 0
                      ? "var(--color-surface-strong)"
                      : "linear-gradient(90deg, var(--color-accent) 0%, var(--color-profit-strong) 100%)";
                return (
                  <Link
                    key={agent.id}
                    href={`/agents/${agent.id}`}
                    className="grid grid-cols-[20px_72px_1fr_auto] items-center gap-2 text-[11px] hover:text-text-strong"
                    aria-label={`${agent.name} の口座`}
                  >
                    <FaceIcon
                      avatarPath={character?.avatarPath}
                      alt={character?.name ?? agent.name}
                      size={20}
                    />
                    <span className="truncate text-muted">{agent.name}</span>
                    <span
                      aria-hidden
                      className="relative h-1 overflow-hidden rounded-full bg-surface-muted"
                    >
                      <span
                        className="absolute inset-0 origin-left rounded-full"
                        style={{
                          transform: `scaleX(${(pct / 100).toFixed(3)})`,
                          background: fillGradient,
                        }}
                      />
                    </span>
                    <span className="font-mono text-[11px] tabular-nums text-text-strong">
                      {pnl >= 0 ? "+" : "−"}
                      {formatCompactJpy(Math.abs(pnl))} ·{" "}
                      {initial > 0 ? `${((pnl / initial) * 100).toFixed(1)}%` : "—"}
                    </span>
                  </Link>
                );
              })}
            </div>
          )}
        </aside>
      </section>

      {/* === OPEN POSITIONS (全クルー合算) ================================= */}
      <section aria-label="保有ポジション" className={SECTION_CLS}>
        <header className={SECTION_HEAD_CLS}>
          <div className="flex min-w-0 flex-col gap-1">
            <p className={KICKER_CLS}>Open Positions · 全クルー</p>
            <h2 className={SECTION_TITLE_CLS}>保有ポジション</h2>
            <p className={SECTION_DESC_CLS}>
              いま全エージェントが持っているポジションと、現在価格・含み損益・経過時間。
            </p>
          </div>
        </header>
        <div className={CARD_CLS}>
          <div className={CARD_HEAD_CLS}>
            <span className={CARD_HEAD_TITLE_CLS}>Open Positions / 全クルー</span>
            <span className={CARD_HEAD_META_CLS}>
              <span className={META_CHIP_CLS}>{totalOpenPositions} open</span>
              <span
                className={`${META_CHIP_CLS} ${
                  totalOpenUnrealizedPnl > 0
                    ? "text-profit-strong"
                    : totalOpenUnrealizedPnl < 0
                      ? "text-loss-strong"
                      : ""
                }`}
              >
                含み {formatJpySigned(totalOpenUnrealizedPnl)}
              </span>
            </span>
          </div>
          <div className="flex min-h-0 flex-col">
            {dashboard.openPositions.length === 0 ? (
              <div className="m-4">
                <div className={EMPTY_CLS}>現在ポジションを持っているエージェントはいません</div>
              </div>
            ) : (
              <div className="overflow-auto">
                <table className="w-full border-collapse text-xs">
                  <thead>
                    <tr>
                      <th className="sticky top-0 z-[1] border-b border-line bg-bg-elevated px-3 py-2 text-left text-[10px] font-bold uppercase tracking-[0.08em] text-muted">
                        エージェント
                      </th>
                      <th className="sticky top-0 z-[1] border-b border-line bg-bg-elevated px-2 py-2 text-left text-[10px] font-bold uppercase tracking-[0.08em] text-muted">
                        通貨ペア
                      </th>
                      <th className="sticky top-0 z-[1] border-b border-line bg-bg-elevated px-2 py-2 text-left text-[10px] font-bold uppercase tracking-[0.08em] text-muted">
                        売買
                      </th>
                      <th className="sticky top-0 z-[1] border-b border-line bg-bg-elevated px-2 py-2 text-right font-mono text-[10px] font-bold uppercase tracking-[0.08em] text-muted tabular-nums">
                        数量
                      </th>
                      <th className="sticky top-0 z-[1] border-b border-line bg-bg-elevated px-2 py-2 text-right font-mono text-[10px] font-bold uppercase tracking-[0.08em] text-muted tabular-nums">
                        エントリー
                      </th>
                      <th className="sticky top-0 z-[1] border-b border-line bg-bg-elevated px-2 py-2 text-right font-mono text-[10px] font-bold uppercase tracking-[0.08em] text-muted tabular-nums">
                        現在
                      </th>
                      <th className="sticky top-0 z-[1] border-b border-line bg-bg-elevated px-2 py-2 text-right font-mono text-[10px] font-bold uppercase tracking-[0.08em] text-muted tabular-nums">
                        SL
                      </th>
                      <th className="sticky top-0 z-[1] border-b border-line bg-bg-elevated px-2 py-2 text-right font-mono text-[10px] font-bold uppercase tracking-[0.08em] text-muted tabular-nums">
                        TP
                      </th>
                      <th className="sticky top-0 z-[1] border-b border-line bg-bg-elevated px-2 py-2 text-right font-mono text-[10px] font-bold uppercase tracking-[0.08em] text-muted tabular-nums">
                        含み損益
                      </th>
                      <th className="sticky top-0 z-[1] border-b border-line bg-bg-elevated px-2 py-2 text-right font-mono text-[10px] font-bold uppercase tracking-[0.08em] text-muted tabular-nums">
                        経過
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {dashboard.openPositions.map((position) => {
                      const character = getCharacter(position.characterId);
                      const displayName =
                        character?.nameJa ?? position.agentName ?? position.accountName;
                      const sideLower = position.side.toLowerCase();
                      const sideLabel = position.side === "long" ? "BUY" : "SELL";
                      const unrealized =
                        position.unrealizedPnlJpy !== null
                          ? Number(position.unrealizedPnlJpy)
                          : null;
                      return (
                        <tr
                          key={position.id}
                          className="border-b border-line-soft transition-colors last:border-b-0 hover:bg-surface-muted"
                        >
                          <td className="px-3 py-2.5">
                            <span className="inline-flex items-center gap-2">
                              <FaceIcon
                                avatarPath={character?.avatarPath}
                                alt={displayName}
                                size={20}
                              />
                              <span className="truncate text-[12px] font-semibold text-text-strong">
                                {displayName}
                              </span>
                            </span>
                          </td>
                          <td className="px-2 py-2.5">
                            <span className="tv-symbol">{formatSymbol(position.symbol)}</span>
                          </td>
                          <td className="px-2 py-2.5">
                            <span className={`tv-side ${sideLower}`}>{sideLabel}</span>
                          </td>
                          <td className="px-2 py-2.5 text-right font-mono tabular-nums">
                            {Number(position.quantity).toLocaleString()}
                          </td>
                          <td className="px-2 py-2.5 text-right font-mono tabular-nums">
                            {Number(position.entryPrice).toFixed(3)}
                          </td>
                          <td className="px-2 py-2.5 text-right font-mono tabular-nums">
                            {position.currentPrice ? Number(position.currentPrice).toFixed(3) : "—"}
                          </td>
                          <td className="px-2 py-2.5 text-right font-mono tabular-nums text-loss-strong">
                            {Number(position.stopLossPrice).toFixed(3)}
                          </td>
                          <td className="px-2 py-2.5 text-right font-mono tabular-nums text-profit-strong">
                            {Number(position.takeProfitPrice).toFixed(3)}
                          </td>
                          <td className="px-2 py-2.5 text-right font-mono tabular-nums">
                            {unrealized !== null ? (
                              <span className={`tv-pnl ${unrealized >= 0 ? "profit" : "loss"}`}>
                                {formatJpySigned(unrealized)}
                              </span>
                            ) : (
                              <span className="text-subtle">—</span>
                            )}
                          </td>
                          <td className="px-2 py-2.5 text-right font-mono tabular-nums">
                            <span className="tv-time">{formatElapsed(position.openedAt)}</span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* === Performance ================================================= */}
      <section aria-label="Performance" className={SECTION_CLS}>
        <header className={SECTION_HEAD_CLS}>
          <div className="flex min-w-0 flex-col gap-1">
            <p className={KICKER_CLS}>Performance · 確定済み</p>
            <h2 className={SECTION_TITLE_CLS}>パフォーマンス</h2>
            <p className={SECTION_DESC_CLS}>
              確定したペーパー取引から累積損益と直近の約定を集計。クルー別の口座状況も切り替え可能です。
            </p>
          </div>
          <div className="inline-flex items-center gap-1.5">
            <Link href="/activity?kind=runs" className="btn-ghost">
              実行履歴 →
            </Link>
          </div>
        </header>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
          <div className={CARD_CLS}>
            <div className={CARD_HEAD_CLS}>
              <span className={CARD_HEAD_TITLE_CLS}>
                累積損益 / Cumulative PnL
                {selectedAccountName ? ` · ${selectedAccountName}` : ""}
              </span>
              <span className={CARD_HEAD_META_CLS}>
                <span className={META_CHIP_CLS}>{dashboard.trades.length} fills</span>
              </span>
            </div>
            <div className={CARD_BODY_CLS}>
              <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2 border-b border-line-soft pb-2.5">
                <div className="flex items-baseline gap-3">
                  <span
                    className={`font-mono text-2xl font-semibold tabular-nums ${
                      pnlPositive ? "text-profit-strong" : "text-loss-strong"
                    }`}
                  >
                    {formatJpySigned(totalPnl)}
                  </span>
                  <span
                    className={`inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 font-mono text-sm font-semibold ${
                      pnlPositive
                        ? "bg-profit-soft text-profit-strong"
                        : "bg-loss-soft text-loss-strong"
                    }`}
                  >
                    勝率 {dashboard.trades.length > 0 ? `${winRate.toFixed(1)}%` : "—"}
                  </span>
                </div>
              </div>
              {pnlSeries.length > 0 ? (
                <PnlChart data={pnlSeries} positive={pnlPositive} />
              ) : (
                <div className={EMPTY_CLS}>
                  確定取引が記録され次第、ここに累積損益が描画されます
                </div>
              )}
            </div>
          </div>

          <div className={CARD_CLS}>
            <div className={CARD_HEAD_CLS}>
              <span className={CARD_HEAD_TITLE_CLS}>エージェント口座 / Agents</span>
              <span className={CARD_HEAD_META_CLS}>
                <span className={META_CHIP_CLS}>{agentSummaries.length} crew</span>
              </span>
            </div>
            <div className="flex max-h-[360px] min-h-0 flex-col overflow-auto">
              {agentSummaries.length === 0 ? (
                <div className="m-4">
                  <div className={EMPTY_CLS}>
                    エージェントがまだ配属されていません
                    <br />
                    <Link href="/agents#picker" className="text-accent-strong">
                      ＋ クルーを配属する →
                    </Link>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col">
                  {!isAccountView ? null : (
                    <WatchlistRow
                      href="/"
                      scroll={false}
                      avatar={
                        <span
                          aria-hidden
                          className="grid size-9 place-items-center rounded-lg border border-line bg-surface text-[11px] font-bold text-text-strong"
                        >
                          ←
                        </span>
                      }
                      name="全クルー表示に戻る"
                      sub={<span className="tv-tag">ALL</span>}
                      balance=""
                      delta=""
                    />
                  )}
                  {agentSummaries.map((agent) => (
                    <AgentAccountRow key={agent.id} agent={agent} />
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className={CARD_CLS}>
          <div className={CARD_HEAD_CLS}>
            <span className={CARD_HEAD_TITLE_CLS}>
              直近の確定取引 / Recent Fills
              {selectedAccountName ? ` · ${selectedAccountName}` : ""}
            </span>
            <span className={CARD_HEAD_META_CLS}>
              <span className={META_CHIP_CLS}>{dashboard.trades.length} fills</span>
            </span>
          </div>
          <div className="flex min-h-0 flex-col">
            {dashboard.trades.length === 0 ? (
              <div className="m-4">
                <div className={EMPTY_CLS}>確定済みのペーパー取引はまだありません</div>
              </div>
            ) : (
              <div className="overflow-auto">
                <table className="w-full border-collapse text-xs">
                  <thead>
                    <tr>
                      <th className="sticky top-0 z-[1] border-b border-line bg-bg-elevated px-3.5 py-2 text-left text-[10px] font-bold uppercase tracking-[0.08em] text-muted">
                        通貨ペア
                      </th>
                      <th className="sticky top-0 z-[1] border-b border-line bg-bg-elevated px-3.5 py-2 text-left text-[10px] font-bold uppercase tracking-[0.08em] text-muted">
                        売買
                      </th>
                      <th className="sticky top-0 z-[1] border-b border-line bg-bg-elevated px-3.5 py-2 text-right font-mono text-[10px] font-bold uppercase tracking-[0.08em] text-muted tabular-nums">
                        損益 (JPY)
                      </th>
                      <th className="sticky top-0 z-[1] border-b border-line bg-bg-elevated px-3.5 py-2 text-right font-mono text-[10px] font-bold uppercase tracking-[0.08em] text-muted tabular-nums">
                        決済日時
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {dashboard.trades.slice(0, 12).map((trade) => {
                      const pnl = Number(trade.pnlJpy);
                      const sideClass = trade.side.toLowerCase();
                      return (
                        <tr
                          key={`${trade.symbol}-${trade.closedAt}`}
                          className="border-b border-line-soft transition-colors last:border-b-0 hover:bg-surface-muted"
                        >
                          <td className="px-3.5 py-2.5">
                            <span className="tv-symbol">{formatSymbol(trade.symbol)}</span>
                          </td>
                          <td className="px-3.5 py-2.5">
                            <span className={`tv-side ${sideClass}`}>
                              {translateSide(trade.side)}
                            </span>
                          </td>
                          <td className="px-3.5 py-2.5 text-right font-mono tabular-nums">
                            <span className={`tv-pnl ${pnl >= 0 ? "profit" : "loss"}`}>
                              {formatJpySigned(pnl)}
                            </span>
                          </td>
                          <td className="px-3.5 py-2.5 text-right font-mono tabular-nums">
                            <span className="tv-time">{formatDateTime(trade.closedAt)}</span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {dashboard.accountDetail ? <AccountStrategyPanel detail={dashboard.accountDetail} /> : null}
      </section>

      {/* === Calendar =================================================== */}
      <section aria-label="日次損益カレンダー" className={SECTION_CLS}>
        <header className={SECTION_HEAD_CLS}>
          <div className="flex min-w-0 flex-col gap-1">
            <p className={KICKER_CLS}>Daily PnL · Calendar</p>
            <h2 className={SECTION_TITLE_CLS}>日次損益カレンダー</h2>
            <p className={SECTION_DESC_CLS}>
              JST
              日付で集計した、全エージェント合算のペーパー確定損益。月送りで過去の成績も確認できます。
            </p>
          </div>
        </header>
        <div className={CARD_CLS}>
          <div className={CARD_HEAD_CLS}>
            <span className={CARD_HEAD_TITLE_CLS}>日次 PnL / Daily PnL</span>
            <span className={CARD_HEAD_META_CLS}>
              <span className={META_CHIP_CLS}>{dailyPnlEntries.length} days w/ fills</span>
            </span>
          </div>
          <div className={CARD_BODY_CLS}>
            <DailyPnlCalendar entries={dailyPnlEntries} />
          </div>
        </div>
      </section>

      {/* === Today's Crew Briefing ======================================= */}
      <section aria-label="本日のクルー報告" className={SECTION_CLS}>
        <header className={SECTION_HEAD_CLS}>
          <div className="flex min-w-0 flex-col gap-1">
            <p className={KICKER_CLS}>Today&apos;s Crew Briefing</p>
            <h2 className={SECTION_TITLE_CLS}>本日のクルー報告</h2>
            <p className={SECTION_DESC_CLS}>
              各エージェントの「いま考えていること」「本日の損益(確定+含み)」「日次フィードバック」をまとめて表示します。
            </p>
          </div>
        </header>
        {dashboard.agentBriefings.length === 0 ? (
          <div className={EMPTY_CLS}>エージェントの活動がまだ記録されていません</div>
        ) : (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {dashboard.agentBriefings.map((briefing) => (
              <CrewBriefingCard key={briefing.agentId} briefing={briefing} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function CrewBriefingCard({ briefing }: { briefing: AgentBriefingRow }) {
  const character = getCharacter(briefing.characterId);
  const displayName = character?.nameJa ?? briefing.agentName;
  const subType = character?.type ?? "";
  const todayRealized = Number(briefing.todayRealizedPnlJpy);
  const todayUnrealized = Number(briefing.todayUnrealizedPnlJpy);
  const todayTotal = todayRealized + todayUnrealized;
  const observations = briefing.latestRun?.observations ?? [];
  const proposals = briefing.latestRun?.proposals ?? [];

  return (
    <article className={CARD_CLS}>
      <div className={CARD_HEAD_CLS}>
        <span className="inline-flex min-w-0 items-center gap-2.5">
          <FaceIcon avatarPath={character?.avatarPath} alt={displayName} size={36} />
          <span className="flex min-w-0 flex-col leading-tight">
            <span className="truncate text-sm font-bold text-text-strong">
              {displayName}
              <small className="ml-1 font-normal text-muted">{briefing.agentName}</small>
            </span>
            <span className="truncate text-[10px] text-muted">{subType}</span>
          </span>
        </span>
        <span className={CARD_HEAD_META_CLS}>
          <span className={`tv-tag ${normalizeStatus(briefing.status)}`}>
            {translateStatus(briefing.status)}
          </span>
          <span
            className={`${META_CHIP_CLS} font-mono ${
              todayTotal > 0 ? "text-profit-strong" : todayTotal < 0 ? "text-loss-strong" : ""
            }`}
          >
            本日 {formatJpySigned(todayTotal)}
          </span>
        </span>
      </div>
      <div className="flex flex-col gap-2.5 p-4">
        {/* 思考 */}
        <div className="flex flex-col gap-1.5 rounded-lg border border-line-soft bg-bg p-3">
          <span className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.1em] text-muted">
            <span aria-hidden>💭</span>
            <span>今の思考</span>
            {briefing.latestRun ? (
              <span className="ml-1 font-mono text-[10px] font-normal normal-case text-subtle">
                {formatDateTime(briefing.latestRun.startedAt)} ·{" "}
                {translateStatus(briefing.latestRun.status)}
              </span>
            ) : null}
          </span>
          {observations.length === 0 && proposals.length === 0 ? (
            <span className="text-[11px] text-subtle">
              {briefing.latestRun ? "観測・提案は出力されていません" : "最新の実行がまだありません"}
            </span>
          ) : (
            <ul className="flex flex-col gap-1">
              {observations.slice(0, 3).map((obs) => (
                <li
                  key={`obs-${obs.kind}-${obs.summary}`}
                  className="relative break-words pl-3 text-[11px] leading-snug text-text before:absolute before:left-0 before:text-accent-strong before:content-['›']"
                >
                  <span className="mr-1 inline-block rounded-sm bg-surface-muted px-1 text-[9px] font-mono uppercase tracking-wide text-muted">
                    {obs.kind}
                  </span>
                  {obs.summary}
                </li>
              ))}
              {proposals.slice(0, 2).map((prop) => (
                <li
                  key={`prop-${prop.strategyName}-${prop.validationStatus}`}
                  className="relative break-words pl-3 text-[11px] leading-snug text-text before:absolute before:left-0 before:text-profit-strong before:content-['→']"
                >
                  <span className="mr-1 inline-block rounded-sm bg-accent-soft px-1 text-[9px] font-mono uppercase tracking-wide text-accent-strong">
                    propose
                  </span>
                  {prop.strategyName} ({translateStatus(prop.validationStatus)})
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* 当日損益 + 日次FB */}
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          <div className="flex flex-col gap-1 rounded-lg border border-line-soft bg-bg p-3">
            <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-muted">
              📊 当日損益
            </span>
            <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
              <dt className="text-muted">確定</dt>
              <dd
                className={`m-0 text-right font-mono tabular-nums ${
                  todayRealized > 0
                    ? "text-profit-strong"
                    : todayRealized < 0
                      ? "text-loss-strong"
                      : "text-text"
                }`}
              >
                {formatJpySigned(todayRealized)}
              </dd>
              <dt className="text-muted">含み</dt>
              <dd
                className={`m-0 text-right font-mono tabular-nums ${
                  todayUnrealized > 0
                    ? "text-profit-strong"
                    : todayUnrealized < 0
                      ? "text-loss-strong"
                      : "text-text"
                }`}
              >
                {formatJpySigned(todayUnrealized)}
              </dd>
              <dt className="font-bold text-text-strong">計</dt>
              <dd
                className={`m-0 text-right font-mono font-bold tabular-nums ${
                  todayTotal > 0
                    ? "text-profit-strong"
                    : todayTotal < 0
                      ? "text-loss-strong"
                      : "text-text-strong"
                }`}
              >
                {formatJpySigned(todayTotal)}
              </dd>
              <dt className="text-muted">取引</dt>
              <dd className="m-0 text-right font-mono text-muted tabular-nums">
                {briefing.todayTradeCount} fills ·{" "}
                {briefing.todayTradeCount > 0
                  ? `${((briefing.todayWinCount / briefing.todayTradeCount) * 100).toFixed(0)}%`
                  : "—"}
              </dd>
              <dt className="text-muted">保有</dt>
              <dd className="m-0 text-right font-mono text-muted tabular-nums">
                {briefing.openPositionCount} open
              </dd>
            </dl>
          </div>
          <div className="flex flex-col gap-1 rounded-lg border border-line-soft bg-bg p-3">
            <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-muted">
              🔁 日次FB
            </span>
            <p className="text-[11px] leading-relaxed text-text">
              {briefing.dailyFeedback ?? (
                <span className="text-subtle">本日の日次レビューはまだ生成されていません</span>
              )}
            </p>
          </div>
        </div>
      </div>
    </article>
  );
}

function FaceIcon({
  avatarPath,
  alt,
  size,
}: {
  avatarPath: string | undefined;
  alt: string;
  size: number;
}) {
  if (avatarPath) {
    return (
      <Image
        src={avatarPath}
        alt={`${alt} avatar`}
        width={size}
        height={size}
        className="shrink-0 rounded-full border border-line object-cover"
        style={{ width: size, height: size }}
        unoptimized
      />
    );
  }
  return (
    <span
      aria-hidden
      className="grid shrink-0 place-items-center rounded-full border border-line bg-surface text-[10px] font-bold text-text-strong"
      style={{ width: size, height: size }}
    >
      {alt[0]?.toUpperCase() ?? "?"}
    </span>
  );
}

function KpiCell({
  label,
  value,
  tone,
  foot,
  spark,
  sparkTone,
}: {
  label: string;
  value: string;
  tone?: "profit" | "loss" | "accent";
  foot?: string;
  spark?: string;
  sparkTone?: "profit" | "loss";
}) {
  const toneClass =
    tone === "profit"
      ? "text-profit-strong"
      : tone === "loss"
        ? "text-loss-strong"
        : tone === "accent"
          ? "text-accent-strong"
          : "text-text-strong";
  const sparkClass =
    sparkTone === "profit"
      ? "bg-profit-soft text-profit-strong"
      : sparkTone === "loss"
        ? "bg-loss-soft text-loss-strong"
        : "bg-surface-muted text-muted";
  return (
    <div className="relative flex min-w-0 flex-col gap-1.5 bg-bg-elevated p-4 transition-colors hover:bg-surface">
      <span className={KPI_LABEL_CLS}>{label}</span>
      <span className={`${KPI_VALUE_CLS} ${toneClass}`}>{value}</span>
      {(foot || spark) && (
        <span className="flex items-center gap-1.5 text-[11px] text-muted">
          {spark ? (
            <span
              className={`inline-flex items-center gap-1 rounded font-mono text-[10px] px-1.5 py-0.5 ${sparkClass}`}
            >
              {spark}
            </span>
          ) : null}
          {foot ? <span>{foot}</span> : null}
        </span>
      )}
    </div>
  );
}

function WatchlistRow({
  href,
  scroll,
  avatar,
  name,
  sub,
  balance,
  delta,
  deltaTone,
  active,
}: {
  href: string;
  scroll?: boolean;
  avatar: React.ReactNode;
  name: string;
  sub: React.ReactNode;
  balance: string;
  delta: string;
  deltaTone?: "profit" | "loss";
  active?: boolean;
}) {
  const deltaClass =
    deltaTone === "profit"
      ? "text-profit-strong"
      : deltaTone === "loss"
        ? "text-loss-strong"
        : "text-muted";
  return (
    <Link
      href={href}
      scroll={scroll}
      className={`relative grid grid-cols-[36px_minmax(0,1fr)_auto] items-center gap-2.5 border-b border-line-soft px-3.5 py-2.5 transition-colors last:border-b-0 hover:bg-surface-muted ${
        active
          ? "bg-accent-soft before:absolute before:inset-y-1.5 before:left-0 before:w-0.5 before:rounded-r-sm before:bg-accent-strong before:content-['']"
          : ""
      }`}
    >
      {avatar}
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="truncate text-[13px] font-semibold text-text-strong">{name}</span>
        <span className="inline-flex items-center gap-1.5 text-[10px] text-muted">{sub}</span>
      </span>
      <span className="flex flex-col items-end gap-0.5">
        <span className="font-mono text-xs font-bold tabular-nums text-text-strong">{balance}</span>
        <span className={`font-mono text-[11px] tabular-nums ${deltaClass}`}>{delta}</span>
      </span>
    </Link>
  );
}

function AgentAccountRow({ agent }: { agent: AgentSummaryRaw }) {
  const character = getCharacter(agent.characterId);
  const account = agent.paperAccount;
  const pnl = account?.pnlJpy ?? 0;
  const balance = account?.balanceJpy ?? 0;
  const deltaTone: "profit" | "loss" | undefined =
    pnl > 0 ? "profit" : pnl < 0 ? "loss" : undefined;
  return (
    <WatchlistRow
      href={`/agents/${agent.id}`}
      avatar={
        <FaceIcon
          avatarPath={character?.avatarPath}
          alt={character?.name ?? agent.name}
          size={36}
        />
      }
      name={agent.name}
      sub={
        <>
          <span className={`tv-tag ${normalizeStatus(agent.status)}`}>
            {translateStatus(agent.status)}
          </span>
          {account ? `${account.openPositionCount} open` : "no account"}
        </>
      }
      balance={account ? formatJpy(balance) : "—"}
      delta={account ? formatJpySigned(pnl) : ""}
      deltaTone={deltaTone}
    />
  );
}

function AccountStrategyPanel({ detail }: { detail: AccountDetail }) {
  const run = detail.strategyRun;
  const definitionPreview = formatStrategyDefinitionPreview(run?.strategyDefinition);
  const balance = Number(detail.balanceJpy);
  const initial = Number(detail.initialBalanceJpy);
  const pnl = Number.isFinite(balance) && Number.isFinite(initial) ? balance - initial : 0;
  const pnlPositive = pnl >= 0;
  return (
    <div className={CARD_CLS}>
      <div className={CARD_HEAD_CLS}>
        <span className={CARD_HEAD_TITLE_CLS}>戦略詳細 / Strategy · {detail.name}</span>
        <span className={CARD_HEAD_META_CLS}>
          <span className={META_CHIP_CLS}>{run ? run.status.toUpperCase() : "—"}</span>
        </span>
      </div>
      <div className={CARD_BODY_CLS}>
        <dl className="grid grid-cols-2 gap-x-5 gap-y-2">
          <DetailItem label="残高 / Balance" value={formatJpy(balance)} />
          <DetailItem label="初期 / Initial" value={formatJpy(initial)} />
          <DetailItem
            label="変動 / Δ"
            value={formatJpySigned(pnl)}
            tone={pnlPositive ? "profit" : "loss"}
          />
          <DetailItem label="戦略名 / Strategy" value={run?.strategyName ?? "—"} />
          <DetailItem label="銘柄 / Symbol" value={run ? formatSymbol(run.symbol) : "—"} />
          <DetailItem label="足種 / TF" value={run?.timeframe ?? "—"} />
          <DetailItem label="開始 / Started" value={run ? formatDateTime(run.startedAt) : "—"} />
        </dl>
        {definitionPreview && (
          <details className="border-t border-line-soft px-3 pt-2 pb-3">
            <summary className="cursor-pointer py-1 text-[11px] font-semibold text-muted hover:text-text-strong">
              Strategy Definition (JSON)
            </summary>
            <pre className="mt-1.5 max-h-60 overflow-auto rounded border border-line-soft bg-bg p-2.5 font-mono text-[11px] leading-normal whitespace-pre-wrap break-words text-text">
              {definitionPreview}
            </pre>
          </details>
        )}
      </div>
    </div>
  );
}

function DetailItem({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "profit" | "loss";
}) {
  const toneClass =
    tone === "profit"
      ? "text-profit-strong"
      : tone === "loss"
        ? "text-loss-strong"
        : "text-text-strong";
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-[9px] font-bold uppercase tracking-[0.1em] text-muted">{label}</dt>
      <dd className={`m-0 truncate font-mono text-xs font-semibold tabular-nums ${toneClass}`}>
        {value}
      </dd>
    </div>
  );
}

function formatStrategyDefinitionPreview(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return null;
  }
}

function buildPnlSeries(trades: DashboardSummary["trades"]): PnlPoint[] {
  if (trades.length === 0) return [];

  const sorted = [...trades]
    .filter((trade) => {
      const time = new Date(trade.closedAt).getTime();
      return !Number.isNaN(time);
    })
    .sort((a, b) => new Date(a.closedAt).getTime() - new Date(b.closedAt).getTime());

  let cumulative = 0;
  const seenTimes = new Set<number>();
  const points: PnlPoint[] = [];

  for (const trade of sorted) {
    cumulative += Number(trade.pnlJpy);
    let time = Math.floor(new Date(trade.closedAt).getTime() / 1000);
    while (seenTimes.has(time)) {
      time += 1;
    }
    seenTimes.add(time);
    points.push({
      time: time as UTCTimestamp,
      value: Number(cumulative.toFixed(2)),
    });
  }

  return points;
}

function formatJpy(value: number) {
  return new Intl.NumberFormat("ja-JP", {
    style: "currency",
    currency: "JPY",
    maximumFractionDigits: 0,
  }).format(value);
}

function formatJpySigned(value: number) {
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  return `${sign}${formatJpy(Math.abs(value))}`;
}

function formatCompactJpy(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 100_000_000) return `¥${(abs / 100_000_000).toFixed(2)}億`;
  if (abs >= 10_000) return `¥${(abs / 10_000).toFixed(1)}万`;
  return `¥${Math.round(abs).toLocaleString("ja-JP")}`;
}

function formatDateTime(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("ja-JP", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatElapsed(value: string): string {
  const opened = new Date(value).getTime();
  if (Number.isNaN(opened)) return "—";
  const ms = Date.now() - opened;
  if (ms < 0) return "—";
  const totalMin = Math.floor(ms / 60_000);
  if (totalMin < 60) return `${totalMin}分`;
  const hours = Math.floor(totalMin / 60);
  const min = totalMin % 60;
  if (hours < 24) return min > 0 ? `${hours}時間${min}分` : `${hours}時間`;
  const days = Math.floor(hours / 24);
  const remH = hours % 24;
  return remH > 0 ? `${days}日${remH}時間` : `${days}日`;
}

function formatSymbol(symbol: string) {
  return symbol.replace("_", "/");
}

function translateSide(side: string) {
  const normalized = side.toLowerCase();

  if (normalized === "buy" || normalized === "long") {
    return "BUY";
  }

  if (normalized === "sell" || normalized === "short") {
    return "SELL";
  }

  return side.toUpperCase();
}

function normalizeStatus(status: string) {
  return status.toLowerCase().replace(/[^a-z]/g, "");
}

function translateStatus(status: string) {
  const labels: Record<string, string> = {
    accepted: "承認済み",
    active: "稼働中",
    closed: "決済済み",
    completed: "完了",
    failed: "失敗",
    healthy: "正常",
    open: "保有中",
    paused: "停止",
    proposed: "提案中",
    promoted_to_baseline: "Baseline昇格済み",
    rejected: "却下",
    retired: "停止済み",
    running: "実行中",
    succeeded: "成功",
    timeout: "タイムアウト",
    rejected_output: "出力却下",
    unhealthy: "異常",
  };

  return labels[status.toLowerCase()] ?? status;
}
