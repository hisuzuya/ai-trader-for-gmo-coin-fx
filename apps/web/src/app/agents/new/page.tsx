import Image from "next/image";
import Link from "next/link";

import { AGENT_RESEARCH_TOOL_NAMES } from "@ai-trade/domain/ai-agents/types";
import { AGENT_CHARACTERS, getCharacter } from "@ai-trade/domain/ai-agents/characters";

import { createAgent } from "../actions";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function NewAgentPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const characterParam = typeof params.character === "string" ? params.character : "";
  const selected = getCharacter(characterParam);
  const error = typeof params.error === "string" ? params.error : null;
  const warning = typeof params.warning === "string" ? params.warning : null;

  return (
    <section className="page-shell">
      <header className="page-header">
        <div>
          <p className="page-kicker">Create</p>
          <h1>新しいエージェントを編成</h1>
        </div>
        <div className="page-actions">
          <Link href="/agents" className="btn-ghost">
            ← Cancel
          </Link>
        </div>
      </header>

      <section className="panel">
        <div className="panel-title">
          <h2>Step 1 — キャラクターを選ぶ</h2>
          {selected ? (
            <span className="panel-toast">Selected: {selected.nameJa}</span>
          ) : null}
        </div>
        <div className="wizard-grid">
          {AGENT_CHARACTERS.map((character) => {
            const isSelected = selected?.id === character.id;
            return (
              <Link
                key={character.id}
                href={`/agents/new?character=${character.id}`}
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
                  <span
                    className="wizard-card-tag"
                    style={{ fontStyle: "italic", color: "var(--text)" }}
                  >
                    “{character.catchphrase}”
                  </span>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                    {character.recommendedFocus.map((focus) => (
                      <span key={focus} className="meta-pill subtle">
                        {focus}
                      </span>
                    ))}
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      </section>

      {selected ? (
        <section className="panel">
          <div className="panel-title">
            <h2>Step 2 — 運用方針を確認・調整</h2>
            {error === "missing_fields" ? (
              <span className="panel-toast warn">必須項目が未入力です</span>
            ) : null}
            {error === "invalid_interval" ? (
              <span className="panel-toast warn">実行間隔は 60 秒以上にしてください</span>
            ) : null}
            {error === "create_failed" ? (
              <span className="panel-toast warn">作成に失敗しました。再試行してください</span>
            ) : null}
            {warning === "secret_like" ? (
              <span className="panel-toast warn">プロンプトにシークレットらしき文字列を検出</span>
            ) : null}
          </div>

          <form action={createAgent} className="wizard-form">
            <input type="hidden" name="characterId" value={selected.id} />
            <label className="col-span-2">
              <span>Agent name</span>
              <input
                type="text"
                name="name"
                defaultValue={`${selected.nameJa} — USDJPY`}
                required
                placeholder={`例: ${selected.nameJa} — USDJPY trend`}
              />
            </label>
            <label className="col-span-2">
              <span>Persona summary</span>
              <input
                type="text"
                name="persona"
                defaultValue={selected.defaultPersona}
                placeholder={selected.defaultPersona}
              />
            </label>
            <label>
              <span>Run interval (sec)</span>
              <input
                type="number"
                name="runIntervalSec"
                defaultValue={selected.defaultRunIntervalSec}
                min={60}
                required
              />
            </label>
            <label>
              <span>Model</span>
              <input
                type="text"
                name="model"
                defaultValue={selected.defaultModel}
                required
              />
            </label>
            <label className="col-span-2">
              <span>System prompt</span>
              <textarea
                name="systemPrompt"
                defaultValue={selected.defaultSystemPrompt}
                required
              />
            </label>
            <fieldset className="col-span-2" style={{ border: "none", padding: 0, margin: 0 }}>
              <legend
                style={{
                  color: "var(--subtle)",
                  fontSize: 11,
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  marginBottom: 6,
                }}
              >
                Allowed tools
              </legend>
              <div className="tool-chips">
                {AGENT_RESEARCH_TOOL_NAMES.map((tool) => (
                  <label key={tool}>
                    <input
                      type="checkbox"
                      name="allowedTools"
                      value={tool}
                      defaultChecked={selected.defaultAllowedTools.includes(tool)}
                    />
                    <span>{tool}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            <label className="col-span-2" style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <input type="checkbox" name="sharedMemoryEnabled" />
              <span style={{ letterSpacing: "normal", textTransform: "none" }}>
                Shared memory を有効化（他エージェントのメモリも参照）
              </span>
            </label>
            <div className="col-span-2" style={{ display: "flex", gap: 8 }}>
              <button type="submit" className="btn-primary">
                Create Agent
              </button>
              <Link href="/agents" className="btn-ghost">
                Cancel
              </Link>
            </div>
          </form>
        </section>
      ) : (
        <section className="panel">
          <p style={{ color: "var(--muted)" }}>
            上のキャラクターを選択すると、運用方針の入力フォームが表示されます。
          </p>
        </section>
      )}
    </section>
  );
}
