import type { UTCTimestamp } from "lightweight-charts";
import Link from "next/link";
import { CrewPanelSection } from "@/components/agents/CrewPanelSection";
import { type CandlePoint, CandlestickChart } from "@/components/CandlestickChart";
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
  accountDetail: AccountDetail | null;
};

const EMPTY_DASHBOARD: DashboardSummary = {
  selectedAccountName: null,
  accounts: [],
  trades: [],
  candidates: [],
  dailyReviews: [],
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
    accountDetail: summary.accountDetail ?? null,
  };
}

type RecentCandlesResponse = {
  symbol: string;
  timeframe: string;
  priceType: "bid" | "ask" | "mid";
  candles: {
    openedAt: string;
    open: number;
    high: number;
    low: number;
    close: number;
  }[];
};

async function getRecentCandles(): Promise<RecentCandlesResponse> {
  const baseUrl = process.env.WORKER_INTERNAL_URL ?? "http://localhost:8787";
  const url = new URL("/candles", baseUrl);
  url.searchParams.set("symbol", "USD_JPY");
  url.searchParams.set("timeframe", "1m");
  url.searchParams.set("priceType", "mid");
  url.searchParams.set("limit", "1000");

  const response = await fetch(url, { cache: "no-store" }).catch(() => null);

  if (!response?.ok) {
    return { symbol: "USD_JPY", timeframe: "1m", priceType: "mid", candles: [] };
  }

  const body = (await response.json()) as Partial<RecentCandlesResponse> & { ok?: boolean };

  return {
    symbol: body.symbol ?? "USD_JPY",
    timeframe: body.timeframe ?? "1m",
    priceType: isPriceType(body.priceType) ? body.priceType : "mid",
    candles: Array.isArray(body.candles) ? body.candles : [],
  };
}

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function DashboardPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const rawAccount = params.account;
  const accountParam =
    typeof rawAccount === "string" && rawAccount.trim().length > 0
      ? rawAccount.trim()
      : Array.isArray(rawAccount) && typeof rawAccount[0] === "string"
        ? rawAccount[0]
        : undefined;

  const [health, dashboard, recentCandles] = await Promise.all([
    getHealth(),
    getDashboardSummary(accountParam),
    getRecentCandles(),
  ]);
  const selectedAccountName = dashboard.selectedAccountName;
  const isAccountView = selectedAccountName !== null;
  const totalBalance = dashboard.accounts.reduce(
    (sum, account) => sum + Number(account.balanceJpy),
    0,
  );
  const totalPnl = dashboard.trades.reduce((sum, trade) => sum + Number(trade.pnlJpy), 0);
  const winningTrades = dashboard.trades.filter((trade) => Number(trade.pnlJpy) > 0).length;
  const winRate = dashboard.trades.length > 0 ? (winningTrades / dashboard.trades.length) * 100 : 0;
  const activeCandidates = dashboard.candidates.filter(
    (candidate) => candidate.strategyRunStatus === "proposed" || candidate.status === "accepted",
  ).length;
  const latestReview = dashboard.dailyReviews[0];
  const pnlSeries = buildPnlSeries(dashboard.trades);
  const pnlPositive = totalPnl >= 0;
  const candleSeries = buildCandleSeries(recentCandles.candles);
  const lastCandle = candleSeries.at(-1) ?? null;
  const firstCandle = candleSeries.at(0) ?? null;
  const candleChange = lastCandle && firstCandle ? lastCandle.close - firstCandle.open : 0;
  const candleChangePct =
    lastCandle && firstCandle && firstCandle.open !== 0
      ? (candleChange / firstCandle.open) * 100
      : 0;
  const candleUp = candleChange >= 0;

  return (
    <>
      <CrewPanelSection />
      <main className="tv-shell">
        <Sidebar />
        <TopBar healthOk={health.ok} healthService={health.service} timestamp={health.timestamp} />
        <TickerStrip
          balance={totalBalance}
          pnl={totalPnl}
          winRate={winRate}
          trades={dashboard.trades.length}
          candidates={activeCandidates}
        />

        <div className="tv-main">
          <div className="tv-col tv-col-left">
            <section className="tv-panel" aria-label="ペーパー口座">
              <PanelHeader title="ペーパー口座" meta={`${dashboard.accounts.length}`} />
              <div className="tv-panel-body">
                {dashboard.accounts.length === 0 ? (
                  <EmptyState text="口座が同期されていません" />
                ) : (
                  <>
                    <div className="tv-watchlist-head">
                      <span>口座名</span>
                      <span className="text-right">残高</span>
                    </div>
                    <Link
                      href="/"
                      scroll={false}
                      className={`tv-watchlist-row tv-watchlist-row-link ${
                        isAccountView ? "" : "active"
                      }`}
                    >
                      <div className="tv-watchlist-name">
                        <span className="tv-watchlist-symbol">全口座 (集計)</span>
                        <span className="tv-watchlist-sub">
                          <span className="tv-tag">ALL</span>
                          <span>{dashboard.accounts.length} accounts</span>
                        </span>
                      </div>
                      <div className="tv-watchlist-balance">
                        {formatJpy(totalBalance)}
                        <small>JPY</small>
                      </div>
                    </Link>
                    {dashboard.accounts.map((account) => {
                      const isSelected = selectedAccountName === account.name;
                      return (
                        <Link
                          href={`/?account=${encodeURIComponent(account.name)}`}
                          scroll={false}
                          key={account.name}
                          className={`tv-watchlist-row tv-watchlist-row-link ${
                            isSelected ? "active" : ""
                          }`}
                        >
                          <div className="tv-watchlist-name">
                            <span className="tv-watchlist-symbol">{account.name}</span>
                            <span className="tv-watchlist-sub">
                              <span className={`tv-tag ${normalizeStatus(account.status)}`}>
                                {translateStatus(account.status)}
                              </span>
                              <span>{formatDateTime(account.updatedAt)}</span>
                            </span>
                          </div>
                          <div className="tv-watchlist-balance">
                            {formatJpy(Number(account.balanceJpy))}
                            <small>JPY</small>
                          </div>
                        </Link>
                      );
                    })}
                  </>
                )}
              </div>
            </section>
          </div>

          <div className="tv-col tv-col-center">
            <section
              className="tv-panel tv-chart-panel tv-chart-panel-price"
              aria-label="価格チャート"
            >
              <PanelHeader
                title={`${formatSymbol(recentCandles.symbol)} · ${recentCandles.timeframe.toUpperCase()} · ${recentCandles.priceType.toUpperCase()}`}
                meta={`${candleSeries.length} bars`}
              />
              <div className="tv-panel-body">
                <div className="tv-chart-summary">
                  <div className="tv-chart-headline">
                    <span className="tv-chart-headline-label">終値 / Last</span>
                    <span className={`tv-chart-headline-value ${candleUp ? "profit" : "loss"}`}>
                      {lastCandle ? lastCandle.close.toFixed(3) : "—"}
                      {lastCandle && firstCandle ? (
                        <span className="tv-chart-headline-delta">
                          {candleUp ? "▲" : "▼"} {Math.abs(candleChange).toFixed(3)} (
                          {candleChangePct >= 0 ? "+" : "−"}
                          {Math.abs(candleChangePct).toFixed(2)}%)
                        </span>
                      ) : null}
                    </span>
                  </div>
                  <div className="tv-chart-stats">
                    <div className="tv-chart-stat">
                      <span className="tv-chart-stat-label">高値 / High</span>
                      <span className="tv-chart-stat-value">
                        {lastCandle ? lastCandle.high.toFixed(3) : "—"}
                      </span>
                    </div>
                    <div className="tv-chart-stat">
                      <span className="tv-chart-stat-label">安値 / Low</span>
                      <span className="tv-chart-stat-value">
                        {lastCandle ? lastCandle.low.toFixed(3) : "—"}
                      </span>
                    </div>
                    <div className="tv-chart-stat">
                      <span className="tv-chart-stat-label">本数 / Bars</span>
                      <span className="tv-chart-stat-value">
                        {candleSeries.length.toLocaleString()}
                      </span>
                    </div>
                  </div>
                </div>

                {candleSeries.length > 0 ? (
                  <CandlestickChart
                    data={candleSeries}
                    query={{
                      symbol: recentCandles.symbol,
                      timeframe: recentCandles.timeframe,
                      priceType: recentCandles.priceType,
                    }}
                    initialLimit={1000}
                  />
                ) : (
                  <div className="tv-chart-empty">
                    USD/JPYのMIDキャンドルが取得できていません(worker未起動 / データ未蓄積)
                  </div>
                )}
              </div>
            </section>

            <section
              className="tv-panel tv-chart-panel tv-chart-panel-compact"
              aria-label="累積損益"
            >
              <PanelHeader
                title={`累積損益 / Cumulative PnL${selectedAccountName ? ` (${selectedAccountName})` : ""}`}
                meta={dashboard.trades.length > 0 ? `${dashboard.trades.length} fills` : "0 fills"}
              />
              <div className="tv-panel-body">
                <div className="tv-chart-summary tv-chart-summary-compact">
                  <div className="tv-chart-headline">
                    <span className="tv-chart-headline-label">確定損益 / Realized</span>
                    <span
                      className={`tv-chart-headline-value tv-chart-headline-value-sm ${pnlPositive ? "profit" : "loss"}`}
                    >
                      {formatJpySigned(totalPnl)}
                      <span className="tv-chart-headline-delta">
                        勝率 {dashboard.trades.length > 0 ? `${winRate.toFixed(1)}%` : "—"} ·{" "}
                        {dashboard.trades.length} trades
                      </span>
                    </span>
                  </div>
                </div>

                {pnlSeries.length > 0 ? (
                  <PnlChart data={pnlSeries} positive={pnlPositive} />
                ) : (
                  <div className="tv-chart-empty tv-chart-empty-compact">
                    確定取引が記録され次第、ここに累積損益が描画されます
                  </div>
                )}
              </div>
            </section>

            <section className="tv-panel" aria-label="直近の確定取引">
              <PanelHeader
                title={`直近の確定取引 / Recent Fills${selectedAccountName ? ` (${selectedAccountName})` : ""}`}
                meta={`${dashboard.trades.length}`}
              />
              <div className="tv-panel-body scroll-x">
                {dashboard.trades.length === 0 ? (
                  <EmptyState text="確定済みのペーパー取引はまだありません" />
                ) : (
                  <table className="tv-table">
                    <thead>
                      <tr>
                        <th>通貨ペア</th>
                        <th>売買</th>
                        <th className="num">損益 (JPY)</th>
                        <th className="num">決済日時</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dashboard.trades.map((trade) => {
                        const pnl = Number(trade.pnlJpy);
                        const sideClass = trade.side.toLowerCase();
                        return (
                          <tr key={`${trade.symbol}-${trade.closedAt}`}>
                            <td>
                              <span className="tv-symbol">{formatSymbol(trade.symbol)}</span>
                            </td>
                            <td>
                              <span className={`tv-side ${sideClass}`}>
                                {translateSide(trade.side)}
                              </span>
                            </td>
                            <td className="num">
                              <span className={`tv-pnl ${pnl >= 0 ? "profit" : "loss"}`}>
                                {formatJpySigned(pnl)}
                              </span>
                            </td>
                            <td className="num">
                              <span className="tv-time">{formatDateTime(trade.closedAt)}</span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            </section>

            <section className="tv-panel" aria-label="AI日次レビュー">
              <PanelHeader
                title="AI日次レビュー / Daily Review"
                meta={latestReview ? formatDate(latestReview.reviewDate) : "—"}
              />
              <div className="tv-panel-body">
                {dashboard.dailyReviews.length === 0 ? (
                  <EmptyState text="AI日次レビューはまだ記録されていません" />
                ) : (
                  <div className="tv-review-stack">
                    {dashboard.dailyReviews.map((review) => (
                      <article
                        className="tv-review-card"
                        key={`${review.reviewDate}-${review.createdAt}`}
                      >
                        <header className="tv-review-head">
                          <div className="tv-review-head-left">
                            <span className="tv-review-date">{formatDate(review.reviewDate)}</span>
                            <span className={`tv-tag ${normalizeStatus(review.status)}`}>
                              {translateStatus(review.status)}
                            </span>
                          </div>
                          <span className="tv-review-time">{formatDateTime(review.createdAt)}</span>
                        </header>
                        <p className="tv-review-summary">
                          {review.summary ?? "レビューは却下、または要約が返されませんでした。"}
                        </p>
                        <div className="tv-review-columns">
                          <ReviewList
                            title="採用候補"
                            items={formatRecommendationItems(review.baselinePromotionCandidates)}
                          />
                          <ReviewList
                            title="停止候補"
                            items={formatRecommendationItems(review.candidateRetirementCandidates)}
                          />
                          <ReviewList title="警告" items={formatWarningItems(review.warnings)} />
                          <ReviewList
                            title="次の対応"
                            items={formatStringItems(review.nextActions)}
                          />
                        </div>
                      </article>
                    ))}
                  </div>
                )}
              </div>
            </section>
          </div>

          <div className="tv-col tv-col-right">
            {dashboard.accountDetail ? (
              <>
                <AccountStrategyPanel detail={dashboard.accountDetail} />
                <PositionsPanel detail={dashboard.accountDetail} />
              </>
            ) : null}
            <section className="tv-panel" aria-label="候補戦略">
              <PanelHeader title="候補戦略 / Candidates" meta={`${dashboard.candidates.length}`} />
              <div className="tv-panel-body">
                {dashboard.candidates.length === 0 ? (
                  <EmptyState text="AI候補戦略はまだ承認されていません" />
                ) : (
                  dashboard.candidates.map((candidate) => {
                    const status = candidate.strategyRunStatus ?? candidate.status;
                    return (
                      <article
                        className="tv-strategy-row tv-strategy-row-readonly"
                        key={candidate.id}
                      >
                        <div className="tv-strategy-meta">
                          <span className="tv-strategy-name">
                            {candidate.candidateStrategyName ?? candidate.id}
                          </span>
                          <span className="tv-strategy-source">
                            ← {candidate.sourceStrategyName}
                          </span>
                          <span className="tv-strategy-tags">
                            <span className="tv-tag">{candidate.timeframe}</span>
                            <span className={`tv-tag ${normalizeStatus(status)}`}>
                              {translateStatus(status)}
                            </span>
                          </span>
                        </div>
                        <div className="tv-strategy-status">
                          <span className="tv-strategy-status-label">自動審査</span>
                          <span className="tv-strategy-status-value">
                            {describeAutoStatus(status)}
                          </span>
                        </div>
                      </article>
                    );
                  })
                )}
              </div>
            </section>
          </div>
        </div>

        <StatusBar
          healthOk={health.ok}
          healthService={health.service}
          balance={totalBalance}
          pnl={totalPnl}
          accounts={dashboard.accounts.length}
          candidates={dashboard.candidates.length}
        />
      </main>
    </>
  );
}

function Sidebar() {
  const upcomingTitle = "未実装 (ルート未追加)";
  return (
    <aside className="tv-sidebar" aria-label="メインナビゲーション">
      <button
        type="button"
        className="tv-sidebar-btn active"
        title="ダッシュボード"
        aria-label="ダッシュボード"
        aria-current="page"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M3 12 L12 3 L21 12" />
          <path d="M5 10 L5 21 L19 21 L19 10" />
        </svg>
      </button>
      <button
        type="button"
        className="tv-sidebar-btn"
        title={upcomingTitle}
        aria-label="口座 (未実装)"
        disabled
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <rect x="3" y="6" width="18" height="13" rx="2" />
          <path d="M3 10 L21 10" />
          <path d="M7 15 L11 15" />
        </svg>
      </button>
      <button
        type="button"
        className="tv-sidebar-btn"
        title={upcomingTitle}
        aria-label="チャート (未実装)"
        disabled
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M3 20 L9 14 L13 17 L21 8" />
          <path d="M15 8 L21 8 L21 14" />
        </svg>
      </button>
      <button
        type="button"
        className="tv-sidebar-btn"
        title={upcomingTitle}
        aria-label="戦略 (未実装)"
        disabled
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="3.5" />
          <path d="M12 3 L12 6 M12 18 L12 21 M3 12 L6 12 M18 12 L21 12 M5.6 5.6 L7.7 7.7 M16.3 16.3 L18.4 18.4 M5.6 18.4 L7.7 16.3 M16.3 7.7 L18.4 5.6" />
        </svg>
      </button>
      <button
        type="button"
        className="tv-sidebar-btn"
        title={upcomingTitle}
        aria-label="履歴 (未実装)"
        disabled
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7 L12 12 L15.5 14" />
        </svg>
      </button>
      <div className="tv-sidebar-divider" />
      <button
        type="button"
        className="tv-sidebar-btn"
        title={upcomingTitle}
        aria-label="AI レビュー (未実装)"
        disabled
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 3 L13.7 8.5 L19.5 8.5 L14.9 12.1 L16.6 17.5 L12 14 L7.4 17.5 L9.1 12.1 L4.5 8.5 L10.3 8.5 Z" />
        </svg>
      </button>
      <button
        type="button"
        className="tv-sidebar-btn"
        title={upcomingTitle}
        aria-label="アラート (未実装)"
        disabled
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M6 9 A6 6 0 0 1 18 9 L18 14 L20 17 L4 17 L6 14 Z" />
          <path d="M10 20 A2 2 0 0 0 14 20" />
        </svg>
      </button>
      <span className="tv-sidebar-spacer" />
      <button
        type="button"
        className="tv-sidebar-btn"
        title={upcomingTitle}
        aria-label="設定 (未実装)"
        disabled
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15 A1.65 1.65 0 0 0 19.73 16.81 L19.79 16.87 A2 2 0 0 1 16.96 19.7 L16.9 19.64 A1.65 1.65 0 0 0 15.09 19.31 A1.65 1.65 0 0 0 14.04 20.82 L14.04 21 A2 2 0 0 1 10.04 21 L10.04 20.91 A1.65 1.65 0 0 0 8.96 19.4 A1.65 1.65 0 0 0 7.15 19.73 L7.09 19.79 A2 2 0 0 1 4.26 16.96 L4.32 16.9 A1.65 1.65 0 0 0 4.65 15.09 A1.65 1.65 0 0 0 3.14 14.04 L3 14.04 A2 2 0 0 1 3 10.04 L3.09 10.04 A1.65 1.65 0 0 0 4.6 8.96 A1.65 1.65 0 0 0 4.27 7.15 L4.21 7.09 A2 2 0 0 1 7.04 4.26 L7.1 4.32 A1.65 1.65 0 0 0 8.91 4.65 A1.65 1.65 0 0 0 9.96 3.14 L9.96 3 A2 2 0 0 1 13.96 3 L13.96 3.09 A1.65 1.65 0 0 0 15.04 4.6 A1.65 1.65 0 0 0 16.85 4.27 L16.91 4.21 A2 2 0 0 1 19.74 7.04 L19.68 7.1 A1.65 1.65 0 0 0 19.35 8.91 A1.65 1.65 0 0 0 20.86 9.96 L21 9.96 A2 2 0 0 1 21 13.96 L20.91 13.96 A1.65 1.65 0 0 0 19.4 15 Z" />
        </svg>
      </button>
    </aside>
  );
}

function StatusBar({
  healthOk,
  healthService,
  balance,
  pnl,
  accounts,
  candidates,
}: {
  healthOk: boolean;
  healthService: string;
  balance: number;
  pnl: number;
  accounts: number;
  candidates: number;
}) {
  const pnlClass = pnl >= 0 ? "profit" : "loss";
  return (
    <footer className="tv-statusbar" role="contentinfo" aria-label="ステータス">
      <span className="tv-statusbar-item">
        <span className={`tv-status-dot sm ${healthOk ? "live" : "danger"}`} />
        <strong>{healthOk ? "CONNECTED" : "DEGRADED"}</strong>
      </span>
      <span className="tv-statusbar-sep" />
      <span className="tv-statusbar-item">
        Service <strong>{healthService}</strong>
      </span>
      <span className="tv-statusbar-sep" />
      <span className="tv-statusbar-item optional">
        Mode <strong>PAPER</strong>
      </span>
      <span className="tv-statusbar-sep" />
      <span className="tv-statusbar-item optional">
        Symbol <strong>USD/JPY</strong>
      </span>
      <span className="tv-statusbar-spacer" />
      <span className="tv-statusbar-item optional">
        Equity <strong>{formatJpy(balance)}</strong>
      </span>
      <span className="tv-statusbar-sep" />
      <span className="tv-statusbar-item">
        PnL{" "}
        <strong className={pnlClass === "profit" ? "text-profit-strong" : "text-loss-strong"}>
          {formatJpySigned(pnl)}
        </strong>
      </span>
      <span className="tv-statusbar-sep" />
      <span className="tv-statusbar-item">
        Accounts <strong>{accounts}</strong>
      </span>
      <span className="tv-statusbar-sep" />
      <span className="tv-statusbar-item">
        Candidates <strong>{candidates}</strong>
      </span>
    </footer>
  );
}

function TopBar({
  healthOk,
  healthService,
  timestamp,
}: {
  healthOk: boolean;
  healthService: string;
  timestamp: string;
}) {
  return (
    <header className="tv-topbar">
      <div className="tv-topbar-left">
        <div className="tv-brand">
          <span className="tv-brand-logo">AT</span>
          <span className="tv-brand-name">AI Trade</span>
          <span className="tv-brand-sub">USD/JPY · Paper</span>
        </div>
      </div>
      <div className="tv-topbar-right">
        <span className="tv-system-pill" title={`Service: ${healthService}`}>
          <span className={`tv-status-dot ${healthOk ? "live" : "danger"}`} />
          {healthOk ? "稼働中" : "要確認"}
        </span>
        <span className="tv-clock">{formatDateTime(timestamp)}</span>
      </div>
    </header>
  );
}

function TickerStrip({
  balance,
  pnl,
  winRate,
  trades,
  candidates,
}: {
  balance: number;
  pnl: number;
  winRate: number;
  trades: number;
  candidates: number;
}) {
  return (
    <div className="tv-ticker">
      <div className="tv-ticker-tile">
        <span className="tv-ticker-label">
          <span>総資産</span>
          <span>Equity</span>
        </span>
        <span className="tv-ticker-value">{formatJpy(balance)}</span>
      </div>
      <div className="tv-ticker-tile">
        <span className="tv-ticker-label">
          <span>確定損益</span>
          <span>Realized PnL</span>
        </span>
        <span className={`tv-ticker-value ${pnl >= 0 ? "profit" : "loss"}`}>
          {formatJpySigned(pnl)}
        </span>
      </div>
      <div className="tv-ticker-tile">
        <span className="tv-ticker-label">
          <span>勝率 / 取引</span>
          <span>Win Rate / Trades</span>
        </span>
        <span className="tv-ticker-value">
          {trades > 0 ? `${winRate.toFixed(1)}%` : "—"}
          <span className="ml-2 text-[13px] text-muted">({trades})</span>
        </span>
      </div>
      <div className="tv-ticker-tile">
        <span className="tv-ticker-label">
          <span>候補戦略</span>
          <span>Active Candidates</span>
        </span>
        <span className="tv-ticker-value accent">{candidates.toLocaleString()}</span>
      </div>
    </div>
  );
}

function PanelHeader({ title, meta }: { title: string; meta: string }) {
  return (
    <div className="tv-panel-header">
      <div className="tv-panel-title">
        <span className="tv-panel-title-bar" />
        {title}
      </div>
      <span className="tv-panel-meta">{meta}</span>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="tv-empty">
      <span className="tv-empty-icon">∅</span>
      {text}
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
    <section className="tv-panel" aria-label="戦略詳細">
      <PanelHeader
        title={`戦略詳細 / Strategy (${detail.name})`}
        meta={run ? run.status.toUpperCase() : "—"}
      />
      <div className="tv-panel-body">
        <dl className="tv-detail-grid">
          <div>
            <dt>残高 / Balance</dt>
            <dd>{formatJpy(balance)}</dd>
          </div>
          <div>
            <dt>初期 / Initial</dt>
            <dd>{formatJpy(initial)}</dd>
          </div>
          <div>
            <dt>変動 / Δ</dt>
            <dd className={pnlPositive ? "tv-pnl profit" : "tv-pnl loss"}>
              {formatJpySigned(pnl)}
            </dd>
          </div>
          <div>
            <dt>戦略名 / Strategy</dt>
            <dd>{run?.strategyName ?? "—"}</dd>
          </div>
          <div>
            <dt>銘柄 / Symbol</dt>
            <dd>{run ? formatSymbol(run.symbol) : "—"}</dd>
          </div>
          <div>
            <dt>足種 / TF</dt>
            <dd>{run?.timeframe ?? "—"}</dd>
          </div>
          <div>
            <dt>開始 / Started</dt>
            <dd>{run ? formatDateTime(run.startedAt) : "—"}</dd>
          </div>
        </dl>
        {definitionPreview && (
          <details className="tv-detail-collapsible">
            <summary>Strategy Definition (JSON)</summary>
            <pre className="tv-code-block">{definitionPreview}</pre>
          </details>
        )}
      </div>
    </section>
  );
}

function PositionsPanel({ detail }: { detail: AccountDetail }) {
  return (
    <section className="tv-panel" aria-label="保有ポジション">
      <PanelHeader
        title={`保有ポジション / Open Positions (${detail.name})`}
        meta={`${detail.openPositions.length}`}
      />
      <div className="tv-panel-body">
        {detail.openPositions.length === 0 ? (
          <EmptyState text="現在この口座に保有ポジションはありません" />
        ) : (
          detail.openPositions.map((position) => (
            <article className="tv-position-row" key={`${position.openedAt}-${position.symbol}`}>
              <div className="tv-position-head">
                <span className="tv-symbol">{formatSymbol(position.symbol)}</span>
                <span className={`tv-side ${position.side.toLowerCase()}`}>
                  {translateSide(position.side)}
                </span>
                <span className="tv-time">{formatDateTime(position.openedAt)}</span>
              </div>
              <dl className="tv-position-grid">
                <div>
                  <dt>数量</dt>
                  <dd>{Number(position.quantity).toLocaleString()}</dd>
                </div>
                <div>
                  <dt>エントリー</dt>
                  <dd>{Number(position.entryPrice).toFixed(3)}</dd>
                </div>
                <div>
                  <dt>SL</dt>
                  <dd>{Number(position.stopLossPrice).toFixed(3)}</dd>
                </div>
                <div>
                  <dt>TP</dt>
                  <dd>{Number(position.takeProfitPrice).toFixed(3)}</dd>
                </div>
                <div>
                  <dt>最良値</dt>
                  <dd>{Number(position.bestPriceSinceOpen).toFixed(3)}</dd>
                </div>
                <div>
                  <dt>Spread</dt>
                  <dd>{Number(position.spreadPips).toFixed(1)} pips</dd>
                </div>
              </dl>
            </article>
          ))
        )}
      </div>
    </section>
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

function ReviewList({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="tv-review-list">
      <h4>{title}</h4>
      {items.length === 0 ? (
        <span className="tv-muted">なし</span>
      ) : (
        <ul>
          {items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function buildCandleSeries(candles: RecentCandlesResponse["candles"]): CandlePoint[] {
  if (candles.length === 0) return [];

  const seenTimes = new Set<number>();
  const points: CandlePoint[] = [];

  for (const candle of candles) {
    const ms = new Date(candle.openedAt).getTime();
    if (Number.isNaN(ms)) continue;
    let time = Math.floor(ms / 1000);
    while (seenTimes.has(time)) {
      time += 1;
    }
    seenTimes.add(time);
    points.push({
      time: time as UTCTimestamp,
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
    });
  }

  return points;
}

function isPriceType(value: unknown): value is RecentCandlesResponse["priceType"] {
  return value === "bid" || value === "ask" || value === "mid";
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
