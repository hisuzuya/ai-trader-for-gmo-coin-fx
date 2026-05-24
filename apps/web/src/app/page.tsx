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
    };
  }

  const body = (await response.json()) as { summary?: DashboardSummary };

  return (
    body.summary ?? {
      accounts: [],
      trades: [],
      candidates: [],
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
    </main>
  );
}
