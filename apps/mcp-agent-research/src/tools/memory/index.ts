import { aiAgentMemories } from "@ai-trade/db";
import { and, desc, eq, ilike, or, sql } from "drizzle-orm";

import { readOnlyDb } from "../../data-sources/read-only-db.js";
import { clampLimit } from "../common.js";

export async function recallMemory(input: {
  agentId: string;
  query?: string;
  types?: string[];
  limit?: number;
}) {
  const conditions = [
    or(
      eq(aiAgentMemories.agentId, input.agentId),
      sql`${aiAgentMemories.tags} @> ARRAY['shared_memory']::text[]`,
    ),
  ];

  if (input.query?.trim()) {
    const trimmedQuery = input.query.trim();
    const query = `%${trimmedQuery}%`;
    const searchCondition = or(
      sql`to_tsvector('simple', coalesce(${aiAgentMemories.searchVector}, ${aiAgentMemories.content})) @@ plainto_tsquery('simple', ${trimmedQuery})`,
      ilike(aiAgentMemories.content, query),
      ilike(aiAgentMemories.searchVector, query),
    );

    if (searchCondition) {
      conditions.push(searchCondition);
    }
  }

  const rows = await readOnlyDb
    .select({
      id: aiAgentMemories.id,
      type: aiAgentMemories.type,
      content: aiAgentMemories.content,
      tags: aiAgentMemories.tags,
      sourceRefs: aiAgentMemories.sourceRefs,
      createdAt: aiAgentMemories.createdAt,
    })
    .from(aiAgentMemories)
    .where(and(...conditions))
    .orderBy(desc(aiAgentMemories.createdAt))
    .limit(clampLimit(input.limit ?? 10));

  return rows
    .filter((row) => !input.types || input.types.includes(row.type))
    .map((row) => ({ ...row, createdAt: row.createdAt.toISOString() }));
}
