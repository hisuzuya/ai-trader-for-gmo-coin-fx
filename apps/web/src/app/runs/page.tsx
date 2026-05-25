import { getCharacter } from "@ai-trade/domain/ai-agents/characters";
import Link from "next/link";

import { CharacterAvatar } from "@/components/agents/CharacterAvatar";

export const dynamic = "force-dynamic";

type RunRow = {
  id: string;
  agentId: string;
  agentVersion: number;
  status: "succeeded" | "failed" | "timeout" | "rejected_output";
  outputSummary: unknown;
  toolCalls: unknown;
  tokenUsage: unknown;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
};

type AgentSummary = {
  id: string;
  name: string;
  characterId?: string | null;
};

async function fetchRuns(filter: {
  agentId?: string;
  status?: RunRow["status"];
  limit?: number;
}): Promise<RunRow[]> {
  const url = new URL("/agents/runs", process.env.WORKER_INTERNAL_URL ?? "http://localhost:8787");
  if (filter.agentId) url.searchParams.set("agentId", filter.agentId);
  if (filter.status) url.searchParams.set("status", filter.status);
  if (filter.limit) url.searchParams.set("limit", String(filter.limit));

  const response = await fetch(url, { cache: "no-store" }).catch(() => null);
  if (!response?.ok) return [];
  const body = (await response.json()) as { runs?: RunRow[] };
  return Array.isArray(body.runs) ? body.runs : [];
}

async function fetchAgents(): Promise<AgentSummary[]> {
  const response = await fetch(
    new URL("/agents", process.env.WORKER_INTERNAL_URL ?? "http://localhost:8787"),
    { cache: "no-store" },
  ).catch(() => null);
  if (!response?.ok) return [];
  const body = (await response.json()) as { agents?: AgentSummary[] };
  return Array.isArray(body.agents) ? body.agents : [];
}

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function RunsPage({ searchParams }: PageProps) {
  const query = await searchParams;
  const agentId = typeof query.agentId === "string" ? query.agentId : undefined;
  const statusRaw = typeof query.status === "string" ? query.status : undefined;
  const status: RunRow["status"] | undefined =
    statusRaw === "succeeded" ||
    statusRaw === "failed" ||
    statusRaw === "timeout" ||
    statusRaw === "rejected_output"
      ? statusRaw
      : undefined;

  const [runs, agents] = await Promise.all([
    fetchRuns({ agentId, status, limit: 100 }),
    fetchAgents(),
  ]);

  const agentMap = new Map(agents.map((agent) => [agent.id, agent]));

  return (
    <section className="page-shell">
      <header className="page-header">
        <div>
          <p className="page-kicker">Activity</p>
          <h1>Runs</h1>
        </div>
        <div className="page-actions">
          <Link href="/runs" className={!status ? "btn-secondary" : "btn-ghost"}>
            All
          </Link>
          <Link
            href="/runs?status=succeeded"
            className={status === "succeeded" ? "btn-secondary" : "btn-ghost"}
          >
            Succeeded
          </Link>
          <Link
            href="/runs?status=failed"
            className={status === "failed" ? "btn-secondary" : "btn-ghost"}
          >
            Failed
          </Link>
          <Link
            href="/runs?status=timeout"
            className={status === "timeout" ? "btn-secondary" : "btn-ghost"}
          >
            Timeout
          </Link>
        </div>
      </header>

      <section className="panel">
        <div className="panel-title">
          <h2>{runs.length} runs</h2>
          {agentId ? (
            <Link href="/runs" className="btn-ghost">
              Clear agent filter
            </Link>
          ) : null}
        </div>

        {runs.length === 0 ? <p className="text-muted">No runs match the current filter.</p> : null}

        {runs.map((run) => {
          const agent = agentMap.get(run.agentId);
          const character = getCharacter(agent?.characterId);
          return (
            <Link key={run.id} href={`/agents/${run.agentId}?tab=runs`} className="activity-row">
              <CharacterAvatar character={character} size="sm" />
              <div>
                <div className="activity-row-title">
                  {agent?.name ?? run.agentId.slice(0, 8)} · v{run.agentVersion}
                </div>
                <div className="activity-row-meta">
                  {run.startedAt}
                  {run.error ? ` · ${run.error.slice(0, 60)}` : ""}
                </div>
              </div>
              <span className={`status-pill ${run.status === "succeeded" ? "active" : "paused"}`}>
                {run.status}
              </span>
            </Link>
          );
        })}
      </section>
    </section>
  );
}
