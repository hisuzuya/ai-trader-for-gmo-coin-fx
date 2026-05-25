"use client";

import { AGENT_CHARACTERS, type AgentCharacter } from "@ai-trade/domain/ai-agents/characters";
import { AGENT_RESEARCH_TOOL_NAMES } from "@ai-trade/domain/ai-agents/types";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { createAgent } from "@/app/agents/actions";
import {
  hasModelOption,
  hasRunIntervalOption,
  MODEL_OPTIONS,
  RUN_INTERVAL_OPTIONS,
} from "./form-options";

type Props = {
  /** ?character=... で初期選択を受け取る (server action リダイレクト用) */
  initialCharacterId?: string | null;
  /** ?error=... を server action から伝搬 */
  initialError?: string | null;
  /** ?warning=... を server action から伝搬 */
  initialWarning?: string | null;
};

export function CharacterPickerModal({ initialCharacterId, initialError, initialWarning }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [selected, setSelected] = useState<AgentCharacter | null>(() => {
    const found = AGENT_CHARACTERS.find((c) => c.id === initialCharacterId);
    return found ?? null;
  });

  // selected がセットされた時にモーダルを開く
  // (初回マウント時の initialCharacterId / open() からの setSelected 両方をカバー)
  useEffect(() => {
    const dialog = dialogRef.current;
    if (selected && dialog && !dialog.open) {
      dialog.showModal();
    }
  }, [selected]);

  function open(character: AgentCharacter) {
    setSelected(character);
  }

  function close() {
    dialogRef.current?.close();
  }

  function onDialogClose() {
    setSelected(null);
  }

  return (
    <>
      <section className="panel">
        <div className="panel-title">
          <h2>＋ 新しいエージェントを追加</h2>
          <span className="page-kicker">キャラクターをクリックして編成</span>
        </div>
        <div className="wizard-grid">
          {AGENT_CHARACTERS.map((character) => (
            <button
              key={character.id}
              type="button"
              onClick={() => open(character)}
              className="wizard-card"
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
            </button>
          ))}
        </div>
      </section>

      <dialog
        ref={dialogRef}
        className="character-modal"
        onClose={onDialogClose}
        aria-labelledby="character-modal-title"
      >
        {selected ? (
          <div
            className="character-modal-content"
            style={{
              ["--character-color" as string]: selected.themeColor,
              ["--character-accent" as string]: selected.accentColor,
            }}
          >
            <header className="character-modal-header">
              <div className="character-modal-portrait">
                <Image
                  src={selected.imagePath}
                  alt={`${selected.name} portrait`}
                  width={120}
                  height={120}
                  unoptimized
                />
              </div>
              <div className="character-modal-heading">
                <p className="page-kicker">Create</p>
                <h2 id="character-modal-title">
                  {selected.nameJa}
                  <small
                    style={{
                      marginLeft: 8,
                      color: "var(--muted)",
                      fontWeight: 400,
                      fontSize: 13,
                    }}
                  >
                    {selected.name}
                  </small>
                </h2>
                <p style={{ color: "var(--muted)", fontSize: 12 }}>{selected.type}</p>
                <p
                  style={{
                    color: "var(--text)",
                    fontStyle: "italic",
                    marginTop: 4,
                    fontSize: 12,
                  }}
                >
                  “{selected.catchphrase}”
                </p>
              </div>
              <button
                type="button"
                onClick={close}
                className="character-modal-close"
                aria-label="閉じる"
              >
                ×
              </button>
            </header>

            {initialError === "missing_fields" ? (
              <p className="panel-toast warn" style={{ marginBottom: 10 }}>
                必須項目が未入力です
              </p>
            ) : null}
            {initialError === "invalid_interval" ? (
              <p className="panel-toast warn" style={{ marginBottom: 10 }}>
                実行間隔は 60 秒以上にしてください
              </p>
            ) : null}
            {initialError === "create_failed" ? (
              <p className="panel-toast warn" style={{ marginBottom: 10 }}>
                作成に失敗しました。再試行してください
              </p>
            ) : null}
            {initialWarning === "secret_like" ? (
              <p className="panel-toast warn" style={{ marginBottom: 10 }}>
                プロンプトにシークレットらしき文字列を検出
              </p>
            ) : null}

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
                <select
                  name="runIntervalSec"
                  defaultValue={selected.defaultRunIntervalSec}
                  required
                >
                  {hasRunIntervalOption(selected.defaultRunIntervalSec) ? null : (
                    <option value={selected.defaultRunIntervalSec}>
                      Custom ({selected.defaultRunIntervalSec} sec)
                    </option>
                  )}
                  {RUN_INTERVAL_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Model</span>
                <select name="model" defaultValue={selected.defaultModel} required>
                  {hasModelOption(selected.defaultModel) ? null : (
                    <option value={selected.defaultModel}>{selected.defaultModel}</option>
                  )}
                  {MODEL_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
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
              <label
                className="col-span-2"
                style={{ flexDirection: "row", alignItems: "center", gap: 8 }}
              >
                <input type="checkbox" name="sharedMemoryEnabled" />
                <span style={{ letterSpacing: "normal", textTransform: "none" }}>
                  Shared memory を有効化（他エージェントのメモリも参照）
                </span>
              </label>
              <div className="col-span-2" style={{ display: "flex", gap: 8 }}>
                <button type="submit" className="btn-primary">
                  Create Agent
                </button>
                <button type="button" onClick={close} className="btn-ghost">
                  Cancel
                </button>
              </div>
            </form>
          </div>
        ) : null}
      </dialog>
    </>
  );
}
