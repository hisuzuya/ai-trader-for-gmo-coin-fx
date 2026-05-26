import { getCharacter } from "@ai-trade/domain/ai-agents/characters";
import type { UTCTimestamp } from "lightweight-charts";
import Image from "next/image";
import Link from "next/link";
import { type AgentSummaryRaw, fetchAgentSummaries } from "@/components/agents/CrewPanelSection";
import { CrewTile } from "@/components/agents/CrewTile";
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
  accountDetail: AccountDetail | null;
};

const EMPTY_DASHBOARD: DashboardSummary = {
  selectedAccountName: null,
  accounts: [],
  trades: [],
  candidates: [],
  dailyReviews: [],
  dailyPnl: [],
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
  const totalOpenPositions = agentSummaries.reduce(
    (sum, agent) => sum + (agent.paperAccount?.openPositionCount ?? 0),
    0,
  );
  const activeAgents = agentSummaries.filter((agent) => agent.status === "active").length;
  const totalPnl = dashboard.trades.reduce((sum, trade) => sum + Number(trade.pnlJpy), 0);
  const winningTrades = dashboard.trades.filter((trade) => Number(trade.pnlJpy) > 0).length;
  const winRate = dashboard.trades.length > 0 ? (winningTrades / dashboard.trades.length) * 100 : 0;
  const latestReview = dashboard.dailyReviews[0];
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
            <p className={KICKER_CLS}>AI Crew Overview · USD/JPY · Paper</p>
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
              残高・確定損益・候補戦略・AI日次レビューを一画面で確認できます。
            </p>
          </div>

          <dl className="mt-auto grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
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
              label="Realized PnL"
              value={formatJpySigned(totalPnl)}
              tone={totalPnl > 0 ? "profit" : totalPnl < 0 ? "loss" : undefined}
              foot={`${dashboard.trades.length} fills · ${
                dashboard.trades.length > 0 ? `${winRate.toFixed(1)}%` : "—"
              } win`}
            />
            <KpiCell
              label="Active Agents"
              value={`${activeAgents} / ${agentSummaries.length}`}
              tone="accent"
              foot={`${totalOpenPositions} open positions`}
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
                    className="grid grid-cols-[80px_1fr_auto] items-center gap-2.5 text-[11px] hover:text-text-strong"
                    aria-label={`${agent.name} の口座`}
                  >
                    <span className="text-muted">{agent.name}</span>
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

      {/* === AI Crew Tiles ================================================ */}
      <section aria-label="AI Crew" className={SECTION_CLS}>
        <header className={SECTION_HEAD_CLS}>
          <div className="flex min-w-0 flex-col gap-1">
            <p className={KICKER_CLS}>AI Crew</p>
            <h2 className={SECTION_TITLE_CLS}>エージェント・クルー</h2>
            <p className={SECTION_DESC_CLS}>
              配属済みのエージェントを一覧表示。タイルから個別の詳細画面に遷移できます。
            </p>
          </div>
          <div className="inline-flex items-center gap-1.5">
            <Link href="/agents#picker" className="btn-primary">
              ＋ New Agent
            </Link>
            <Link href="/agents" className="btn-secondary">
              一覧へ
            </Link>
          </div>
        </header>
        {agentSummaries.length === 0 ? (
          <div className={EMPTY_CLS}>
            まだエージェントがいません。
            <br />
            <Link href="/agents#picker" className="text-accent-strong">
              ＋ クルーを配属する →
            </Link>
          </div>
        ) : (
          <div className="crew-grid">
            {agentSummaries.map((agent) => {
              const character = getCharacter(agent.characterId);
              if (!character) return null;
              const summary = {
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

      {/* === Performance ================================================= */}
      <section aria-label="Performance" className={SECTION_CLS}>
        <header className={SECTION_HEAD_CLS}>
          <div className="flex min-w-0 flex-col gap-1">
            <p className={KICKER_CLS}>Performance</p>
            <h2 className={SECTION_TITLE_CLS}>パフォーマンス</h2>
            <p className={SECTION_DESC_CLS}>
              確定済みのペーパー取引から累積損益と直近の約定を集計。クルー別の口座状況も切り替え可能です。
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
                  <WatchlistRow
                    href="/"
                    scroll={false}
                    avatar={
                      <span
                        aria-hidden
                        className="grid size-9 place-items-center rounded-lg border border-line bg-surface text-[11px] font-bold text-text-strong"
                      >
                        Σ
                      </span>
                    }
                    name="クルー合計"
                    sub={
                      <>
                        <span className="tv-tag">ALL</span>
                        {agentSummaries.length} agents
                      </>
                    }
                    balance={formatJpy(totalBalance)}
                    delta={formatJpySigned(totalUnrealizedPnl)}
                    deltaTone={
                      totalUnrealizedPnl > 0
                        ? "profit"
                        : totalUnrealizedPnl < 0
                          ? "loss"
                          : undefined
                    }
                    active={!isAccountView}
                  />
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

        {dashboard.accountDetail ? (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
            <AccountStrategyPanel detail={dashboard.accountDetail} />
            <PositionsPanel detail={dashboard.accountDetail} />
          </div>
        ) : null}
      </section>

      {/* === AI Insights =================================================== */}
      <section aria-label="AI Insights" className={SECTION_CLS}>
        <header className={SECTION_HEAD_CLS}>
          <div className="flex min-w-0 flex-col gap-1">
            <p className={KICKER_CLS}>AI Insights</p>
            <h2 className={SECTION_TITLE_CLS}>AIインサイト</h2>
            <p className={SECTION_DESC_CLS}>
              AIの日次レビューと審査中の候補戦略を要約。詳細は Activity 画面で時系列に確認できます。
            </p>
          </div>
          <div className="inline-flex items-center gap-1.5">
            <Link href="/activity?kind=proposals" className="btn-ghost">
              提案を見る →
            </Link>
            <Link href="/activity?kind=runs" className="btn-ghost">
              実行を見る →
            </Link>
          </div>
        </header>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className={CARD_CLS}>
            <div className={CARD_HEAD_CLS}>
              <span className={CARD_HEAD_TITLE_CLS}>AI日次レビュー / Daily Review</span>
              <span className={CARD_HEAD_META_CLS}>
                <span className={META_CHIP_CLS}>
                  {latestReview ? formatDate(latestReview.reviewDate) : "—"}
                </span>
              </span>
            </div>
            <div className={CARD_BODY_CLS}>
              {dashboard.dailyReviews.length === 0 ? (
                <div className={EMPTY_CLS}>AI日次レビューはまだ記録されていません</div>
              ) : (
                <div className="flex flex-col gap-3">
                  {dashboard.dailyReviews.slice(0, 2).map((review) => (
                    <article
                      key={`${review.reviewDate}-${review.createdAt}`}
                      className="flex flex-col gap-3 rounded-xl border border-line bg-linear-to-b from-accent-soft to-surface-muted p-3.5"
                    >
                      <header className="flex flex-wrap items-center justify-between gap-2.5">
                        <div className="inline-flex items-center gap-2.5">
                          <span className="font-mono text-sm font-bold text-text-strong">
                            {formatDate(review.reviewDate)}
                          </span>
                          <span className={`tv-tag ${normalizeStatus(review.status)}`}>
                            {translateStatus(review.status)}
                          </span>
                        </div>
                        <span className="font-mono text-[10px] text-subtle">
                          {formatDateTime(review.createdAt)}
                        </span>
                      </header>
                      <p className="text-xs leading-relaxed text-text">
                        {review.summary ?? "レビューは却下、または要約が返されませんでした。"}
                      </p>
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                        <ReviewCol
                          title="採用候補"
                          items={formatRecommendationItems(review.baselinePromotionCandidates)}
                        />
                        <ReviewCol
                          title="停止候補"
                          items={formatRecommendationItems(review.candidateRetirementCandidates)}
                        />
                        <ReviewCol title="警告" items={formatWarningItems(review.warnings)} />
                        <ReviewCol title="次の対応" items={formatStringItems(review.nextActions)} />
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className={CARD_CLS}>
            <div className={CARD_HEAD_CLS}>
              <span className={CARD_HEAD_TITLE_CLS}>候補戦略 / Candidates</span>
              <span className={CARD_HEAD_META_CLS}>
                <span className={META_CHIP_CLS}>{dashboard.candidates.length} 件</span>
              </span>
            </div>
            <div className="flex max-h-[360px] min-h-0 flex-col overflow-auto">
              {dashboard.candidates.length === 0 ? (
                <div className="m-4">
                  <div className={EMPTY_CLS}>AI候補戦略はまだ承認されていません</div>
                </div>
              ) : (
                dashboard.candidates.map((candidate) => {
                  const status = candidate.strategyRunStatus ?? candidate.status;
                  return (
                    <article
                      key={candidate.id}
                      className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2.5 border-b border-line-soft px-3.5 py-3 last:border-b-0"
                    >
                      <div className="flex min-w-0 flex-col gap-1">
                        <span className="truncate text-[13px] font-semibold text-text-strong">
                          {candidate.candidateStrategyName ?? candidate.id}
                        </span>
                        <span className="truncate font-mono text-[10px] text-muted">
                          ← {candidate.sourceStrategyName}
                        </span>
                        <span className="mt-1 inline-flex flex-wrap gap-1">
                          <span className="tv-tag">{candidate.timeframe}</span>
                          <span className={`tv-tag ${normalizeStatus(status)}`}>
                            {translateStatus(status)}
                          </span>
                        </span>
                      </div>
                      <div className="flex flex-col items-end gap-0.5 text-right whitespace-nowrap">
                        <span className="text-[9px] font-bold uppercase tracking-[0.1em] text-muted">
                          自動審査
                        </span>
                        <span className="max-w-[200px] font-mono text-[11px] leading-snug font-semibold whitespace-normal text-text-strong">
                          {describeAutoStatus(status)}
                        </span>
                      </div>
                    </article>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </section>
    </div>
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
        <span
          aria-hidden
          className="grid size-9 overflow-hidden rounded-lg border border-line bg-surface"
        >
          {character ? (
            <Image
              src={character.avatarPath ?? character.imagePath}
              alt={`${character.name} avatar`}
              width={36}
              height={36}
              className="size-full object-cover object-top"
              unoptimized
            />
          ) : (
            <span className="grid place-items-center text-xs font-bold text-text-strong">
              {agent.name[0] ?? "?"}
            </span>
          )}
        </span>
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

function ReviewCol({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="flex flex-col gap-1.5 rounded-lg border border-line-soft bg-bg-elevated p-2.5">
      <h4 className="text-[9px] font-bold uppercase tracking-[0.12em] text-muted">{title}</h4>
      {items.length === 0 ? (
        <span className="text-[11px] text-subtle">なし</span>
      ) : (
        <ul className="flex flex-col gap-1">
          {items.map((item) => (
            <li
              key={item}
              className="relative break-words pl-3 text-[11px] leading-snug text-text before:absolute before:left-0 before:text-accent-strong before:content-['›']"
            >
              {item}
            </li>
          ))}
        </ul>
      )}
    </div>
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

function PositionsPanel({ detail }: { detail: AccountDetail }) {
  return (
    <div className={CARD_CLS}>
      <div className={CARD_HEAD_CLS}>
        <span className={CARD_HEAD_TITLE_CLS}>保有ポジション · {detail.name}</span>
        <span className={CARD_HEAD_META_CLS}>
          <span className={META_CHIP_CLS}>{detail.openPositions.length} 件</span>
        </span>
      </div>
      <div className="flex min-h-0 flex-col">
        {detail.openPositions.length === 0 ? (
          <div className="m-4">
            <div className={EMPTY_CLS}>現在この口座に保有ポジションはありません</div>
          </div>
        ) : (
          <div className="flex flex-col">
            {detail.openPositions.map((position) => (
              <article
                key={`${position.openedAt}-${position.symbol}`}
                className="flex flex-col gap-2 border-b border-line-soft px-3.5 py-3 last:border-b-0"
              >
                <div className="flex items-center gap-2.5">
                  <span className="tv-symbol">{formatSymbol(position.symbol)}</span>
                  <span className={`tv-side ${position.side.toLowerCase()}`}>
                    {translateSide(position.side)}
                  </span>
                  <span className="tv-time">{formatDateTime(position.openedAt)}</span>
                </div>
                <dl className="grid grid-cols-3 gap-x-5 gap-y-1.5">
                  <DetailItem label="数量" value={Number(position.quantity).toLocaleString()} />
                  <DetailItem label="エントリー" value={Number(position.entryPrice).toFixed(3)} />
                  <DetailItem label="SL" value={Number(position.stopLossPrice).toFixed(3)} />
                  <DetailItem label="TP" value={Number(position.takeProfitPrice).toFixed(3)} />
                  <DetailItem
                    label="最良値"
                    value={Number(position.bestPriceSinceOpen).toFixed(3)}
                  />
                  <DetailItem
                    label="Spread"
                    value={`${Number(position.spreadPips).toFixed(1)} pips`}
                  />
                </dl>
              </article>
            ))}
          </div>
        )}
      </div>
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

function formatDate(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
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
    unhealthy: "異常",
  };

  return labels[status.toLowerCase()] ?? status;
}

function describeAutoStatus(status: string): string {
  const normalized = status.toLowerCase();
  switch (normalized) {
    case "proposed":
      return "自動審査中(次回 Daily Review で判定)";
    case "promoted_to_baseline":
      return "自動採用済み → Baseline 昇格";
    case "retired":
      return "自動停止済み";
    case "running_paper":
      return "Paper 評価中";
    case "validated":
      return "Validation 通過";
    case "rejected":
      return "却下";
    case "failed":
      return "失敗";
    default:
      return status;
  }
}

function formatRecommendationItems(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item) => {
    if (
      typeof item === "object" &&
      item !== null &&
      "strategyName" in item &&
      "reason" in item &&
      typeof item.strategyName === "string" &&
      typeof item.reason === "string"
    ) {
      return [`${item.strategyName}: ${item.reason}`];
    }

    return [];
  });
}

function formatWarningItems(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item) => {
    if (
      typeof item === "object" &&
      item !== null &&
      "severity" in item &&
      "message" in item &&
      typeof item.severity === "string" &&
      typeof item.message === "string"
    ) {
      return [`${item.severity}: ${item.message}`];
    }

    return [];
  });
}

function formatStringItems(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === "string");
}
