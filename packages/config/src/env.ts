import { z } from "zod";

const envBoolean = z.union([z.boolean(), z.string()]).transform((value, ctx) => {
  if (typeof value === "boolean") {
    return value;
  }

  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off", ""].includes(normalized)) {
    return false;
  }

  ctx.addIssue({
    code: "custom",
    message: `Invalid boolean value: ${value}`,
  });
  return z.NEVER;
});

const serverEnvSchema = z.object({
  DATABASE_URL: z.string().url().default("postgresql://ai_trade:ai_trade@localhost:5432/ai_trade"),
  WORKER_PORT: z.coerce.number().int().positive().default(8787),
  AI_RUNNER_INTERNAL_URL: z.string().url().default("http://localhost:8788"),
  MCP_AGENT_RESEARCH_INTERNAL_URL: z.string().url().default("http://localhost:8789"),
  MCP_AGENT_RESEARCH_PORT: z.coerce.number().int().positive().default(8789),
  WORKER_INTERNAL_TOKEN: z.string().min(16).optional(),
  AI_DAILY_REVIEW_ENABLED: envBoolean.default(false),
  AI_TUNING_ENABLED: envBoolean.default(false),
  AI_PROMPT_OPTIMIZER_ENABLED: envBoolean.default(false),
  AI_SKILL_CURATOR_ENABLED: envBoolean.default(false),
  GMO_FX_PUBLIC_WEBSOCKET_URL: z.string().url().default("wss://forex-api.coin.z.com/ws/public/v1"),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
});

export const env = serverEnvSchema.parse(process.env);
