import { aiAgentSkills } from "@ai-trade/db";
import { and, desc, eq, ilike, or, sql } from "drizzle-orm";

import { readOnlyDb } from "../../data-sources/read-only-db.js";
import { clampLimit } from "../common.js";

export async function recallSkills(input: {
  agentId: string;
  query?: string;
  scopes?: ("private" | "shared")[];
  tags?: string[];
  limit?: number;
}) {
  const scopes = input.scopes?.length ? input.scopes : ["private", "shared"];
  const scopeConditions = [];

  if (scopes.includes("private")) {
    scopeConditions.push(
      and(eq(aiAgentSkills.scope, "private"), eq(aiAgentSkills.agentId, input.agentId)),
    );
  }

  if (scopes.includes("shared")) {
    scopeConditions.push(eq(aiAgentSkills.scope, "shared"));
  }

  const conditions = [
    eq(aiAgentSkills.status, "active"),
    scopeConditions.length === 1 ? scopeConditions[0] : or(...scopeConditions),
  ];

  if (input.query?.trim()) {
    const trimmedQuery = input.query.trim();
    const query = `%${trimmedQuery}%`;
    const searchCondition = or(
      sql`to_tsvector('simple', ${aiAgentSkills.title} || ' ' || ${aiAgentSkills.body}) @@ plainto_tsquery('simple', ${trimmedQuery})`,
      ilike(aiAgentSkills.title, query),
      ilike(aiAgentSkills.body, query),
    );

    if (searchCondition) {
      conditions.push(searchCondition);
    }
  }

  if (input.tags?.length) {
    conditions.push(
      sql`${aiAgentSkills.tags} && ARRAY[${sql.join(
        input.tags.map((tag) => sql`${tag}`),
        sql`, `,
      )}]::text[]`,
    );
  }

  const rows = await readOnlyDb
    .select({
      id: aiAgentSkills.id,
      agentId: aiAgentSkills.agentId,
      scope: aiAgentSkills.scope,
      title: aiAgentSkills.title,
      body: aiAgentSkills.body,
      tags: aiAgentSkills.tags,
      sourceRefs: aiAgentSkills.sourceRefs,
      reason: aiAgentSkills.reason,
      version: aiAgentSkills.version,
      updatedAt: aiAgentSkills.updatedAt,
    })
    .from(aiAgentSkills)
    .where(and(...conditions))
    .orderBy(desc(aiAgentSkills.updatedAt))
    .limit(clampLimit(input.limit ?? 10));

  return rows.map((row) => ({
    ...row,
    version: Number(row.version),
    updatedAt: row.updatedAt.toISOString(),
  }));
}

export async function getSkill(input: { agentId: string; skillId: string }) {
  const rows = await readOnlyDb
    .select({
      id: aiAgentSkills.id,
      agentId: aiAgentSkills.agentId,
      scope: aiAgentSkills.scope,
      title: aiAgentSkills.title,
      body: aiAgentSkills.body,
      tags: aiAgentSkills.tags,
      sourceRefs: aiAgentSkills.sourceRefs,
      reason: aiAgentSkills.reason,
      version: aiAgentSkills.version,
      updatedAt: aiAgentSkills.updatedAt,
    })
    .from(aiAgentSkills)
    .where(
      and(
        eq(aiAgentSkills.id, input.skillId),
        eq(aiAgentSkills.status, "active"),
        or(
          and(eq(aiAgentSkills.scope, "private"), eq(aiAgentSkills.agentId, input.agentId)),
          eq(aiAgentSkills.scope, "shared"),
        ),
      ),
    )
    .limit(1);
  const row = rows[0] ?? null;

  if (!row) return null;

  return {
    ...row,
    version: Number(row.version),
    updatedAt: row.updatedAt.toISOString(),
  };
}
