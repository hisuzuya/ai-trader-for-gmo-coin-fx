import Link from "next/link";
import { notFound } from "next/navigation";
import { deleteAgentMemory, rollbackAgentVersion, saveAgentVersion } from "../actions";

export const dynamic = "force-dynamic";

const TOOL_LABELS = [
  "read_bars",
  "calc_indicator",
  "get_candidate_performance",
  "get_rejection_history",
  "recall_memory",
] as const;

type AgentDetail = {
  id: string;
  name: string;
  persona: string;
  systemPrompt: string;
  allowedTools: string[];
  status: "active" | "paused";
  currentVersion: number;
  runIntervalSec: number;
  model: string;
  maxConsecutiveFailures: number;
  consecutiveFailures: number;
  tokenBudgetPerRun: number;
  costBudgetPerRunUsd: number;
  pausedReason?: string;
  sharedMemoryEnabled: boolean;
  observations: {
    id: string;
    kind: string;
    summary: string;
    evidence: unknown;
    tags: string[];
    createdAt: string;
  }[];
  memories: {
    id: string;
    type: string;
    content: string;
    tags: string[];
    sourceRefs: unknown;
    createdAt: string;
  }[];
  proposals: {
    id: string;
    strategyName: string;
    validationStatus: string;
    rejectionReasons: unknown;
    insertedStrategyRunId: string | null;
    strategyRunStatus: string | null;
    createdAt: string;
  }[];
  reviews: {
    id: string;
    strategyName: string;
    recommendation: string;
    confidence: string;
    reason: string;
    evidence: unknown;
    applied: boolean;
    createdAt: string;
  }[];
  runs: {
    id: string;
    agentVersion: number;
    status: string;
    outputSummary: unknown;
    toolCalls: unknown;
    tokenUsage: unknown;
    error: string | null;
    startedAt: string;
    finishedAt: string | null;
  }[];
  versions: {
    id: string;
    version: number;
    systemPrompt: string;
    allowedTools: string[];
    note: string | null;
    createdAt: string;
  }[];
};

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

async function getAgent(id: string): Promise<AgentDetail | null> {
  const response = await fetch(
    new URL(`/agents/${id}`, process.env.WORKER_INTERNAL_URL ?? "http://localhost:8787"),
    {
      cache: "no-store",
    },
  ).catch(() => null);

  if (!response?.ok) {
    return null;
  }

  const body = (await response.json()) as { agent?: AgentDetail };
  return body.agent ?? null;
}

export default async function AgentDetailPage({ params, searchParams }: PageProps) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const agent = await getAgent(id);

  if (!agent) {
    notFound();
  }

  const saveAction = saveAgentVersion.bind(null, agent.id);
  const rollbackAction = rollbackAgentVersion.bind(null, agent.id);
  const deleteMemoryAction = deleteAgentMemory.bind(null, agent.id);
  const warning = query.warning === "secret_like";
  const saved = query.saved === "1";
  const rolledBack = query.rolledBack === "1";
  const memoryDeleted = query.memoryDeleted === "1";

  return (
    <main className="agent-shell">
      <header className="agent-top">
        <div>
          <p className="agent-kicker">Agent Detail</p>
          <h1>{agent.name}</h1>
        </div>
        <Link className="agent-nav-link" href="/agents">
          Agents
        </Link>
      </header>

      <section className="agent-detail-layout">
        <aside className="agent-side">
          <span className={`agent-status ${agent.status}`}>{agent.status}</span>
          <dl className="agent-stack">
            <div>
              <dt>Persona</dt>
              <dd>{agent.persona}</dd>
            </div>
            <div>
              <dt>Model</dt>
              <dd>{agent.model}</dd>
            </div>
            <div>
              <dt>Current version</dt>
              <dd>{agent.currentVersion}</dd>
            </div>
            <div>
              <dt>Run interval</dt>
              <dd>{agent.runIntervalSec}s</dd>
            </div>
            <div>
              <dt>Failure budget</dt>
              <dd>
                {agent.consecutiveFailures}/{agent.maxConsecutiveFailures}
              </dd>
            </div>
            <div>
              <dt>Token budget</dt>
              <dd>{agent.tokenBudgetPerRun}</dd>
            </div>
            <div>
              <dt>Cost budget</dt>
              <dd>${agent.costBudgetPerRunUsd}</dd>
            </div>
            <div>
              <dt>Shared memory</dt>
              <dd>{agent.sharedMemoryEnabled ? "enabled" : "disabled"}</dd>
            </div>
            {agent.pausedReason ? (
              <div>
                <dt>Paused reason</dt>
                <dd>{agent.pausedReason}</dd>
              </div>
            ) : null}
          </dl>
        </aside>

        <div className="agent-main">
          <section className="agent-panel">
            <div className="agent-section-title">
              <h2>Prompt</h2>
              {saved ? <span>Saved</span> : null}
              {rolledBack ? <span>Rolled back</span> : null}
              {memoryDeleted ? <span>Memory deleted</span> : null}
              {warning ? (
                <strong>Secret-like text was detected. Remove it before saving.</strong>
              ) : null}
            </div>
            <form action={saveAction} className="agent-form">
              <textarea name="systemPrompt" defaultValue={agent.systemPrompt} />
              <fieldset>
                <legend>Allowed tools</legend>
                <div className="agent-tools">
                  {TOOL_LABELS.map((tool) => (
                    <label key={tool}>
                      <input
                        type="checkbox"
                        name="allowedTools"
                        value={tool}
                        defaultChecked={agent.allowedTools.includes(tool)}
                      />
                      <span>{tool}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
              <input name="note" placeholder="Version note" />
              <button type="submit">Create version</button>
            </form>
          </section>

          <section className="agent-panel">
            <h2>Overview</h2>
            <div className="agent-log-grid">
              <ReadOnlyBlock title="Latest observations" value={agent.observations.slice(0, 3)} />
              <ReadOnlyBlock title="Recent proposals" value={agent.proposals.slice(0, 3)} />
              <ReadOnlyBlock title="Candidate reviews" value={agent.reviews.slice(0, 3)} />
            </div>
          </section>

          <section className="agent-panel">
            <h2>Memories</h2>
            <div className="agent-list">
              {agent.memories.length === 0 ? <p>No memories.</p> : null}
              {agent.memories.map((memory) => (
                <article key={memory.id}>
                  <header>
                    <strong>{memory.type}</strong>
                    <span>{memory.createdAt}</span>
                  </header>
                  <pre>{memory.content}</pre>
                  <form action={deleteMemoryAction}>
                    <input type="hidden" name="memoryId" value={memory.id} />
                    <button type="submit">Delete</button>
                  </form>
                </article>
              ))}
            </div>
          </section>

          <section className="agent-panel">
            <h2>Proposals</h2>
            <div className="agent-list">
              {agent.proposals.length === 0 ? <p>No proposals.</p> : null}
              {agent.proposals.map((proposal) => (
                <article key={proposal.id}>
                  <header>
                    <strong>{proposal.strategyName}</strong>
                    <span>{proposal.validationStatus}</span>
                  </header>
                  <ReadOnlyBlock title="Paper status" value={proposal.strategyRunStatus} />
                  <ReadOnlyBlock title="Rejection reasons" value={proposal.rejectionReasons} />
                </article>
              ))}
            </div>
          </section>

          <section className="agent-panel">
            <h2>Reviews</h2>
            <div className="agent-list">
              {agent.reviews.length === 0 ? <p>No reviews.</p> : null}
              {agent.reviews.map((review) => (
                <article key={review.id}>
                  <header>
                    <strong>{review.strategyName}</strong>
                    <span>
                      {review.recommendation} / {review.confidence}
                    </span>
                  </header>
                  <p>{review.reason}</p>
                  <ReadOnlyBlock title="Evidence" value={review.evidence} />
                </article>
              ))}
            </div>
          </section>

          <section className="agent-panel">
            <h2>Runs</h2>
            <div className="agent-list">
              {agent.runs.length === 0 ? <p>No runs.</p> : null}
              {agent.runs.map((run) => (
                <article key={run.id}>
                  <header>
                    <strong>
                      v{run.agentVersion} / {run.status}
                    </strong>
                    <span>{run.startedAt}</span>
                  </header>
                  <ReadOnlyBlock title="Output validation" value={run.outputSummary} />
                  <ReadOnlyBlock title="Tool calls" value={run.toolCalls} />
                  <ReadOnlyBlock title="Token usage" value={run.tokenUsage} />
                  {run.error ? <pre>{run.error}</pre> : null}
                </article>
              ))}
            </div>
          </section>

          <section className="agent-panel">
            <h2>Versions</h2>
            <div className="agent-list">
              {agent.versions.map((version) => (
                <article key={version.id}>
                  <header>
                    <strong>v{version.version}</strong>
                    <span>{version.createdAt}</span>
                  </header>
                  {version.note ? <p>{version.note}</p> : null}
                  <pre>{version.systemPrompt}</pre>
                  <ReadOnlyBlock title="Allowed tools" value={version.allowedTools} />
                  <form action={rollbackAction}>
                    <input type="hidden" name="sourceVersion" value={version.version} />
                    <button type="submit" disabled={version.version === agent.currentVersion}>
                      Rollback as new version
                    </button>
                  </form>
                </article>
              ))}
            </div>
          </section>
        </div>
      </section>
    </main>
  );
}

function ReadOnlyBlock({ title, value }: { title: string; value: unknown }) {
  return (
    <article>
      <h3>{title}</h3>
      <pre>{formatValue(value)}</pre>
    </article>
  );
}

function formatValue(value: unknown) {
  if (value === null || value === undefined) {
    return "None";
  }

  if (typeof value === "string") {
    return value;
  }

  return JSON.stringify(value, null, 2);
}
