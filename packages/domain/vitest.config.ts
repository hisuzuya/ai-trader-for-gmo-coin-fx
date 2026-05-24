import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@ai-trade/domain": fileURLToPath(new URL("./src/index.ts", import.meta.url)),
      "@ai-trade/domain/market-data": fileURLToPath(
        new URL("./src/market-data/index.ts", import.meta.url),
      ),
      "@ai-trade/domain/strategies": fileURLToPath(
        new URL("./src/strategies/index.ts", import.meta.url),
      ),
      "@ai-trade/domain/ai-tuning": fileURLToPath(
        new URL("./src/ai-tuning/index.ts", import.meta.url),
      ),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
