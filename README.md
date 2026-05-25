# ai-trader-for-gmo-coin-fx

AI-assisted FX trading research system for GMO Coin FX USD/JPY.

This repository is a paper trading and research tool. It is not financial
advice, investment advice, or a recommendation to trade.

## Overview

`ai-trader-for-gmo-coin-fx` is an AI-assisted FX trading research system for GMO
Coin FX USD/JPY. The current implementation collects public market data,
normalizes ticks and candles, runs Baseline Strategy Paper Trading, generates AI
Proposal and Daily Review JSON through the isolated AI Runner, and shows the operational
state through a Next.js dashboard.

Current status: MVP paper-trading implementation through Phase 4. The current
implementation is limited to paper trading and research workflows. Live trading,
GMO Private API integration, and real order placement are intentionally out of
scope for the current codebase.

See [docs/architecture.md](docs/architecture.md).

## Container layout

The local stack is split into a small set of containers so each runtime has a
clear job:

- `next-web`: Next.js dashboard for system status, research UI, and tRPC routes.
- `worker`: Hono API for health checks, readiness checks, status endpoints,
  market-data collection, Paper Trading, AI tuning, Daily Review, and manual
  run triggers.
- `ai-runner`: isolated service boundary for Claude CLI strategy proposal and
  Daily Review workflows, plus AI Agent tool-loop execution.
- `mcp-agent-research`: read-only research tool API used by AI Agents for
  market data, Candidate Strategy performance, rejection history, and memory recall.
- `timescaledb`: PostgreSQL/TimescaleDB storage for candles, features, paper
  trading records, Candidate Strategies, AI invocations, Daily Reviews, and AI
  Agent state.

Market data flows from the GMO Coin FX public API into the worker, through the
normalization and aggregation pipeline, then into TimescaleDB. The dashboard
reads stored data and worker health/status to show the current system state.

## App structure

- `apps/web`: Next.js dashboard, status page, and tRPC routes.
- `apps/worker`: Hono worker API, health endpoints, readiness checks, and
  background jobs.
- `apps/ai-runner`: isolated Claude CLI runner used by the worker over the
  internal Docker network for strategy proposal, review, and AI Agent workflows.
- `apps/mcp-agent-research`: read-only Hono API for AI Agent research tools.
- `packages/domain`: market-data clients, tick/candle normalization,
  aggregation, strategy DSL types, schemas, and validation.
- `packages/db`: Drizzle schema, database client, repositories, migrations, and
  metadata.
- `packages/config`: Shared environment/config helpers.
- `docs`: Architecture docs, ADRs, and roadmap.

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

Start the full local development stack:

```bash
docker compose -f docker/compose.yml -f docker/compose.development.yml up --build
```

Services:

- Next.js dashboard: http://localhost:3000
- tRPC health: http://localhost:3000/api/trpc/health
- Worker health: http://localhost:8787/health
- Worker readiness: http://localhost:8787/ready
- Worker status: http://localhost:8787/status
- AI runner health: http://localhost:8788/health
- MCP agent research health: http://localhost:8789/health
- TimescaleDB: `postgresql://ai_trade:ai_trade@localhost:5432/ai_trade`

Apply Drizzle migrations after TimescaleDB is running:

```bash
DATABASE_URL=postgresql://ai_trade:ai_trade@localhost:5432/ai_trade pnpm db:migrate
```

## Production container startup

The default Compose file is production-oriented. It builds runtime images first
and starts built artifacts instead of running development servers or installing
dependencies at container startup:

```bash
docker compose -f docker/compose.yml up -d --build
```

Production defaults bind the dashboard to `127.0.0.1:3000` and internal worker
services to localhost-only ports; `timescaledb` stays on the Docker network. Override
`AI_TRADE_POSTGRES_DB`, `AI_TRADE_POSTGRES_USER`, and
`AI_TRADE_POSTGRES_PASSWORD` through Compose's project environment, for example
with a root `.env` file or exported shell variables, when defaults are not
acceptable. Runtime application flags can be placed in `.env.production`.

## Continuous deployment

Pushes to `main` run CI first. When lint, typecheck, test, and build all pass,
GitHub Actions connects to the production host over SSH and runs the deploy
user's forced command.

Required repository secrets:

- `DEPLOY_HOST`: production SSH hostname.
- `DEPLOY_USER`: deploy-only SSH user, for example `deploy-ai-trade`.
- `DEPLOY_SSH_KEY`: private key for the deploy-only SSH user.
- `DEPLOY_PORT`: optional SSH port. Defaults to `22`.

## Commands

```bash
pnpm dev:web       # Next.js dashboard
pnpm dev:worker    # Worker Hono API
pnpm dev:ai-runner # AI Runner Hono API
pnpm dev:mcp-agent-research # Read-only AI Agent research tool API
pnpm db:generate   # Generate Drizzle migrations from schema
pnpm db:migrate    # Apply Drizzle migrations
pnpm lint
pnpm typecheck
pnpm test
```
