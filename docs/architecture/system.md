# System Architecture

## 全体構成

```text
Cloudflare Tunnel
  -> next-web

Docker Compose on VM
  ├─ next-web
  │   ├─ Next.js standalone
  │   ├─ tRPC API
  │   └─ dashboard / review UI
  │
  ├─ worker
  │   ├─ Hono health/status API
  │   ├─ CollectorService
  │   ├─ PaperTraderService
  │   ├─ AiTunerService
  │   └─ AiDailyReviewerService
  │
  ├─ ai-runner
  │   ├─ Hono internal API
  │   ├─ Claude CLI
  │   └─ AI Agent tool loop
  │
  ├─ mcp-agent-research
  │   ├─ Hono internal API
  │   └─ read-only research tools
  │
  ├─ timescaledb
  │   ├─ candles
  │   ├─ features
  │   ├─ strategies
  │   ├─ paper trading data
  │   └─ AI Proposal / Daily Review logs
  │
  └─ host-managed tunnel / reverse proxy
```

worker、ai-runner、mcp-agent-researchのHono APIは原則としてDocker network内部限定にする。外部公開が必要になった場合のみ、Cloudflare Access付きの管理用hostnameを検討する。

## ディレクトリ方針

```text
apps/
  web/
    src/
      app/
        api/trpc/[trpc]/route.ts
        (dashboard)/
          market-data/
          paper-trading/
          strategies/
          agents/
          reviews/

      server/
        trpc/
          init.ts
          root.ts
        routers/

      features/
        market-data/
          ui/
        paper-trading/
          ui/
        strategies/
          ui/
        agents/
          ui/
        ai-tuning/
          ui/

  worker/
    src/
      main.ts
      runtime.ts
      hono-app.ts
      api/
        admin-routes.ts
        status-routes.ts
      pipelines/
        market-data/
          collector.ts
          historical-importer.ts
        paper-trading/
          paper-trader.ts
        agent-evaluation/
          scheduler.ts
          run-envelope-builder.ts
          output-processor.ts
        strategy-evaluation/
          proposal-ingestion.ts
          candidate-slot-manager.ts
          adoption-runner.ts
          baseline-rollback-runner.ts
      services/
        ai-tuner.ts
        ai-daily-reviewer.ts

  ai-runner/
    src/
      main.ts
      hono-app.ts
      providers/
        claude-cli-provider.ts
      agent-loop/
        agent-runner.ts
        tool-client.ts
        prompt-builder.ts
        output-parser.ts
      policy/
        budget-guard.ts
        secret-redaction.ts

  mcp-agent-research/
    src/
      main.ts
      hono-app.ts
      read-only-db.ts
      server/
        mcp-server.ts
        transport.ts
      tools/
        context-snapshot/
        market-data/
        candidate-performance/
        rejection-history/
        memory/
        skills/
      data-sources/
        agent-context-reader.ts
        market-data-reader.ts
        strategy-performance-reader.ts
        agent-memory-reader.ts
      policy/
        tool-allowlist.ts
        read-only-guard.ts

packages/
  db/
    src/
      schema/
        candles.ts
        features.ts
        strategies.ts
        paper-trading.ts
        ai-invocations.ts
        ai-agents.ts
      client.ts
      repositories/
        candles.ts
        strategy-runs.ts
        paper-trading.ts
        ai-agents.ts
        ai-tuning.ts
      migrations/

  domain/
    src/
      market-data/
        gmo-fx-client.ts
        normalizer.ts
        candle-aggregator.ts
        spread.ts
        validation.ts
      strategies/
        schema.ts
        validator.ts
        baselines.ts
        presets.ts
      paper-trading/
        execution-model.ts
        account.ts
      risk/
        gates.ts
      strategy-evaluation/
        candidate-similarity.ts
        candidate-slots.ts
        adoption-gate.ts
        baseline-rollbacks.ts
      ai-tuning/
        proposal-schema.ts

  config/
    src/
      env.ts
      logger.ts
      time.ts
```

`apps/web`はNext.jsのrouting、dashboard UI、tRPC routerに限定する。Agent UIはprompt/tool allowlist/version、run log、memory/skills、proposal/review状態を表示・編集するが、AI Agent実行、Paper Account更新、Baseline Strategy昇格/停止の判定は持たない。`apps/worker`はHono API、scheduler、collector、paper trader、AI Runner呼び出し、Deterministic Control Planeのorchestrationに限定する。worker内部はpipeline単位に分け、AI Agent実行、Paper Trading、Strategy Evaluationを同じservice fileへ混在させない。

`apps/ai-runner`はClaude CLIの実行とAI Agent tool loopだけを担当する。provider、tool loop、prompt assembly、output parsing、budget guard、secret redactionを持つが、DB接続、repository、scheduler、Paper Account更新、Candidate Strategy投入、Risk Gate判定は持たない。

`apps/mcp-agent-research`はAI Agent向けread-only tool APIを担当する。Research Tool Serverは当面1つのappに集約し、tool、data source、policyを内部featureとして分ける。DB接続はread-onlyに固定し、write SQL、mutation repository、paper execution API、Risk Gate decisionは持たない。

AI Agent / LLM tool loopが観察するデータは必ずResearch Tool Server経由で取得する。workerのDeterministic Control Plane、Paper Trading、Adoption Gate、Baseline Strategy昇格/停止はMCPを経由せず、`packages/db` repositoryと`packages/domain`の純粋ロジックを直接使う。dashboardはtRPC/API経由で読み、AI Agent向けtool境界とは分ける。

Market dataの永続化用collector、normalizer、candle aggregationはworker側に残す。Research Tool ServerはAI Agent向けに保存済みデータとread-only外部参照を取得する境界であり、system of recordへ書き込むingestion pipelineではない。

`packages/db`はDrizzle schema、DB client、migration、repositoryを持つ。DB接続を使う処理は`apps/web`、`apps/worker`、`apps/mcp-agent-research`から`packages/db`経由で行い、schema定義を重複させない。repositoryは永続化とquery shapeに限定し、Candidate Slot選択、Adoption Gate、Risk Gateなどの判断は`packages/domain`またはworker pipelineに置く。

`packages/domain`はDBやHTTP serverに依存しない純粋ロジックだけを置く。market-data normalization、candle aggregation、Strategy DSL validation、paper execution model、Risk Gateはここに置き、Next.jsとworkerの両方から再利用する。Candidate Similarity Check、Candidate Slot、Adoption Gate、Shadow Baseline Run、Baseline Rollbackは `strategy-evaluation/` に集約し、AI AgentやMCP toolの責務にしない。

アプリ固有のcomposition、scheduler、Hono route、tRPC procedure、UI stateはpackage化しない。これにより共通化しすぎによる依存逆転を避ける。

### Dependency Direction

依存方向は以下に固定する。

```text
apps/web      -> packages/db
apps/web      -> packages/domain
apps/web      -> packages/config

apps/worker   -> packages/db
apps/worker   -> packages/domain
apps/worker   -> packages/config

apps/ai-runner -> packages/domain
apps/ai-runner -> packages/config

apps/mcp-agent-research -> packages/db
apps/mcp-agent-research -> packages/config

packages/db     -> packages/domain
packages/db     -> packages/config
packages/domain -> no internal package dependency
packages/config -> no internal package dependency
```

禁止する依存:

- `packages/domain -> packages/db`
- `packages/domain -> apps/*`
- `packages/db -> apps/*`
- `packages/config -> apps/*`
- `apps/ai-runner -> packages/db`
- `apps/ai-runner -> apps/worker`
- `apps/ai-runner -> apps/mcp-agent-research`
- `apps/mcp-agent-research -> apps/*`
- `apps/web -> apps/worker`
- `apps/worker -> apps/web`

worker、ai-runner、mcp-agent-researchはDocker network内の内部HTTPで通信する。TypeScript importで互いの`apps/*`配下を参照しない。

### Monorepo Tooling

package managerは既存の`pnpm@10.20.0`を使い、pnpm workspaceで管理する。

```text
pnpm-workspace.yaml:
  packages:
    - apps/*
    - packages/*
```

root package scriptsはworkspace commandに寄せる。

```text
pnpm --filter @ai-trade/web dev
pnpm --filter @ai-trade/worker dev
pnpm --filter @ai-trade/ai-runner dev
pnpm --filter @ai-trade/mcp-agent-research start
pnpm --filter @ai-trade/db migrate
pnpm -r typecheck
pnpm -r test
```

Phase 0では、workspace間の依存方向をCIで検査する。初期は軽量なimport boundary checkでよい。例えば`packages/domain`から`packages/db`、`apps/*`、Node server固有moduleをimportしていないこと、`apps/ai-runner`が`packages/db`に依存していないこと、`apps/*`同士がTypeScript importで結合していないことを検査する。

## Worker Runtime

workerは単一Node.jsプロセスとして起動する。

```ts
interface WorkerService {
  name: string
  start(): Promise<void>
  stop(): Promise<void>
  health(): Promise<ServiceHealth>
}
```

`WorkerRuntime`は以下を担当する。

- 全serviceの起動。
- Honoによる`/health`、`/status`、`/metrics`提供。
- `SIGTERM` / `SIGINT`でgraceful shutdown。
- いずれかのserviceがfatalになった場合はprocessを終了し、Docker Composeのrestart policyに復旧を委ねる。
- restart後はDB上のcheckpointと未完了job_runsを読み、欠損したmarket data、未処理candle、未評価paper tickをreplayする。

### Hono API

workerのHono APIは内部ネットワーク専用にする。初期エンドポイント:

```text
GET /health
  - liveness
  - processが応答できるかだけを見る

GET /ready
  - DB接続
  - collector初期化
  - scheduler初期化
  - AI Runner provider状態

GET /status
  - service別status
  - latest ticker timestamp
  - latest candle opened_at
  - websocket connected
  - last reconnect reason
  - last ai invocation status

GET /metrics
  - Prometheus text formatは将来拡張
  - 初期はJSONで十分

GET /agents
GET /agents/:id
  - AI Agent一覧と詳細

POST /jobs/agent-run
POST /jobs/agent-run-all
  - 内部限定
  - AI Agentの手動実行

POST /admin/reconnect-collector
  - 内部限定
  - WebSocket再接続

POST /admin/run-tuning
  - 内部限定
  - 手動hourly tuning実行

POST /admin/run-daily-review
  - 内部限定
  - 手動Daily Review実行
```

`/admin/*` は初期状態ではDocker network内からのみ呼べる前提にする。Cloudflare Tunnelには公開しない。

### Scheduler

worker内schedulerはNode.js process内で動かす。初期は外部キューを使わない。

```text
collector:
  - process start時に起動
  - WebSocket常時接続
  - REST補助 polling: 60s

candle aggregation:
  - 1m candle close後に5m/15m生成を試行
  - idempotent upsert

feature generation:
  - candle確定後に対象timeframeのfeatures生成
  - idempotent upsert

paper trader:
  - 1m: every minute after candle close
  - 5m: every 5 minutes after candle close
  - 15m: every 15 minutes after candle close

ai tuner:
  - hourly
  - Candidate Slotが満杯でも評価し、低スコアCandidate Strategyを入れ替え可能

ai daily reviewer:
  - daily
  - Asia/Tokyoの朝に実行

backup:
  - daily
  - workerから実行するか、別backup serviceに分けるかは実装時に選択
```

schedulerの全jobはDBに実行履歴を残す。

```text
job_runs:
  - job_name
  - started_at
  - finished_at
  - status
  - error_summary
  - metadata_json
```

jobは少なくとも以下の実行制御を持つ。

```text
job_control:
  - unique(job_name, target_key, scheduled_for)
  - status: queued | running | succeeded | failed | skipped
  - locked_by
  - locked_until
  - attempt
  - max_attempts
  - checkpoint_json
```

replay / checkpoint方針:

- collectorは最新保存済み1m candle、latest ticker timestamp、WebSocket reconnect reasonをcheckpointとして保存する。
- restart時は最後に確定した1m candle以降をREST KLineでbackfillし、WebSocket live streamに復帰する。
- candle aggregation、feature generation、paper traderはすべてidempotent upsertにし、`symbol + timeframe + opened_at + strategy/account`単位で再実行できるようにする。
- `running`のまま`locked_until`を過ぎたjobはstaleとして扱い、次回scheduler tickで再取得する。
- AI tuning / Daily Review / backupはcollectorとpaper traderを停止させない。AIやbackupの失敗は該当jobをfailedにし、market data収集とpaper tradingは継続する。
- backupは初期実装ではworker内jobでもよいが、Phase 5までに独立したCompose serviceへ分離できるようにjob interfaceを保つ。
