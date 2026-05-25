# Operations

## Live Trading Future Scope

初期実装ではlive orderを出さない。MVP buildではlive trading関連の具体実装を含めない。ただし、将来差し替えられるようにdomain modelはpaper/live共通にする。

MVP buildで禁止するもの:

- GMO Private API client。
- `GmoFxExecutionAdapter`などの実注文adapter。
- 実注文を発火できるdashboard操作。
- live order用のtRPC mutation / Hono admin endpoint。
- GMO Private API secretのenv定義とmount。
- `LIVE_TRADING_ENABLED=true`で有効化できるコードパス。

CIでは、MVP buildにlive order adapter、private API client、実注文mutation、private secret envが含まれないことを静的チェックする。

将来実装候補:

- GMO Private API adapter。
- live order service。
- live position sync。
- protective order / emergency close。
- manual approval flow。
- kill switch。
- account reconciliation。

live tradingに自動反映しないもの:

- hourly tuning結果。
- AIが新規生成したstrategy。
- risk gateの緩和。
- baseline昇格。

## Dashboard

初期dashboardは売買操作ではなく、運用監視、paper account比較、AI review確認を最優先にする。

初期画面:

```text
System Status
  - collector status
  - latest candle time
  - worker health
  - AI Runner / Claude CLI health
  - DB status

Paper Accounts
  - baseline / candidate一覧
  - balance
  - realized / unrealized PnL
  - drawdown
  - trade count
  - current position

Strategy Comparison
  - 1m / 5m / 15m比較
  - net profit after cost
  - max drawdown
  - trade count
  - adoption / reject reason

Daily Review
  - AI daily review
  - baseline昇格候補
  - candidate停止候補
  - warnings
```

baseline昇格など、人間承認が必要なpaper trading操作はdashboardから行えるようにする。MVP dashboardにはlive適用ボタン、実注文操作、GMO Private API secret入力欄を置かない。

## Testing

初期テスト方針:

```text
unit:
  - indicator calculation
  - candle aggregation
  - spread calculation
  - execution price calculation
  - risk gate
  - DSL schema validation
  - adoption policy

integration:
  - Drizzle repository with TimescaleDB
  - GMO public REST client with mocked responses
  - WebSocket collector with mocked server
  - paper trader end-to-end on fixture candles
  - ai-runner ClaudeCliProvider with fake executable
  - worker AiProvider client with mocked ai-runner

e2e:
  - docker compose -f docker/compose.yml up
  - migration apply
  - seed candles
  - run paper trader
  - dashboard reads status
```

外部APIに依存するテストは通常CIではmockにする。GMO public APIを実際に叩くsmoke testは手動または明示的な環境変数がある場合だけ実行する。

```text
RUN_GMO_LIVE_SMOKE=1
```

最低限のfixture:

```text
fixtures/
  candles/usd_jpy_1m_sample.json
  gmo/ticker-response.json
  gmo/symbols-response.json
  gmo/klines-response.json
  ai/strategy-proposal-valid.json
  ai/strategy-proposal-invalid.json
```

## Deployment

Docker Composeで全serviceを統一する。

```text
services:
  next-web:
    - Next.js standalone

  worker:
    - single Node.js process
    - Hono health/status

  db-migrate:
    - Drizzle migration one-shot job before worker startup

  ai-runner:
    - Hono internal API
    - Claude CLI

  timescaledb:
    - persistent volume

  cloudflared:
    - tunnel to next-web
```

### Container Layout

初期Docker service:

```text
next-web:
  build:
    target: next-web
  command: node apps/web/server.js
  internal_port: 3000
  host_bind: 127.0.0.1:3000
  exposed_to_tunnel: true

worker:
  build:
    target: worker
  command: node apps/worker/dist/main.cjs
  internal_port: 8787
  exposed_to_tunnel: false
  mounts:
    - backup volume if backup runs here

db-migrate:
  build:
    target: db-migrate
  command: pnpm db:migrate
  depends_on:
    - timescaledb healthy
  restart: "no"

ai-runner:
  build:
    target: ai-runner
  command: node apps/ai-runner/dist/main.cjs
  internal_port: 8788
  exposed_to_tunnel: false
  mounts:
    - claude config read-only

timescaledb:
  image: timescale/timescaledb:2.17.2-pg16
  exposed_to_host: false
  volume:
    - timescaledb-data

cloudflared:
  image: cloudflare/cloudflared
  route:
    - <dashboard-hostname> -> http://next-web:3000
```

local開発では`cloudflared`は必須にしない。`next-web`はlocalhostで確認し、workerとDBはDocker Composeで起動する。

### Environment

初期env:

```text
DATABASE_URL
NODE_ENV
APP_BASE_URL
WORKER_INTERNAL_URL
AI_RUNNER_INTERNAL_URL
GMO_FX_PUBLIC_REST_BASE_URL
GMO_FX_PUBLIC_WS_URL
ENABLED_SYMBOLS
AI_DAILY_REVIEW_ENABLED
AI_TUNING_ENABLED
```

MVP envにはlive trading用secretや`LIVE_TRADING_ENABLED`を置かない。将来live tradingを実装する場合も、default falseのfeature flagだけで有効化できる形にはせず、別Compose profile、別secret mount、明示的な人間承認flowを必須にする。

### Target VM

初期デプロイ先は、既存LANと分離された専用VMとする。公開リポジトリには実host名、VMID、IP address、Cloudflare hostname、SSH aliasなどの運用実値を記録しない。

```text
host: <hypervisor-host>
vmid: <vmid>
hostname: <vm-hostname>
ip: <isolated-subnet-vm-ip>/<prefix>
gateway: <isolated-subnet-gateway>
spec:
  - 4 cores
  - 8GB RAM
  - 100GB disk
network:
  - isolated bridge only
```

VMは専用内部ブリッジにのみ接続し、物理LANへ直接ブリッジしない。

ネットワーク分離方針:

```text
allowed:
  - VM -> internet via NAT
  - SSH from isolated gateway
  - SSH via Cloudflare tunnel route

blocked:
  - VM -> 10.0.0.0/8
  - VM -> 172.16.0.0/12
  - VM -> 192.168.0.0/16
  - operator machine -> VM direct SSH
```

nftablesでVMから既存VM/LANへの横移動を遮断する。UFWは有効化し、incoming deny / outgoing allowを基本とする。

Cloudflare / SSH:

```text
ssh hostname: <ssh-access-hostname>
ssh route:
  Cloudflare
  -> tunnel host cloudflared
  -> internal route
  -> isolated VM:22

local ssh alias:
  ssh <vm-alias>
```

Web公開用hostnameはNext.js導入後に追加する。Cloudflare Tunnelは `next-web` service のみを公開対象にし、`timescaledb` と `worker` は公開しない。

VM初期状態:

```text
installed:
  - qemu-guest-agent
  - curl
  - git
  - ufw
  - ca-certificates

not installed yet:
  - Docker
  - Node.js
  - PostgreSQL / TimescaleDB
  - Next.js application
```

VM初期セットアップのおすすめ手順:

```text
1. Docker EngineとDocker Compose pluginを導入する。
2. application directoryを作成する。
3. Claude CLI credential用secret directoryを作成する。
4. backup directoryを作成する。
5. repositoryを配置する。
6. .env.production を配置する。
7. docker compose -f docker/compose.yml pull/buildを実行する。
8. migrationを適用する。
9. workerの/readyを確認する。
10. next-webのhealthを確認する。
11. Cloudflare Tunnelにdashboard hostnameを追加する。
12. dashboardからSystem Statusを確認する。
```

VMにはNode.jsやPostgreSQLを直接導入しない。Node.jsはapplication image内、TimescaleDBはcontainerで動かす。

本番VMで必須の運用項目:

- DB volume永続化。
- 自動backup。
- restore手順。
- migration手順。
- secret管理。
- healthcheck。
- log rotation。
- firewall。
- DBをpublic exposeしない。

### Backup / Restore

TimescaleDBの初期バックアップは、毎日1回の`pg_dump` custom formatで行う。

```text
backup:
  schedule: daily
  method: pg_dump custom format
  retention: 7 days
  target:
    - VM内backup volume
    - future: external storage

restore_rehearsal:
  schedule: weekly
  method:
    - latest backupを別DBへrestore
    - migration versionを確認
    - row count / latest candle timeを検証
```

paper trading段階ではVM内backup volumeを初期保存先にする。live tradingへ進む前に外部保存先を追加し、restore rehearsalの結果をdashboardまたはdaily reviewで確認できるようにする。

### Secrets

Claude CLIの認証情報は、VM上の専用ディレクトリをai-runner containerにread-only mountする。host側の実pathは公開リポジトリに記録しない。

```text
host:
  <claude-config-host-directory>

ai-runner container:
  /home/node/.claude:ro
```

方針:

- 認証情報をDocker imageに焼かない。
- git管理しない。
- ai-runner containerにのみmountする。
- next-web containerには渡さない。
- worker containerには渡さない。
- 可能な限りread-only mountにする。

GMO API keyなど将来のlive trading用secretも、同じくworker専用secretとして扱う。初期実装ではlive tradingを無効化するため、GMO Private API secretは必須にしない。

## 未決事項

- Claude CLIをai-runner container内で安定動作させるためのベースイメージと認証mountの実機検証。
- Cloudflare TunnelのWeb hostname追加。
- 外部backup保存先の選定。paper段階ではVM内backup volumeで開始する。
