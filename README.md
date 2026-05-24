# ai-trade

AI-assisted FX paper trading system for GMO Coin FX USD/JPY.

This repository is a paper trading and research tool. It is not financial
advice, investment advice, or a recommendation to trade.

Current status: Phase 0 scaffold. Live trading, GMO Private API, and real order
placement are intentionally out of scope.

See [docs/architecture.md](docs/architecture.md).

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
