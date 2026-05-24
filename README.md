# ai-trader-for-gmo-coin-fx

AI-assisted FX trading research system for GMO Coin FX USD/JPY.

This repository is a paper trading and research tool. It is not financial
advice, investment advice, or a recommendation to trade.

## Overview

`ai-trader-for-gmo-coin-fx` is an AI-assisted FX trading research system for GMO
Coin FX USD/JPY. The current implementation focuses on collecting public market
data, normalizing ticks and candles, running worker-side import jobs, and
showing system status through a Next.js dashboard.

Current status: Phase 0 scaffold. The current implementation is limited to
paper trading and research workflows. Live trading, GMO Private API integration,
and real order placement are planned for a later phase and are intentionally out
of scope for the current codebase.

See [docs/architecture.md](docs/architecture.md).

## Container layout

The local stack is split into a small set of containers so each runtime has a
clear job:

- `next-web`: Next.js dashboard for system status, research UI, and tRPC routes.
- `worker`: Hono API for health checks, readiness checks, status endpoints, and
  background jobs such as historical market-data imports.
- `ai-runner`: isolated service boundary for future AI-assisted strategy
  proposal and review workflows.
- `timescaledb`: PostgreSQL/TimescaleDB storage for candles, features, and job
  run records.

Market data flows from the GMO Coin FX public API into the worker, through the
normalization and aggregation pipeline, then into TimescaleDB. The dashboard
reads stored data and worker health/status to show the current system state.

## App structure

- `apps/web`: Next.js dashboard, status page, and tRPC routes.
- `apps/worker`: Hono worker API, health endpoints, readiness checks, and
  background jobs.
- `apps/ai-runner`: AI runner service boundary for future strategy proposal and
  review workflows.
- `packages/domain`: market-data clients, tick/candle normalization,
  aggregation, strategy DSL types, schemas, and validation.
- `packages/db`: Drizzle schema, database client, repositories, migrations, and
  metadata.

## Safety scope

- Paper trading and research workflows only.
- No live order execution.
- No GMO Private API integration.
- No real order placement.
- Do not commit API keys, `.env` files, database dumps, private logs, or other
  sensitive material.

## Contributing

Small fixes, tests, documentation improvements, and paper-trading research
workflow improvements are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md).

Please do not submit changes that add live order execution, private trading API
credentials, secrets, or secret-like values.

## Local requirements

- Node.js 24
- pnpm 10
- Docker / Docker Compose

## Local startup

```bash
pnpm install
pnpm lint
pnpm typecheck
pnpm test
```

Start the full local stack:

```bash
docker compose up --build
```

Services:

- Next.js dashboard: http://localhost:3000
- tRPC health: http://localhost:3000/api/trpc/health
- Worker health: http://localhost:8787/health
- Worker readiness: http://localhost:8787/ready
- Worker status: http://localhost:8787/status
- AI runner health: http://localhost:8788/health
- TimescaleDB: `postgresql://ai_trade:ai_trade@localhost:5432/ai_trade`

Apply Drizzle migrations after TimescaleDB is running:

```bash
DATABASE_URL=postgresql://ai_trade:ai_trade@localhost:5432/ai_trade pnpm db:migrate
```

## Commands

```bash
pnpm dev          # Next.js dashboard
pnpm worker:dev   # Worker Hono API
pnpm db:generate  # Generate Drizzle migrations from schema
pnpm db:migrate   # Apply Drizzle migrations
pnpm lint
pnpm typecheck
pnpm test
```
