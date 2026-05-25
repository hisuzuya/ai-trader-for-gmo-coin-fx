"use server";

import { getCharacter, isCharacterId } from "@ai-trade/domain/ai-agents/characters";

import { AGENT_RESEARCH_TOOL_NAMES } from "@ai-trade/domain/ai-agents/types";
import { redirect } from "next/navigation";

const SECRET_LIKE_PATTERN =
  /(sk-[A-Za-z0-9_-]{16,}|[A-Z0-9_]*(?:SECRET|TOKEN|PASSWORD|API_KEY)[A-Z0-9_]*\s*[:=]\s*["']?[^"',\s}]+)/;

export async function saveAgentVersion(agentId: string, formData: FormData) {
  const systemPrompt = String(formData.get("systemPrompt") ?? "").trim();
  const note = String(formData.get("note") ?? "").trim();
  const allowedTools = formData.getAll("allowedTools").map(String);

  if (systemPrompt.length === 0) {
    redirect(`/agents/${agentId}?error=empty_prompt`);
  }

  if (SECRET_LIKE_PATTERN.test(systemPrompt)) {
    redirect(`/agents/${agentId}?warning=secret_like`);
  }

  const response = await fetch(
    new URL(
      `/agents/${agentId}/versions`,
      process.env.WORKER_INTERNAL_URL ?? "http://localhost:8787",
    ),
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(process.env.WORKER_INTERNAL_TOKEN
          ? { authorization: `Bearer ${process.env.WORKER_INTERNAL_TOKEN}` }
          : {}),
      },
      body: JSON.stringify({
        systemPrompt,
        allowedTools,
        note: note.length > 0 ? note : undefined,
      }),
    },
  );

  if (!response.ok) {
    redirect(`/agents/${agentId}?error=save_failed`);
  }

  redirect(`/agents/${agentId}?saved=1`);
}

export async function rollbackAgentVersion(agentId: string, formData: FormData) {
  const sourceVersion = Number(formData.get("sourceVersion"));

  if (!Number.isInteger(sourceVersion) || sourceVersion <= 0) {
    redirect(`/agents/${agentId}?error=invalid_version`);
  }

  const response = await fetch(
    new URL(
      `/agents/${agentId}/versions/${sourceVersion}/rollback`,
      process.env.WORKER_INTERNAL_URL ?? "http://localhost:8787",
    ),
    {
      method: "POST",
      headers: authorizedJsonHeaders(),
      body: JSON.stringify({ note: `Rollback to version ${sourceVersion}.` }),
    },
  );

  if (!response.ok) {
    redirect(`/agents/${agentId}?error=rollback_failed`);
  }

  redirect(`/agents/${agentId}?rolledBack=1`);
}

export async function deleteAgentMemory(agentId: string, formData: FormData) {
  const memoryId = String(formData.get("memoryId") ?? "");

  if (memoryId.length === 0) {
    redirect(`/agents/${agentId}?error=invalid_memory`);
  }

  const response = await fetch(
    new URL(
      `/agents/${agentId}/memories/${memoryId}`,
      process.env.WORKER_INTERNAL_URL ?? "http://localhost:8787",
    ),
    {
      method: "DELETE",
      headers: authorizedJsonHeaders(),
    },
  );

  if (!response.ok) {
    redirect(`/agents/${agentId}?error=delete_memory_failed`);
  }

  redirect(`/agents/${agentId}?memoryDeleted=1`);
}

function authorizedJsonHeaders() {
  return {
    "content-type": "application/json",
    ...(process.env.WORKER_INTERNAL_TOKEN
      ? { authorization: `Bearer ${process.env.WORKER_INTERNAL_TOKEN}` }
      : {}),
  };
}

export async function createAgent(formData: FormData) {
  const characterIdRaw = String(formData.get("characterId") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const persona = String(formData.get("persona") ?? "").trim();
  const systemPrompt = String(formData.get("systemPrompt") ?? "").trim();
  const model = String(formData.get("model") ?? "").trim();
  const runIntervalRaw = Number(formData.get("runIntervalSec"));
  const initialBalanceRaw = Number(formData.get("initialBalanceJpy"));
  const allowedTools = formData
    .getAll("allowedTools")
    .map(String)
    .filter((tool) => (AGENT_RESEARCH_TOOL_NAMES as readonly string[]).includes(tool));

  if (!isCharacterId(characterIdRaw)) {
    redirect("/agents?error=invalid_character#picker");
  }

  if (name.length === 0 || systemPrompt.length === 0 || model.length === 0) {
    redirect(`/agents?character=${characterIdRaw}&error=missing_fields#picker`);
  }

  if (!Number.isFinite(runIntervalRaw) || runIntervalRaw < 60) {
    redirect(`/agents?character=${characterIdRaw}&error=invalid_interval#picker`);
  }

  if (!Number.isFinite(initialBalanceRaw) || initialBalanceRaw <= 0) {
    redirect(`/agents?character=${characterIdRaw}&error=invalid_balance#picker`);
  }

  if (SECRET_LIKE_PATTERN.test(systemPrompt)) {
    redirect(`/agents?character=${characterIdRaw}&warning=secret_like#picker`);
  }

  const response = await fetch(
    new URL("/agents", process.env.WORKER_INTERNAL_URL ?? "http://localhost:8787"),
    {
      method: "POST",
      headers: authorizedJsonHeaders(),
      body: JSON.stringify({
        name,
        persona:
          persona.length > 0 ? persona : (getCharacter(characterIdRaw)?.defaultPersona ?? name),
        systemPrompt,
        allowedTools: allowedTools.length > 0 ? allowedTools : [...AGENT_RESEARCH_TOOL_NAMES],
        runIntervalSec: runIntervalRaw,
        model,
        characterId: characterIdRaw,
        initialBalanceJpy: initialBalanceRaw,
        sharedMemoryEnabled: formData.get("sharedMemoryEnabled") === "on",
      }),
    },
  );

  if (!response.ok) {
    redirect(`/agents?character=${characterIdRaw}&error=create_failed#picker`);
  }

  const body = (await response.json()) as { id?: string };
  if (!body.id) {
    redirect(`/agents?character=${characterIdRaw}&error=create_failed#picker`);
  }

  redirect(`/agents/${body.id}?created=1`);
}

export async function updateAgentSettings(agentId: string, formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  const persona = String(formData.get("persona") ?? "").trim();
  const characterIdRaw = String(formData.get("characterId") ?? "");
  const statusRaw = String(formData.get("status") ?? "active");
  const runIntervalRaw = Number(formData.get("runIntervalSec"));
  const model = String(formData.get("model") ?? "").trim();

  const characterId = isCharacterId(characterIdRaw) ? characterIdRaw : null;
  const status = statusRaw === "paused" ? "paused" : "active";

  const response = await fetch(
    new URL(`/agents/${agentId}`, process.env.WORKER_INTERNAL_URL ?? "http://localhost:8787"),
    {
      method: "PUT",
      headers: authorizedJsonHeaders(),
      body: JSON.stringify({
        name: name.length > 0 ? name : undefined,
        persona: persona.length > 0 ? persona : undefined,
        characterId,
        status,
        runIntervalSec:
          Number.isFinite(runIntervalRaw) && runIntervalRaw >= 60 ? runIntervalRaw : undefined,
        model: model.length > 0 ? model : undefined,
        sharedMemoryEnabled: formData.get("sharedMemoryEnabled") === "on",
      }),
    },
  );

  if (!response.ok) {
    redirect(`/agents/${agentId}?tab=settings&error=update_failed`);
  }

  redirect(`/agents/${agentId}?tab=settings&saved=1`);
}
