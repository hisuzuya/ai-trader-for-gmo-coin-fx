# syntax=docker/dockerfile:1.7

FROM node:24-bookworm-slim AS base

ENV NEXT_TELEMETRY_DISABLED=1
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

WORKDIR /app

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

FROM deps AS db-migrate

ENV NODE_ENV=production

COPY tsconfig.base.json ./
COPY packages packages

CMD ["pnpm", "db:migrate"]

FROM node:24-bookworm-slim AS next-web

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

WORKDIR /app

COPY --from=builder --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=builder --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static

USER node
EXPOSE 3000

CMD ["node", "apps/web/server.js"]

FROM node:24-bookworm-slim AS worker

ENV NODE_ENV=production
ENV WORKER_PORT=8787

WORKDIR /app

COPY --from=builder --chown=node:node /app/apps/worker/dist/main.cjs ./apps/worker/dist/main.cjs

USER node
EXPOSE 8787

CMD ["node", "apps/worker/dist/main.cjs"]

FROM node:24-bookworm-slim AS ai-runner

ARG CLAUDE_CODE_VERSION=2.1.150

ENV NODE_ENV=production
ENV AI_RUNNER_PORT=8788
ENV CLAUDE_CONFIG_DIR=/home/node/.claude

WORKDIR /app

RUN npm install -g @anthropic-ai/claude-code@${CLAUDE_CODE_VERSION} \
  && mkdir -p /home/node/.claude \
  && chown -R node:node /home/node/.claude

COPY --from=builder --chown=node:node /app/apps/ai-runner/dist/main.cjs ./apps/ai-runner/dist/main.cjs

USER node
EXPOSE 8788

CMD ["node", "apps/ai-runner/dist/main.cjs"]
