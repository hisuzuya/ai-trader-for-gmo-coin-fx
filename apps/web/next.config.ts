import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  transpilePackages: ["@ai-trade/domain", "@ai-trade/db", "@ai-trade/config"],
  turbopack: {
    resolveExtensions: [".ts", ".tsx", ".js", ".jsx", ".json", ".mjs"],
    resolveAlias: {
      "./types.js": "./types.ts",
      "./characters.js": "./characters.ts",
      "./server/validator.js": "./server/validator.ts",
    },
  },
};

export default nextConfig;
