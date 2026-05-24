FROM node:24-bookworm-slim AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
RUN corepack enable

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY apps/ai-runner/package.json apps/ai-runner/package.json
COPY packages/config/package.json packages/config/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/domain/package.json packages/domain/package.json
RUN pnpm install --frozen-lockfile

FROM deps AS builder
COPY . .
RUN pnpm build

FROM base AS next-web
ENV NODE_ENV=production
WORKDIR /app
COPY --from=builder /app/apps/web/.next/standalone ./
COPY --from=builder /app/apps/web/.next/static ./apps/web/.next/static
EXPOSE 3000
CMD ["node", "apps/web/server.js"]

FROM deps AS worker
ENV NODE_ENV=production
COPY . .
EXPOSE 8787
CMD ["pnpm", "--filter", "@ai-trade/worker", "start"]

FROM deps AS ai-runner
ENV NODE_ENV=production
RUN npm install -g @anthropic-ai/claude-code@2.1.150
COPY . .
EXPOSE 8788
CMD ["pnpm", "--filter", "@ai-trade/ai-runner", "start"]
