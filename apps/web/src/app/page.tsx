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
    sourceStrategyName: string;
    candidateStrategyName: string | null;
    status: string;
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

export default async function DashboardPage() {
  const health = await getHealth();
  const dashboard = await getDashboardSummary();

  return (
    <main className="dashboard-shell">
      <section className="status-panel" aria-labelledby="status-heading">
        <div className="status-kicker">Phase 3 Candidate Tuning</div>
        <h1 id="status-heading">AI Trade Dashboard</h1>
        <p className="status-copy">
          System status, paper accounts, recent paper trades, and AI-generated candidate slots. Live
          trading and private order APIs are intentionally out of scope.
        </p>

        <div className="status-grid">
          <div className="status-row">
            <span>next-web</span>
            <strong>{health.ok ? "healthy" : "unhealthy"}</strong>
          </div>
          <div className="status-row">
            <span>tRPC health</span>
            <strong>{health.service}</strong>
          </div>
          <div className="status-row">
            <span>last checked</span>
            <strong>{health.timestamp}</strong>
          </div>
        </div>
      </section>

      <section className="dashboard-section" aria-labelledby="paper-heading">
        <h2 id="paper-heading">Paper Accounts</h2>
        <div className="data-grid">
          {dashboard.accounts.length === 0 ? (
            <div className="empty-row">No paper accounts recorded yet.</div>
          ) : (
            dashboard.accounts.map((account) => (
              <div className="data-row" key={account.name}>
                <span>{account.name}</span>
                <strong>{Number(account.balanceJpy).toLocaleString()} JPY</strong>
                <small>{account.status}</small>
              </div>
            ))
          )}
        </div>
      </section>

      <section className="dashboard-section" aria-labelledby="candidate-heading">
        <h2 id="candidate-heading">Strategy Comparison</h2>
        <div className="data-grid">
          {dashboard.candidates.length === 0 ? (
            <div className="empty-row">No AI candidates accepted yet.</div>
          ) : (
            dashboard.candidates.map((candidate) => (
              <div
                className="data-row"
                key={`${candidate.sourceStrategyName}-${candidate.createdAt}`}
              >
                <span>{candidate.candidateStrategyName}</span>
                <strong>{candidate.timeframe}</strong>
                <small>from {candidate.sourceStrategyName}</small>
              </div>
            ))
          )}
        </div>
      </section>

      <section className="dashboard-section" aria-labelledby="trade-heading">
        <h2 id="trade-heading">Recent Trades</h2>
        <div className="data-grid">
          {dashboard.trades.length === 0 ? (
            <div className="empty-row">No paper trades closed yet.</div>
          ) : (
            dashboard.trades.map((trade) => (
              <div className="data-row" key={`${trade.symbol}-${trade.closedAt}`}>
                <span>
                  {trade.symbol} {trade.side}
                </span>
                <strong>{Number(trade.pnlJpy).toLocaleString()} JPY</strong>
                <small>{trade.closedAt}</small>
              </div>
            ))
          )}
        </div>
      </section>

      <section className="dashboard-section" aria-labelledby="review-heading">
        <h2 id="review-heading">Daily Review</h2>
        <div className="review-grid">
          {dashboard.dailyReviews.length === 0 ? (
            <div className="empty-row">No AI daily review recorded yet.</div>
          ) : (
            dashboard.dailyReviews.map((review) => (
              <article className="review-panel" key={`${review.reviewDate}-${review.createdAt}`}>
                <div className="review-header">
                  <span>{review.reviewDate}</span>
                  <strong>{review.status}</strong>
                </div>
                <p>{review.summary ?? "Daily review was rejected or did not return a summary."}</p>
                <div className="review-columns">
                  <ReviewList
                    title="Promotion Candidates"
                    items={formatRecommendationItems(review.baselinePromotionCandidates)}
                  />
                  <ReviewList
                    title="Retirement Candidates"
                    items={formatRecommendationItems(review.candidateRetirementCandidates)}
                  />
                  <ReviewList title="Warnings" items={formatWarningItems(review.warnings)} />
                  <ReviewList title="Next Actions" items={formatStringItems(review.nextActions)} />
                </div>
              </article>
            ))
          )}
        </div>
      </section>
    </main>
  );
}

function ReviewList({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="review-list">
      <h3>{title}</h3>
      {items.length === 0 ? (
        <span className="muted-line">None</span>
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
