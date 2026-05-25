import { AGENT_CHARACTERS, getCharacter } from "@ai-trade/domain/ai-agents/characters";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";

import { updateAgentSettings } from "../../actions";

export const dynamic = "force-dynamic";

type AgentDetail = {
  id: string;
  name: string;
  persona: string;
  status: "active" | "paused";
  currentVersion: number;
  runIntervalSec: number;
  model: string;
  characterId?: string | null;
  sharedMemoryEnabled: boolean;
};

async function getAgent(id: string): Promise<AgentDetail | null> {
  const response = await fetch(
    new URL(`/agents/${id}`, process.env.WORKER_INTERNAL_URL ?? "http://localhost:8787"),
    { cache: "no-store" },
  ).catch(() => null);
  if (!response?.ok) return null;
  const body = (await response.json()) as { agent?: AgentDetail };
  return body.agent ?? null;
}

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function EditAgentPage({ params, searchParams }: PageProps) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const agent = await getAgent(id);
  if (!agent) notFound();

  const selectedCharacterId =
    typeof query.character === "string" ? query.character : (agent.characterId ?? "");
  const selected = getCharacter(selectedCharacterId);
  const updateAction = updateAgentSettings.bind(null, agent.id);
  const error = typeof query.error === "string" ? query.error : null;

  return (
    <section className="page-shell">
      <header className="page-header">
        <div>
          <p className="page-kicker">Edit</p>
          <h1>{agent.name} の設定</h1>
        </div>
        <div className="page-actions">
          <Link href={`/agents/${agent.id}`} className="btn-ghost">
            ← Back
          </Link>
        </div>
      </header>

      <section className="panel">
        <div className="panel-title">
          <h2>キャラクターを変更</h2>
          {error === "update_failed" ? (
            <span className="panel-toast warn">更新に失敗しました</span>
          ) : null}
        </div>
        <div className="wizard-grid">
          {AGENT_CHARACTERS.map((character) => {
            const isSelected = selected?.id === character.id;
            return (
              <Link
                key={character.id}
                href={`/agents/${agent.id}/edit?character=${character.id}`}
                className={`wizard-card${isSelected ? " selected" : ""}`}
                style={{
                  ["--character-color" as string]: character.themeColor,
                  ["--character-accent" as string]: character.accentColor,
                }}
                data-character-id={character.id}
              >
                <div className="wizard-card-portrait">
                  <Image
                    src={character.imagePath}
                    alt={`${character.name} portrait`}
                    width={240}
                    height={220}
                    unoptimized
                  />
                </div>
                <div className="wizard-card-body">
                  <span className="wizard-card-name">
                    {character.nameJa}
                    <small style={{ marginLeft: 6, color: "var(--muted)", fontWeight: 400 }}>
                      {character.name}
                    </small>
                  </span>
                  <span className="wizard-card-tag">{character.type}</span>
                </div>
              </Link>
            );
          })}
        </div>
      </section>

      <section className="panel">
        <div className="panel-title">
          <h2>運用設定</h2>
        </div>
        <form action={updateAction} className="wizard-form">
          <input type="hidden" name="characterId" value={selected?.id ?? ""} />
          <label className="col-span-2">
            <span>Agent name</span>
            <input type="text" name="name" defaultValue={agent.name} required />
          </label>
          <label className="col-span-2">
            <span>Persona summary</span>
            <input type="text" name="persona" defaultValue={agent.persona} />
          </label>
          <label>
            <span>Run interval (sec)</span>
            <input
              type="number"
              name="runIntervalSec"
              defaultValue={agent.runIntervalSec}
              min={60}
              required
            />
          </label>
          <label>
            <span>Model</span>
            <input type="text" name="model" defaultValue={agent.model} required />
          </label>
          <label>
            <span>Status</span>
            <select name="status" defaultValue={agent.status}>
              <option value="active">active</option>
              <option value="paused">paused</option>
            </select>
          </label>
          <label
            className="col-span-2"
            style={{ flexDirection: "row", alignItems: "center", gap: 8 }}
          >
            <input
              type="checkbox"
              name="sharedMemoryEnabled"
              defaultChecked={agent.sharedMemoryEnabled}
            />
            <span style={{ letterSpacing: "normal", textTransform: "none" }}>
              Shared memory を有効化
            </span>
          </label>
          <div className="col-span-2" style={{ display: "flex", gap: 8 }}>
            <button type="submit" className="btn-primary">
              Save settings
            </button>
            <Link href={`/agents/${agent.id}`} className="btn-ghost">
              Cancel
            </Link>
          </div>
        </form>
      </section>
    </section>
  );
}
