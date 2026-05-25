import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@ai-trade/config": fileURLToPath(new URL("../config/src/index.ts", import.meta.url)),
      "@ai-trade/domain/ai-agents": fileURLToPath(
        new URL("../domain/src/ai-agents/index.ts", import.meta.url),
      ),
      "@ai-trade/domain/market-data": fileURLToPath(
        new URL("../domain/src/market-data/index.ts", import.meta.url),
      ),
      "@ai-trade/domain/ai-tuning": fileURLToPath(
        new URL("../domain/src/ai-tuning/index.ts", import.meta.url),
      ),
      "@ai-trade/domain/paper-trading": fileURLToPath(
        new URL("../domain/src/paper-trading/index.ts", import.meta.url),
      ),
      "@ai-trade/domain/strategies": fileURLToPath(
        new URL("../domain/src/strategies/index.ts", import.meta.url),
      ),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
