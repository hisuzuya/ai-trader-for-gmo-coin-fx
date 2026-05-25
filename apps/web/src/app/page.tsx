import { revalidatePath } from "next/cache";
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
  const activeCandidates = dashboard.candidates.filter(
    (candidate) => candidate.strategyRunStatus === "proposed" || candidate.status === "accepted",
  ).length;
  const latestReview = dashboard.dailyReviews[0];

  return (
    <main className="terminal-shell">
      <aside className="side-rail" aria-label="ダッシュボードナビゲーション">
        <div className="brand-mark">
          <span>AT</span>
        </div>
        <nav className="rail-nav">
          <a className="active" href="#overview">
            概況
          </a>
          <a href="#accounts">口座</a>
          <a href="#strategies">戦略</a>
          <a href="#trades">履歴</a>
          <a href="#reviews">AI</a>
        </nav>
        <div className="rail-status">
          <span className={health.ok ? "status-dot live" : "status-dot danger"} />
          <span>{health.ok ? "稼働中" : "要確認"}</span>
        </div>
      </aside>

      <div className="dashboard-workspace">
        <header className="trade-header" id="overview">
          <div>
            <p className="eyebrow">GMO Coin FX / Paper Trading</p>
            <h1>FXトレードダッシュボード</h1>
            <p className="header-copy">
              AI候補戦略、ペーパー口座、確定損益、日次レビューを1画面で確認できます。
            </p>
          </div>
          <div className="system-strip">
            <div>
              <span>Web</span>
              <strong>{health.ok ? "正常" : "異常"}</strong>
            </div>
            <div>
              <span>tRPC</span>
              <strong>{health.service}</strong>
            </div>
            <div>
              <span>確認時刻</span>
              <strong>{formatDateTime(health.timestamp)}</strong>
            </div>
          </div>
        </header>

        <section className="quote-board" aria-label="主要指標">
          <MetricTile label="総資産" value={formatJpy(totalBalance)} tone="neutral" />
          <MetricTile
            label="確定損益"
            value={formatJpy(totalPnl)}
            tone={totalPnl >= 0 ? "profit" : "loss"}
          />
          <MetricTile
            label="取引履歴"
            value={`${dashboard.trades.length.toLocaleString()} 件`}
            tone="neutral"
          />
          <MetricTile
            label="候補戦略"
            value={`${activeCandidates.toLocaleString()} 件`}
            tone="accent"
          />
        </section>

        <section className="main-grid">
          <section className="panel market-panel" id="accounts">
            <PanelHeader title="ペーパー口座" meta={`${dashboard.accounts.length} accounts`} />
            <div className="account-list">
              {dashboard.accounts.length === 0 ? (
                <EmptyState text="ペーパー口座はまだ記録されていません。" />
              ) : (
                dashboard.accounts.map((account) => (
                  <article className="account-row" key={account.name}>
                    <div>
                      <h3>{account.name}</h3>
                      <span>{translateStatus(account.status)}</span>
                    </div>
                    <strong>{formatJpy(Number(account.balanceJpy))}</strong>
                    <small>{formatDateTime(account.updatedAt)}</small>
                  </article>
                ))
              )}
            </div>
          </section>

          <section className="panel strategy-panel" id="strategies">
            <PanelHeader title="戦略比較" meta={`${dashboard.candidates.length} candidates`} />
            {dashboard.candidates.length === 0 ? (
              <EmptyState text="AI候補戦略はまだ承認されていません。" />
            ) : (
              <table className="strategy-table">
                <thead>
                  <tr className="table-head">
                    <th scope="col">候補名</th>
                    <th scope="col">足種</th>
                    <th scope="col">状態</th>
                    <th scope="col">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {dashboard.candidates.map((candidate) => (
                    <tr className="strategy-row" key={candidate.id}>
                      <td>
                        <strong>{candidate.candidateStrategyName ?? candidate.id}</strong>
                        <small>元戦略: {candidate.sourceStrategyName}</small>
                      </td>
                      <td>{candidate.timeframe}</td>
                      <td>
                        <span className="status-pill">
                          {translateStatus(candidate.strategyRunStatus ?? candidate.status)}
                        </span>
                      </td>
                      <td>
                        <form className="paper-actions" action={recordPaperDecision}>
                          <input type="hidden" name="strategyRunId" value={candidate.id} />
                          <button
                            name="action"
                            type="submit"
                            value="promote_baseline"
                            disabled={candidate.strategyRunStatus !== "proposed"}
                          >
                            採用
                          </button>
                          <button
                            name="action"
                            type="submit"
                            value="retire_candidate"
                            disabled={candidate.strategyRunStatus !== "proposed"}
                          >
                            停止
                          </button>
                        </form>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <section className="panel trades-panel" id="trades">
            <PanelHeader title="直近の確定取引" meta={`${dashboard.trades.length} closed`} />
            {dashboard.trades.length === 0 ? (
              <EmptyState text="確定済みのペーパー取引はまだありません。" />
            ) : (
              <table className="trade-table">
                <thead>
                  <tr className="table-head">
                    <th scope="col">通貨ペア</th>
                    <th scope="col">売買</th>
                    <th scope="col">損益</th>
                    <th scope="col">決済日時</th>
                  </tr>
                </thead>
                <tbody>
                  {dashboard.trades.map((trade) => {
                    const pnl = Number(trade.pnlJpy);
                    return (
                      <tr className="trade-row" key={`${trade.symbol}-${trade.closedAt}`}>
                        <td>
                          <strong>{formatSymbol(trade.symbol)}</strong>
                        </td>
                        <td>
                          <span className={`side-badge ${trade.side.toLowerCase()}`}>
                            {translateSide(trade.side)}
                          </span>
                        </td>
                        <td>
                          <span className={pnl >= 0 ? "price-up" : "price-down"}>
                            {formatJpy(pnl)}
                          </span>
                        </td>
                        <td>
                          <small>{formatDateTime(trade.closedAt)}</small>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </section>

          <section className="panel review-panel" id="reviews">
            <PanelHeader
              title="AI日次レビュー"
              meta={latestReview ? formatDate(latestReview.reviewDate) : "no review"}
            />
            {dashboard.dailyReviews.length === 0 ? (
              <EmptyState text="AI日次レビューはまだ記録されていません。" />
            ) : (
              <div className="review-stack">
                {dashboard.dailyReviews.map((review) => (
                  <article className="review-card" key={`${review.reviewDate}-${review.createdAt}`}>
                    <div className="review-card-header">
                      <div>
                        <strong>{formatDate(review.reviewDate)}</strong>
                        <span>{translateStatus(review.status)}</span>
                      </div>
                      <small>{formatDateTime(review.createdAt)}</small>
                    </div>
                    <p>{review.summary ?? "レビューは却下、または要約が返されませんでした。"}</p>
                    <div className="review-columns">
                      <ReviewList
                        title="採用候補"
                        items={formatRecommendationItems(review.baselinePromotionCandidates)}
                      />
                      <ReviewList
                        title="停止候補"
                        items={formatRecommendationItems(review.candidateRetirementCandidates)}
                      />
                      <ReviewList title="警告" items={formatWarningItems(review.warnings)} />
                      <ReviewList title="次の対応" items={formatStringItems(review.nextActions)} />
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        </section>
      </div>
    </main>
  );
}

function MetricTile({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "neutral" | "profit" | "loss" | "accent";
}) {
  return (
    <div className={`metric-tile ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function PanelHeader({ title, meta }: { title: string; meta: string }) {
  return (
    <div className="panel-header">
      <h2>{title}</h2>
      <span>{meta}</span>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return <div className="empty-state">{text}</div>;
}

function ReviewList({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="review-list">
      <h3>{title}</h3>
      {items.length === 0 ? (
        <span className="muted-line">なし</span>
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

function formatJpy(value: number) {
  return new Intl.NumberFormat("ja-JP", {
    style: "currency",
    currency: "JPY",
    maximumFractionDigits: 0,
  }).format(value);
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
    return "買い";
  }

  if (normalized === "sell" || normalized === "short") {
    return "売り";
  }

  return side;
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
