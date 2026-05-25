# AI Trade Architecture

AI Tradeは、GMOコイン外国為替FX APIを利用し、USD/JPYを対象にした自動売買検証システムを構築する。初期実装は実注文を出さず、ローカル/VM上で市場データ収集、特徴量生成、AIによる戦略候補生成、ペーパートレード、日次レビューを行う。

Live tradingは将来スコープとして設計には含めるが、MVP buildには実注文path、GMO Private API client、live用secret/env、live用dashboard操作を含めない。

## Documents

- [System Architecture](./architecture/system.md): service分割、directory方針、dependency direction、worker runtime。
- [Data Architecture](./architecture/data.md): market data、candle schema、feature schema、TimescaleDB policy。
- [Trading Design](./architecture/trading.md): Strategy DSL、trade gates、paper execution、Paper Account。
- [AI Tuning](./architecture/ai-tuning.md): AI Runner、Claude CLI実行、tuning cadence、Candidate Strategy採用。
- [AI Agents](./architecture/ai-agents.md): Research + Evaluation Agent、read-only tool、memory、Candidate Review。
- [Operations](./architecture/operations.md): live trading future scope、dashboard、testing、deployment、backup、secrets。
- [Roadmap](./architecture/roadmap.md): 未決事項、初期実装順、MVP phases。

## Key Decisions

- 言語はTypeScript。
- WebアプリはNext.js + tRPC。
- 実行単位は`apps/web`、`apps/worker`、`apps/ai-runner`、`apps/mcp-agent-research`で分離する。
- Web UIとtRPCは`apps/web`、Honoとschedulerは`apps/worker`、Claude CLI実行とAI Agent tool loopは`apps/ai-runner`、read-only research toolsは`apps/mcp-agent-research`に置く。
- Drizzle schema / DB client / migrationsは`packages/db`で共有する。
- Strategy DSL、market-data正規化、paper execution、Risk Gateなどの純粋ドメインロジックは`packages/domain`で共有する。
- `packages/domain`はDB、HTTP server、`apps/*`に依存しない。
- DBはPostgreSQL + TimescaleDB。
- query layerはDrizzle。
- monorepo toolingは既存の`pnpm@10.20.0`に合わせ、pnpm workspaceで管理する。
- local/prod相当ともDocker Compose serviceで統一する。
- 公開はCloudflare Tunnelを使い、公開対象は`next-web`だけにする。
- Next.jsはstandalone buildをDocker serviceとしてVM上で動かす。
- Claude CLIはworkerではなく`ai-runner` container内で実行し、workerから内部APIで呼び出す。
- `ai-runner`はDB接続、repository write mount、GMO Private API secretを持たない。
- `mcp-agent-research`はDB read-only接続だけを持ち、DB write、Paper Account更新、Candidate Strategy投入、Risk Gate decisionは持たない。
- AI AgentはPaper Orderを直接出さず、Strategy Definition候補、Candidate Review、Observation、memory write intentだけを出力する。

## Context And Decisions

- Domain glossary: [CONTEXT.md](../CONTEXT.md)
- ADR: [0001 Claude CLIはAI Runnerで隔離実行する](./adr/0001-run-claude-cli-in-ai-runner.md)
- ADR: [0002 appsとpackagesの境界を固定する](./adr/0002-use-app-and-package-boundaries.md)
- ADR: [0003 Research + Evaluation Agentを導入する](./adr/0003-introduce-research-evaluation-ai-agents.md)
