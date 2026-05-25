"use server";

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
