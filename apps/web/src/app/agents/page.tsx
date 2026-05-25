import Link from "next/link";

export const dynamic = "force-dynamic";

type AgentSummary = {
  id: string;
  name: string;
  persona: string;
  status: "active" | "paused";
  currentVersion: number;
  runIntervalSec: number;
  model: string;
  allowedTools: string[];
  maxConsecutiveFailures: number;
  consecutiveFailures: number;
  tokenBudgetPerRun: number;
  costBudgetPerRunUsd: number;
  pausedReason?: string;
  sharedMemoryEnabled: boolean;
  latestRun: {
    status: string;
    startedAt: string;
    finishedAt: string | null;
  } | null;
  proposalCount: number;
  acceptedProposalCount: number;
  rejectedProposalCount: number;
  succeededRunCount: number;
  failedRunCount: number;
};

async function getAgents(): Promise<AgentSummary[]> {
  const response = await fetch(
    new URL("/agents", process.env.WORKER_INTERNAL_URL ?? "http://localhost:8787"),
    {
      cache: "no-store",
    },
  ).catch(() => null);

  if (!response?.ok) {
    return [];
  }

  const body = (await response.json()) as { agents?: AgentSummary[] };
  return Array.isArray(body.agents) ? body.agents : [];
}

export default async function AgentsPage() {
  const agents = await getAgents();

  return (
    <main className="agent-shell">
      <header className="agent-top">
        <div>
          <p className="agent-kicker">Research + Evaluation</p>
          <h1>Agents</h1>
        </div>
        <Link className="agent-nav-link" href="/">
          Dashboard
        </Link>
      </header>

      <section className="agent-grid" aria-label="AI agents">
        {agents.length === 0 ? (
          <div className="agent-empty">Agent scheduler is not ready.</div>
        ) : (
          agents.map((agent) => (
            <Link key={agent.id} className="agent-card" href={`/agents/${agent.id}`}>
              <div className="agent-card-head">
                <div>
                  <h2>{agent.name}</h2>
                  <p>{agent.persona}</p>
                </div>
                <span className={`agent-status ${agent.status}`}>{agent.status}</span>
              </div>
              <dl className="agent-metrics">
                <div>
                  <dt>Version</dt>
                  <dd>{agent.currentVersion}</dd>
                </div>
                <div>
                  <dt>Interval</dt>
                  <dd>{agent.runIntervalSec}s</dd>
                </div>
                <div>
                  <dt>Tools</dt>
                  <dd>{agent.allowedTools.length}</dd>
                </div>
                <div>
                  <dt>Proposals</dt>
                  <dd>
                    {agent.acceptedProposalCount}/{agent.proposalCount}
                  </dd>
                </div>
                <div>
                  <dt>Runs</dt>
                  <dd>
                    {agent.succeededRunCount}/{agent.succeededRunCount + agent.failedRunCount}
                  </dd>
                </div>
                <div>
                  <dt>Failures</dt>
                  <dd>
                    {agent.consecutiveFailures}/{agent.maxConsecutiveFailures}
                  </dd>
                </div>
                <div>
                  <dt>Budget</dt>
                  <dd>${agent.costBudgetPerRunUsd}</dd>
                </div>
              </dl>
              <p className="agent-model">
                Latest run: {agent.latestRun ? agent.latestRun.status : "none"}
              </p>
              {agent.pausedReason ? <p className="agent-model">{agent.pausedReason}</p> : null}
              <p className="agent-model">{agent.model}</p>
            </Link>
          ))
        )}
      </section>
    </main>
  );
}
