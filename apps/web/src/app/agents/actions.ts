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
