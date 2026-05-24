import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/shared/db/schema/index.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgresql://ai_trade:ai_trade@localhost:5432/ai_trade",
  },
});
