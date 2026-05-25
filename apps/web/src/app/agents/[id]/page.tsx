import Link from "next/link";
import { notFound } from "next/navigation";
import { saveAgentVersion } from "../actions";

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
};

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

async function getAgent(id: string): Promise<AgentDetail | null> {
  const response = await fetch(
    new URL("/agents", process.env.WORKER_INTERNAL_URL ?? "http://localhost:8787"),
    {
      cache: "no-store",
    },
  ).catch(() => null);

  if (!response?.ok) {
    return null;
  }

  const body = (await response.json()) as { agents?: AgentDetail[] };
  return body.agents?.find((agent) => agent.id === id) ?? null;
}

export default async function AgentDetailPage({ params, searchParams }: PageProps) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const agent = await getAgent(id);

  if (!agent) {
    notFound();
  }

  const saveAction = saveAgentVersion.bind(null, agent.id);
  const warning = query.warning === "secret_like";
  const saved = query.saved === "1";

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
          </dl>
        </aside>

        <div className="agent-main">
          <section className="agent-panel">
            <div className="agent-section-title">
              <h2>Prompt</h2>
              {saved ? <span>Saved</span> : null}
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
            <div className="agent-tabs">
              {["overview", "memories", "proposals", "reviews", "runs", "versions"].map((item) => (
                <span key={item}>{item}</span>
              ))}
            </div>
            <div className="agent-log-grid">
              <ReadOnlyBlock
                title="Memories"
                text="Memory content is displayed as plain text only."
              />
              <ReadOnlyBlock
                title="Proposals"
                text="Validated proposals are inserted as candidate strategy runs."
              />
              <ReadOnlyBlock
                title="Reviews"
                text="CandidateReview is stored as gate input and is not applied alone."
              />
              <ReadOnlyBlock
                title="Runs"
                text="Tool args and result summaries are redacted before storage."
              />
            </div>
          </section>
        </div>
      </section>
    </main>
  );
}

function ReadOnlyBlock({ title, text }: { title: string; text: string }) {
  return (
    <article>
      <h3>{title}</h3>
      <p>{text}</p>
    </article>
  );
}
