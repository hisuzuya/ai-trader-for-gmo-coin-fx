import { env } from "@ai-trade/config";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "./schema/index.js";

const globalForDb = globalThis as typeof globalThis & {
  aiTradePgPool?: Pool;
};

export const pgPool =
  globalForDb.aiTradePgPool ??
  new Pool({
    connectionString: env.DATABASE_URL,
    max: 5,
  });

if (env.NODE_ENV !== "production") {
  globalForDb.aiTradePgPool = pgPool;
}

export const db = drizzle(pgPool, { schema });

export async function checkDbConnection(): Promise<boolean> {
  const result = await pgPool.query<{ ok: number }>("select 1 as ok");
  return result.rows[0]?.ok === 1;
}
