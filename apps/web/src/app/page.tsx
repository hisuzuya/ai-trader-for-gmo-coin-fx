import type { UTCTimestamp } from "lightweight-charts";
import { revalidatePath } from "next/cache";
import { PnlChart, type PnlPoint } from "@/components/PnlChart";
import { appRouter } from "@/server/trpc/root";

export const dynamic = "force-dynamic";

type DashboardSummary = {
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
};

async function getHealth() {
  const caller = appRouter.createCaller({});
  return caller.health();
}

async function getDashboardSummary(): Promise<DashboardSummary> {
  const baseUrl = process.env.WORKER_INTERNAL_URL ?? "http://localhost:8787";
  const response = await fetch(new URL("/dashboard", baseUrl), {
    cache: "no-store",
  }).catch(() => null);

  if (!response?.ok) {
    return {
      accounts: [],
      trades: [],
      candidates: [],
      dailyReviews: [],
    };
  }

  const body = (await response.json()) as { summary?: DashboardSummary };

  return (
    body.summary ?? {
      accounts: [],
      trades: [],
      candidates: [],
      dailyReviews: [],
    }
  );
}

async function recordPaperDecision(formData: FormData) {
  "use server";

  const strategyRunId = formData.get("strategyRunId");
  const action = formData.get("action");

  if (
    typeof strategyRunId !== "string" ||
    typeof action !== "string" ||
    (action !== "promote_baseline" && action !== "retire_candidate")
  ) {
    return;
  }

  const baseUrl = process.env.WORKER_INTERNAL_URL ?? "http://localhost:8787";
  await fetch(new URL("/paper-decisions", baseUrl), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ strategyRunId, action }),
    cache: "no-store",
  });

  revalidatePath("/");
}

export default async function DashboardPage() {
  const health = await getHealth();
  const dashboard = await getDashboardSummary();
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

  return (
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
                    <span style={{ textAlign: "right" }}>残高</span>
                  </div>
                  {dashboard.accounts.map((account) => (
                    <article className="tv-watchlist-row" key={account.name}>
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
                    </article>
                  ))}
                </>
              )}
            </div>
          </section>
        </div>

        <div className="tv-col tv-col-center">
          <section className="tv-panel tv-chart-panel" aria-label="累積損益">
            <PanelHeader
              title="累積損益 / Cumulative PnL"
              meta={dashboard.trades.length > 0 ? `${dashboard.trades.length} fills` : "0 fills"}
            />
            <div className="tv-panel-body">
              <div className="tv-chart-summary">
                <div className="tv-chart-headline">
                  <span className="tv-chart-headline-label">確定損益 / Realized</span>
                  <span className={`tv-chart-headline-value ${pnlPositive ? "profit" : "loss"}`}>
                    {formatJpySigned(totalPnl)}
                    <span className="tv-chart-headline-delta">
                      {pnlPositive ? "▲" : "▼"} {formatJpyAbs(totalPnl)}
                    </span>
                  </span>
                </div>
                <div className="tv-chart-stats">
                  <div className="tv-chart-stat">
                    <span className="tv-chart-stat-label">勝率 / Win</span>
                    <span className="tv-chart-stat-value">
                      {dashboard.trades.length > 0 ? `${winRate.toFixed(1)}%` : "—"}
                    </span>
                  </div>
                  <div className="tv-chart-stat">
                    <span className="tv-chart-stat-label">取引 / Trades</span>
                    <span className="tv-chart-stat-value">
                      {dashboard.trades.length.toLocaleString()}
                    </span>
                  </div>
                  <div className="tv-chart-stat">
                    <span className="tv-chart-stat-label">候補 / Active</span>
                    <span className="tv-chart-stat-value">{activeCandidates.toLocaleString()}</span>
                  </div>
                </div>
              </div>

              {pnlSeries.length > 0 ? (
                <PnlChart data={pnlSeries} positive={pnlPositive} />
              ) : (
                <div className="tv-chart-empty">
                  確定取引が記録され次第、ここに累積損益が描画されます
                </div>
              )}
            </div>
          </section>

          <section className="tv-panel" aria-label="直近の確定取引">
            <PanelHeader
              title="直近の確定取引 / Recent Fills"
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
          <section className="tv-panel" aria-label="候補戦略">
            <PanelHeader title="候補戦略 / Candidates" meta={`${dashboard.candidates.length}`} />
            <div className="tv-panel-body">
              {dashboard.candidates.length === 0 ? (
                <EmptyState text="AI候補戦略はまだ承認されていません" />
              ) : (
                dashboard.candidates.map((candidate) => {
                  const status = candidate.strategyRunStatus ?? candidate.status;
                  const actionable = candidate.strategyRunStatus === "proposed";
                  return (
                    <article className="tv-strategy-row" key={candidate.id}>
                      <div className="tv-strategy-meta">
                        <span className="tv-strategy-name">
                          {candidate.candidateStrategyName ?? candidate.id}
                        </span>
                        <span className="tv-strategy-source">← {candidate.sourceStrategyName}</span>
                        <span className="tv-strategy-tags">
                          <span className="tv-tag">{candidate.timeframe}</span>
                          <span className={`tv-tag ${normalizeStatus(status)}`}>
                            {translateStatus(status)}
                          </span>
                        </span>
                      </div>
                      <form className="tv-strategy-actions" action={recordPaperDecision}>
                        <input type="hidden" name="strategyRunId" value={candidate.id} />
                        <button
                          className="tv-btn primary"
                          name="action"
                          type="submit"
                          value="promote_baseline"
                          disabled={!actionable}
                        >
                          採用
                        </button>
                        <button
                          className="tv-btn danger"
                          name="action"
                          type="submit"
                          value="retire_candidate"
                          disabled={!actionable}
                        >
                          停止
                        </button>
                      </form>
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
        PnL <strong style={{ color: `var(--${pnlClass}-strong)` }}>{formatJpySigned(pnl)}</strong>
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
        <nav className="tv-topbar-nav" aria-label="セクション">
          <a className="active" href="#overview">
            概況
          </a>
          <a href="#accounts">口座</a>
          <a href="#strategies">戦略</a>
          <a href="#trades">履歴</a>
          <a href="#reviews">AI</a>
        </nav>
      </div>
      <div className="tv-topbar-right">
        <span className="tv-system-pill">
          <span className={`tv-status-dot ${healthOk ? "live" : "danger"}`} />
          {healthOk ? "稼働中" : "要確認"}
        </span>
        <span className="tv-system-pill" title={`tRPC: ${healthService}`}>
          tRPC · {healthService}
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
          <span style={{ marginLeft: 8, color: "var(--muted)", fontSize: 13 }}>({trades})</span>
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

function formatJpyAbs(value: number) {
  return formatJpy(Math.abs(value));
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
    rejected: "却下",
    retired: "停止済み",
    running: "実行中",
    unhealthy: "異常",
  };

  return labels[status.toLowerCase()] ?? status;
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
