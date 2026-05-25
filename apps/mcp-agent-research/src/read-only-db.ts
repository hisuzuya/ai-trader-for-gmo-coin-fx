import { env } from "@ai-trade/config";
import * as schema from "@ai-trade/db/schema";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: 5,
  options: "-c default_transaction_read_only=on",
});

pool.on("connect", (client) => {
  void client.query("set default_transaction_read_only = on");
});

export const readOnlyDb = drizzle(pool, { schema });
