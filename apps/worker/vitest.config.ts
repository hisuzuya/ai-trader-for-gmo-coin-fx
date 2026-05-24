import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "@ai-trade/config": fileURLToPath(
        new URL("../../packages/config/src/index.ts", import.meta.url),
      ),
      "@ai-trade/db": fileURLToPath(new URL("../../packages/db/src/index.ts", import.meta.url)),
      "@ai-trade/domain/ai-tuning": fileURLToPath(
        new URL("../../packages/domain/src/ai-tuning/index.ts", import.meta.url),
      ),
      "@ai-trade/domain/market-data": fileURLToPath(
        new URL("../../packages/domain/src/market-data/index.ts", import.meta.url),
      ),
      "@ai-trade/domain/paper-trading": fileURLToPath(
        new URL("../../packages/domain/src/paper-trading/index.ts", import.meta.url),
      ),
      "@ai-trade/domain/strategies": fileURLToPath(
        new URL("../../packages/domain/src/strategies/index.ts", import.meta.url),
      ),
      "@ai-trade/domain": fileURLToPath(
        new URL("../../packages/domain/src/index.ts", import.meta.url),
      ),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
