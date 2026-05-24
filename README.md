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

## Architecture

```mermaid
flowchart LR
  GMO["GMO Coin FX Public API"] --> Worker["Worker / Hono API"]
  Worker --> Jobs["Market Data Import Jobs"]
  Jobs --> Normalize["Tick & Candle Normalization"]
  Normalize --> DB["TimescaleDB"]
  DB --> Dashboard["Next.js Dashboard"]
  Dashboard --> Status["System Status / Health"]
  Worker --> Status
```

## App structure

- `src/app`: Next.js dashboard and API routes.
- `src/server/trpc`: tRPC router and server setup.
- `src/worker`: Hono worker API, health endpoints, and background jobs.
- `src/features/market-data`: GMO FX public API client, tick/candle
  normalization, aggregation, and persistence.
- `src/features/strategies`: Strategy DSL types, presets, schemas, and
  validation.
- `src/shared/db`: Drizzle schema and database client.
- `drizzle`: Database migrations and metadata.
- `tests`: Unit tests and API/market-data fixtures.

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
