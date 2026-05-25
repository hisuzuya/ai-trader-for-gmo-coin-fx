import { AGENT_CHARACTERS, getCharacter } from "@ai-trade/domain/ai-agents/characters";
import type { UTCTimestamp } from "lightweight-charts";
import Image from "next/image";
import Link from "next/link";
import { type AgentSummaryRaw, fetchAgentSummaries } from "@/components/agents/CrewPanelSection";
import { CrewTile } from "@/components/agents/CrewTile";
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

  const [health, dashboard, recentCandles, agentSummaries] = await Promise.all([
    getHealth(),
    getDashboardSummary(accountParam),
    getRecentCandles(),
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
  const candleSeries = buildCandleSeries(recentCandles.candles);
  const lastCandle = candleSeries.at(-1) ?? null;
  const firstCandle = candleSeries.at(0) ?? null;
  const candleChange = lastCandle && firstCandle ? lastCandle.close - firstCandle.open : 0;
  const candleChangePct =
    lastCandle && firstCandle && firstCandle.open !== 0
      ? (candleChange / firstCandle.open) * 100
      : 0;
  const candleUp = candleChange >= 0;
  const topPerformers = [...agentSummaries]
    .filter((agent) => agent.paperAccount !== null)
    .sort((a, b) => (b.paperAccount?.pnlJpy ?? 0) - (a.paperAccount?.pnlJpy ?? 0))
    .slice(0, 3);

  return (
    <div className="home">
      {/* === Hero: 全体スナップショット ===================================== */}
      <section className="home-hero" aria-label="ダッシュボード概要">
        <div className="home-hero-left">
          <div className="home-hero-meta">
            <p className="home-kicker">AI Crew Overview · USD/JPY · Paper</p>
            <div className="home-hero-meta-status">
              <span className={`home-hero-pill ${health.ok ? "live" : "danger"}`}>
                <span className={`tv-status-dot ${health.ok ? "live" : "danger"}`} />
                <span>Worker</span>
                <strong>{health.ok ? "CONNECTED" : "DEGRADED"}</strong>
              </span>
              <span className="home-hero-clock">{formatDateTime(health.timestamp)}</span>
            </div>
          </div>
          <div>
            <h1 className="home-hero-title">
              本日の <strong>AIクルー</strong> 全体ステータス
            </h1>
            <p className="home-hero-sub">
              {agentSummaries.length}
              体のクルーがUSD/JPYのペーパー取引を運用中。残高・確定損益・候補戦略・AI日次レビューを一画面で確認できます。
            </p>
          </div>
          <dl className="home-hero-kpis">
            <KpiCell
              label="Crew Equity"
              value={formatJpy(totalBalance)}
              foot={`Initial ${formatJpy(totalInitialBalance)}`}
            />
            <KpiCell
              label="Unrealized PnL"
              value={formatJpySigned(totalUnrealizedPnl)}
              tone={totalUnrealizedPnl > 0 ? "profit" : totalUnrealizedPnl < 0 ? "loss" : undefined}
              spark={`${totalUnrealizedPnlPct >= 0 ? "+" : "−"}${Math.abs(totalUnrealizedPnlPct).toFixed(2)}%`}
              sparkTone={totalUnrealizedPnl >= 0 ? "profit" : "loss"}
            />
            <KpiCell
              label="Realized PnL"
              value={formatJpySigned(totalPnl)}
              tone={totalPnl > 0 ? "profit" : totalPnl < 0 ? "loss" : undefined}
              foot={`${dashboard.trades.length} fills · ${dashboard.trades.length > 0 ? `${winRate.toFixed(1)}%` : "—"} win`}
            />
            <KpiCell
              label="Active Agents"
              value={`${activeAgents} / ${AGENT_CHARACTERS.length}`}
              tone="accent"
              foot={`${totalOpenPositions} open positions`}
            />
          </dl>
        </div>

        <aside className="home-hero-side" aria-label="トップ成績エージェント">
          <div className="home-hero-side-head">
            <span className="home-hero-side-title">Top Crew</span>
            <Link className="btn-ghost" href="/agents">
              管理 →
            </Link>
          </div>
          {topPerformers.length === 0 ? (
            <p className="text-[12px] text-muted">
              ペーパー口座を持つエージェントがまだいません。
              <br />
              <Link className="text-accent-strong" href="/agents#picker">
                ＋ クルーを配属する →
              </Link>
            </p>
          ) : (
            <div className="home-hero-bars">
              {topPerformers.map((agent) => {
                const pnl = agent.paperAccount?.pnlJpy ?? 0;
                const balance = agent.paperAccount?.balanceJpy ?? 0;
                const initial = agent.paperAccount?.initialBalanceJpy ?? 0;
                const maxBalance = Math.max(
                  ...topPerformers.map((a) => a.paperAccount?.balanceJpy ?? 0),
                  1,
                );
                const pct = (balance / maxBalance) * 100;
                const tone = pnl > 0 ? "" : pnl < 0 ? "loss" : "flat";
                return (
                  <Link
                    key={agent.id}
                    href={`/agents/${agent.id}`}
                    className="home-hero-bar"
                    aria-label={`${agent.name} の口座`}
                  >
                    <span className="home-hero-bar-label">{agent.name}</span>
                    <span className="home-hero-bar-track" aria-hidden>
                      <span
                        className={`home-hero-bar-fill ${tone}`}
                        style={{ transform: `scaleX(${(pct / 100).toFixed(3)})` }}
                      />
                    </span>
                    <span className="home-hero-bar-value">
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

      {/* === AI Crew Tiles =============================================== */}
      <section className="home-section" aria-label="AI Crew">
        <header className="home-section-head">
          <div className="home-section-head-meta">
            <p className="home-kicker">AI Crew</p>
            <h2 className="home-section-title">エージェント・クルー</h2>
            <p className="home-section-desc">
              各キャラクターは独自のペルソナを持ち、専用のペーパー口座で戦略を運用します。タイルから個別の詳細画面に遷移できます。
            </p>
          </div>
          <div className="home-section-actions">
            <Link href="/agents#picker" className="btn-primary">
              ＋ New Agent
            </Link>
            <Link href="/agents" className="btn-secondary">
              一覧へ
            </Link>
          </div>
        </header>
        <div className="crew-grid">
          {AGENT_CHARACTERS.map((character) => {
            const agent = agentSummaries.find((a) => a.characterId === character.id) ?? null;
            const summary = agent
              ? {
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
                }
              : null;
            return <CrewTile key={character.id} character={character} agent={summary} />;
          })}
        </div>
      </section>

      {/* === Market chart =============================================== */}
      <section className="home-section" aria-label="Market">
        <header className="home-section-head">
          <div className="home-section-head-meta">
            <p className="home-kicker">Market · USD/JPY</p>
            <h2 className="home-section-title">マーケット & プライス</h2>
            <p className="home-section-desc">
              内部蓄積のローソク足からダッシュボード用のスナップショットを表示。詳細な時間足/BID-ASK切替は
              Market 画面で。
            </p>
          </div>
          <div className="home-section-actions">
            <Link href="/market" className="btn-primary">
              📈 フルチャートを開く
            </Link>
          </div>
        </header>

        <div className="home-card">
          <div className="home-card-head">
            <span className="home-card-head-title">
              {formatSymbol(recentCandles.symbol)} · {recentCandles.timeframe.toUpperCase()} ·{" "}
              {recentCandles.priceType.toUpperCase()}
            </span>
            <span className="home-card-head-meta">
              <span className="meta-chip">{candleSeries.length} bars</span>
              <Link href="/market" className="meta-chip">
                Market →
              </Link>
            </span>
          </div>
          <div className="home-card-body">
            <div className="home-chart-summary">
              <div className="home-chart-price">
                <span className={`home-chart-price-value ${candleUp ? "profit" : "loss"}`}>
                  {lastCandle ? lastCandle.close.toFixed(3) : "—"}
                </span>
                {lastCandle && firstCandle ? (
                  <span className={`home-chart-price-delta ${candleUp ? "profit" : "loss"}`}>
                    {candleUp ? "▲" : "▼"} {Math.abs(candleChange).toFixed(3)}
                    <span style={{ opacity: 0.75 }}>
                      ({candleChangePct >= 0 ? "+" : "−"}
                      {Math.abs(candleChangePct).toFixed(2)}%)
                    </span>
                  </span>
                ) : null}
              </div>
              <div className="home-chart-stats">
                <div className="home-chart-stat">
                  <span className="home-chart-stat-label">High</span>
                  <span className="home-chart-stat-value">
                    {lastCandle ? lastCandle.high.toFixed(3) : "—"}
                  </span>
                </div>
                <div className="home-chart-stat">
                  <span className="home-chart-stat-label">Low</span>
                  <span className="home-chart-stat-value">
                    {lastCandle ? lastCandle.low.toFixed(3) : "—"}
                  </span>
                </div>
                <div className="home-chart-stat">
                  <span className="home-chart-stat-label">Bars</span>
                  <span className="home-chart-stat-value">
                    {candleSeries.length.toLocaleString()}
                  </span>
                </div>
              </div>
            </div>
            <div className="home-chart-frame">
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
                <div className="home-chart-empty">
                  USD/JPYのMIDキャンドルが取得できていません
                  <br />
                  (worker未起動 / データ未蓄積)
                  <br />
                  <Link href="/market" className="text-accent-strong">
                    Market画面で公開APIのレートを確認 →
                  </Link>
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* === Performance: PnL + Recent Fills + Crew watchlist ============ */}
      <section className="home-section" aria-label="Performance">
        <header className="home-section-head">
          <div className="home-section-head-meta">
            <p className="home-kicker">Performance</p>
            <h2 className="home-section-title">パフォーマンス</h2>
            <p className="home-section-desc">
              確定済みのペーパー取引から累積損益と直近の約定を集計。クルー別の口座状況も切り替え可能です。
            </p>
          </div>
          <div className="home-section-actions">
            <Link href="/activity?kind=runs" className="btn-ghost">
              実行履歴 →
            </Link>
          </div>
        </header>

        <div className="home-grid-2">
          <div className="home-card">
            <div className="home-card-head">
              <span className="home-card-head-title">
                累積損益 / Cumulative PnL
                {selectedAccountName ? ` · ${selectedAccountName}` : ""}
              </span>
              <span className="home-card-head-meta">
                <span className="meta-chip">{dashboard.trades.length} fills</span>
              </span>
            </div>
            <div className="home-card-body">
              <div className="home-chart-summary">
                <div className="home-chart-price">
                  <span
                    className={`home-chart-price-value ${pnlPositive ? "profit" : "loss"}`}
                    style={{ fontSize: 24 }}
                  >
                    {formatJpySigned(totalPnl)}
                  </span>
                  <span className={`home-chart-price-delta ${pnlPositive ? "profit" : "loss"}`}>
                    勝率 {dashboard.trades.length > 0 ? `${winRate.toFixed(1)}%` : "—"}
                  </span>
                </div>
              </div>
              {pnlSeries.length > 0 ? (
                <PnlChart data={pnlSeries} positive={pnlPositive} />
              ) : (
                <div className="home-chart-empty" style={{ minHeight: 160 }}>
                  確定取引が記録され次第、ここに累積損益が描画されます
                </div>
              )}
            </div>
          </div>

          <div className="home-card">
            <div className="home-card-head">
              <span className="home-card-head-title">エージェント口座 / Agents</span>
              <span className="home-card-head-meta">
                <span className="meta-chip">{agentSummaries.length} crew</span>
              </span>
            </div>
            <div className="home-card-body flush scroll">
              {agentSummaries.length === 0 ? (
                <div className="home-insight-empty">
                  エージェントがまだ配属されていません
                  <br />
                  <Link href="/agents#picker" className="text-accent-strong">
                    ＋ クルーを配属する →
                  </Link>
                </div>
              ) : (
                <div className="home-watchlist">
                  <Link
                    href="/"
                    scroll={false}
                    className={`home-watchlist-row ${isAccountView ? "" : "active"}`}
                  >
                    <span className="home-watchlist-avatar" aria-hidden>
                      Σ
                    </span>
                    <span className="home-watchlist-name">
                      <span className="home-watchlist-name-main">クルー合計</span>
                      <span className="home-watchlist-name-sub">
                        <span className="tv-tag">ALL</span>
                        {agentSummaries.length} agents
                      </span>
                    </span>
                    <span className="home-watchlist-balance">
                      <span className="home-watchlist-balance-main">{formatJpy(totalBalance)}</span>
                      <span
                        className={`home-watchlist-balance-sub ${
                          totalUnrealizedPnl > 0 ? "profit" : totalUnrealizedPnl < 0 ? "loss" : ""
                        }`}
                      >
                        {formatJpySigned(totalUnrealizedPnl)}
                      </span>
                    </span>
                  </Link>
                  {agentSummaries.map((agent) => (
                    <AgentAccountRow key={agent.id} agent={agent} />
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="home-card">
          <div className="home-card-head">
            <span className="home-card-head-title">
              直近の確定取引 / Recent Fills
              {selectedAccountName ? ` · ${selectedAccountName}` : ""}
            </span>
            <span className="home-card-head-meta">
              <span className="meta-chip">{dashboard.trades.length} fills</span>
            </span>
          </div>
          <div className="home-card-body flush">
            {dashboard.trades.length === 0 ? (
              <div className="home-insight-empty">確定済みのペーパー取引はまだありません</div>
            ) : (
              <div style={{ overflow: "auto" }}>
                <table className="home-trade-table">
                  <thead>
                    <tr>
                      <th>通貨ペア</th>
                      <th>売買</th>
                      <th className="num">損益 (JPY)</th>
                      <th className="num">決済日時</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dashboard.trades.slice(0, 12).map((trade) => {
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
              </div>
            )}
          </div>
        </div>

        {dashboard.accountDetail ? (
          <div className="home-grid-2">
            <AccountStrategyPanel detail={dashboard.accountDetail} />
            <PositionsPanel detail={dashboard.accountDetail} />
          </div>
        ) : null}
      </section>

      {/* === AI Insights: Review + Candidates =========================== */}
      <section className="home-section" aria-label="AI Insights">
        <header className="home-section-head">
          <div className="home-section-head-meta">
            <p className="home-kicker">AI Insights</p>
            <h2 className="home-section-title">AIインサイト</h2>
            <p className="home-section-desc">
              AIの日次レビューと審査中の候補戦略を要約。詳細は Activity 画面で時系列に確認できます。
            </p>
          </div>
          <div className="home-section-actions">
            <Link href="/activity?kind=proposals" className="btn-ghost">
              提案を見る →
            </Link>
            <Link href="/activity?kind=runs" className="btn-ghost">
              実行を見る →
            </Link>
          </div>
        </header>

        <div className="home-grid-3">
          <div className="home-card">
            <div className="home-card-head">
              <span className="home-card-head-title">AI日次レビュー / Daily Review</span>
              <span className="home-card-head-meta">
                <span className="meta-chip">
                  {latestReview ? formatDate(latestReview.reviewDate) : "—"}
                </span>
              </span>
            </div>
            <div className="home-card-body">
              {dashboard.dailyReviews.length === 0 ? (
                <div className="home-insight-empty">AI日次レビューはまだ記録されていません</div>
              ) : (
                <div>
                  {dashboard.dailyReviews.slice(0, 2).map((review) => (
                    <article
                      className="home-review"
                      key={`${review.reviewDate}-${review.createdAt}`}
                    >
                      <header className="home-review-head">
                        <div className="home-review-head-left">
                          <span className="home-review-date">{formatDate(review.reviewDate)}</span>
                          <span className={`tv-tag ${normalizeStatus(review.status)}`}>
                            {translateStatus(review.status)}
                          </span>
                        </div>
                        <span className="home-review-time">{formatDateTime(review.createdAt)}</span>
                      </header>
                      <p className="home-review-summary">
                        {review.summary ?? "レビューは却下、または要約が返されませんでした。"}
                      </p>
                      <div className="home-review-cols">
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

          <div className="home-card">
            <div className="home-card-head">
              <span className="home-card-head-title">候補戦略 / Candidates</span>
              <span className="home-card-head-meta">
                <span className="meta-chip">{dashboard.candidates.length} 件</span>
              </span>
            </div>
            <div className="home-card-body flush scroll">
              {dashboard.candidates.length === 0 ? (
                <div className="home-insight-empty">AI候補戦略はまだ承認されていません</div>
              ) : (
                dashboard.candidates.map((candidate) => {
                  const status = candidate.strategyRunStatus ?? candidate.status;
                  return (
                    <article className="home-candidate" key={candidate.id}>
                      <div className="home-candidate-meta">
                        <span className="home-candidate-name">
                          {candidate.candidateStrategyName ?? candidate.id}
                        </span>
                        <span className="home-candidate-source">
                          ← {candidate.sourceStrategyName}
                        </span>
                        <span className="home-candidate-tags">
                          <span className="tv-tag">{candidate.timeframe}</span>
                          <span className={`tv-tag ${normalizeStatus(status)}`}>
                            {translateStatus(status)}
                          </span>
                        </span>
                      </div>
                      <div className="home-candidate-status">
                        <span className="home-candidate-status-label">自動審査</span>
                        <span className="home-candidate-status-value">
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
  return (
    <div className="home-kpi">
      <span className="home-kpi-label">{label}</span>
      <span className={`home-kpi-value ${tone ?? ""}`}>{value}</span>
      {(foot || spark) && (
        <span className="home-kpi-foot">
          {spark ? <span className={`home-kpi-spark ${sparkTone ?? ""}`}>{spark}</span> : null}
          {foot ? <span>{foot}</span> : null}
        </span>
      )}
    </div>
  );
}

function AgentAccountRow({ agent }: { agent: AgentSummaryRaw }) {
  const character = getCharacter(agent.characterId);
  const account = agent.paperAccount;
  const pnl = account?.pnlJpy ?? 0;
  const balance = account?.balanceJpy ?? 0;
  const pnlClass = pnl > 0 ? "profit" : pnl < 0 ? "loss" : "";
  return (
    <Link
      href={`/agents/${agent.id}`}
      className="home-watchlist-row"
      data-character-id={character?.id ?? "unassigned"}
    >
      <span className="home-watchlist-avatar" aria-hidden>
        {character ? (
          <Image
            src={character.avatarPath ?? character.imagePath}
            alt={`${character.name} avatar`}
            width={36}
            height={36}
            unoptimized
          />
        ) : (
          (agent.name[0] ?? "?")
        )}
      </span>
      <span className="home-watchlist-name">
        <span className="home-watchlist-name-main">{agent.name}</span>
        <span className="home-watchlist-name-sub">
          <span className={`tv-tag ${normalizeStatus(agent.status)}`}>
            {translateStatus(agent.status)}
          </span>
          {account ? `${account.openPositionCount} open` : "no account"}
        </span>
      </span>
      <span className="home-watchlist-balance">
        <span className="home-watchlist-balance-main">{account ? formatJpy(balance) : "—"}</span>
        <span className={`home-watchlist-balance-sub ${pnlClass}`}>
          {account ? formatJpySigned(pnl) : ""}
        </span>
      </span>
    </Link>
  );
}

function ReviewCol({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="home-review-col">
      <h4>{title}</h4>
      {items.length === 0 ? (
        <span className="home-review-empty">なし</span>
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

function AccountStrategyPanel({ detail }: { detail: AccountDetail }) {
  const run = detail.strategyRun;
  const definitionPreview = formatStrategyDefinitionPreview(run?.strategyDefinition);
  const balance = Number(detail.balanceJpy);
  const initial = Number(detail.initialBalanceJpy);
  const pnl = Number.isFinite(balance) && Number.isFinite(initial) ? balance - initial : 0;
  const pnlPositive = pnl >= 0;
  return (
    <div className="home-card">
      <div className="home-card-head">
        <span className="home-card-head-title">戦略詳細 / Strategy · {detail.name}</span>
        <span className="home-card-head-meta">
          <span className="meta-chip">{run ? run.status.toUpperCase() : "—"}</span>
        </span>
      </div>
      <div className="home-card-body">
        <dl className="home-strategy-grid">
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
            <dd className={pnlPositive ? "profit" : "loss"}>{formatJpySigned(pnl)}</dd>
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
    </div>
  );
}

function PositionsPanel({ detail }: { detail: AccountDetail }) {
  return (
    <div className="home-card">
      <div className="home-card-head">
        <span className="home-card-head-title">保有ポジション · {detail.name}</span>
        <span className="home-card-head-meta">
          <span className="meta-chip">{detail.openPositions.length} 件</span>
        </span>
      </div>
      <div className="home-card-body flush">
        {detail.openPositions.length === 0 ? (
          <div className="home-insight-empty">現在この口座に保有ポジションはありません</div>
        ) : (
          <div className="home-positions">
            {detail.openPositions.map((position) => (
              <article className="home-position" key={`${position.openedAt}-${position.symbol}`}>
                <div className="home-position-head">
                  <span className="tv-symbol">{formatSymbol(position.symbol)}</span>
                  <span className={`tv-side ${position.side.toLowerCase()}`}>
                    {translateSide(position.side)}
                  </span>
                  <span className="tv-time">{formatDateTime(position.openedAt)}</span>
                </div>
                <dl className="home-position-grid">
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
