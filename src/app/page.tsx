import { appRouter } from "@/server/trpc/root";

async function getHealth() {
  const caller = appRouter.createCaller({});
  return caller.health();
}

export default async function DashboardPage() {
  const health = await getHealth();

  return (
    <main className="dashboard-shell">
      <section className="status-panel" aria-labelledby="status-heading">
        <div className="status-kicker">Phase 0 Scaffold</div>
        <h1 id="status-heading">System Status</h1>
        <p className="status-copy">
          Next.js dashboard, tRPC, Drizzle, TimescaleDB, and worker runtime are
          wired for local verification. Live trading and private order APIs are
          intentionally out of scope.
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
    </main>
  );
}
