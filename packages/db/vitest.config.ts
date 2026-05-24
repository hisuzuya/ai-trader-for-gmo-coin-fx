import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@ai-trade/config": fileURLToPath(
        new URL("../config/src/index.ts", import.meta.url),
      ),
      "@ai-trade/domain/market-data": fileURLToPath(
        new URL("../domain/src/market-data/index.ts", import.meta.url),
      ),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
