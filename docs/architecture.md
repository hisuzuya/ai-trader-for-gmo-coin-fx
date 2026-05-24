# AI Trade Architecture

## 目的

GMOコイン外国為替FX APIを利用し、USD/JPYを対象にした自動売買検証システムを構築する。初期実装は実注文を出さず、ローカル/VM上で市場データ収集、特徴量生成、AIによる戦略候補生成、ペーパートレード、日次レビューを行う。

Live tradingは将来スコープとして設計には含めるが、初期実装では無効化する。

## 決定事項

- 言語はTypeScript。
- WebアプリはNext.js + tRPC。
- 業務ロジックはNext.js内のvertical slice designで管理する。
- `packages/*` への過度な分割は初期段階では避ける。
- collectorはNext.jsとは別プロセス。
- workerは単一Node.jsプロセス。
- worker内にcollector、paper-trader、ai-tuner、ai-reviewerを同居させる。
- workerの外部操作/監視APIにはHonoを使う。
- DBはPostgreSQL + TimescaleDB。
- query layerはDrizzle。
- local/prod相当ともDocker Compose serviceで統一する。
- 公開はCloudflare Tunnelを使う。
- Next.jsはstandalone buildをDocker serviceとしてVM上で動かす。
- Claude CLIをworkerコンテナ内で実行し、AI providerとして利用する。
- 以降の詳細パラメータは、明示的な指定がない限りおすすめ値で確定する。

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
  │   ├─ AiDailyReviewerService
  │   └─ Claude CLI
  │
  ├─ timescaledb
  │   ├─ candles
  │   ├─ features
  │   ├─ strategies
  │   ├─ paper trading data
  │   └─ AI proposal/review logs
  │
  └─ cloudflared
```

workerのHono APIは原則としてDocker network内部限定にする。外部公開が必要になった場合のみ、Cloudflare Access付きの管理用hostnameを検討する。

## ディレクトリ方針

```text
src/
  app/
    api/trpc/[trpc]/route.ts
    (dashboard)/
      market-data/
      paper-trading/
      strategies/
      reviews/

  server/
    trpc/
      init.ts
      root.ts

  features/
    market-data/
      server/
      ui/
      types.ts

    paper-trading/
      server/
      ui/
      types.ts

    strategies/
      server/
        definitions/
        evaluator.ts
        registry.ts
        versioning.ts
      ui/
      types.ts

    ai-tuning/
      server/
        claude-cli-provider.ts
        prompt-builder.ts
        proposal-validator.ts
        adoption-policy.ts
        daily-review.ts
      ui/
      types.ts

    risk/
      server/
      types.ts

    live-trading/
      server/
      types.ts

  shared/
    db/
      schema/
      client.ts
    env/
    logger/
    time/

  worker/
    main.ts
    runtime.ts
    hono-app.ts
    services/
      collector.ts
      paper-trader.ts
      ai-tuner.ts
      ai-daily-reviewer.ts
```

`app`配下はルーティングと画面の入口に寄せる。取引、検証、AI、DB操作などの中核は`features/*`に置く。

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
  - Claude CLI provider状態

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

POST /admin/reconnect-collector
  - 内部限定
  - WebSocket再接続

POST /admin/run-tuning
  - 内部限定
  - 手動hourly tuning実行

POST /admin/run-daily-review
  - 内部限定
  - 手動daily review実行
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
  - candidate slotが満杯でも評価し、低スコア候補を入れ替え可能

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
- AI tuning / daily review / backupはcollectorとpaper traderを停止させない。AIやbackupの失敗は該当jobをfailedにし、market data収集とpaper tradingは継続する。
- backupは初期実装ではworker内jobでもよいが、Phase 5までに独立したCompose serviceへ分離できるようにjob interfaceを保つ。

## Market Data

対象は初期実装では`USD_JPY`のみ。ただしdomain modelとDB schemaは複数symbol対応にする。

GMO FX APIの確認済みエンドポイント:

```text
base:
  public_rest: https://forex-api.coin.z.com/public/v1
  public_websocket: wss://forex-api.coin.z.com/ws/public/v1

rest:
  status: GET /status
  ticker: GET /ticker
  klines: GET /klines
  symbols: GET /symbols

websocket:
  ticker:
    command: subscribe
    channel: ticker
    symbol: USD_JPY
```

公式仕様上、Public WebSocketのsubscribe / unsubscribeは同一IPから1秒1回を上限とする。サーバーは1分に1回pingを送り、3回連続でpongがない場合は切断されるため、collectorはping/pongとreconnect/backoffを必須実装にする。

`ticker` payload:

```text
symbol: string
ask: string
bid: string
timestamp: ISO timestamp
status: OPEN | CLOSE
```

`klines`は`symbol`、`priceType`、`interval`、`date`を指定する。`priceType`は`BID`または`ASK`。`interval`は`1min`、`5min`、`10min`、`15min`、`30min`、`1hour`などに対応する。日付指定は、短期足では`YYYYMMDD`を使い、2023-10-28以降を指定可能。`openTime`はUnix timestamp millisecondsとして返る。

live確認時点では、`GET /public/v1/symbols` の `USD_JPY` は以下だった。

```text
symbol: USD_JPY
tickSize: 0.001
minOpenOrderSize: 100
maxOrderSize: 500000
sizeStep: 1
checked_at: 2026-05-24T08:51:51Z
```

取引ルールは変更される可能性があるため、worker起動時に`/symbols`を取得し、DBまたはruntime configへ保存する。paper tradingでも固定値を盲信せず、取得済み取引ルールで数量丸めと発注可否を検証する。

収集方針:

- GMO FX WebSocketを主系統にする。
- REST pollingは補助に限定する。
- RESTは起動時snapshot、再接続後補正、欠損確認、過去KLine backfillに使う。
- tick全件保存は行わない。
- 1m candleをcanonical sourceとして長期保存する。
- 5m / 15m candleはアプリ側で1mから生成し、同じ`candles`テーブルに保存する。

```text
WebSocket ticker stream
  -> in-memory latest state
  -> 1m candle builder
  -> candles(timeframe = 1m)
  -> aggregate to 5m / 15m
  -> candles(timeframe = 5m / 15m)
```

1秒sampled tickerは初期必須ではない。必要な場合のみ短期TTL付きの`sampled_ticks`として導入する。

historical import:

```text
source:
  - GET /public/v1/klines
  - symbol=USD_JPY
  - priceType=BID and ASK
  - interval=1min
  - date=YYYYMMDD

normalization:
  - BID/ASKそれぞれの1m OHLCを保存する
  - mid candleはBID/ASK candleからderivedとして生成する
  - spread推定にBID/ASK差を使う
  - signal/featuresのcanonical inputはmid 1mにする
  - execution priceとspread/slippage評価はBID/ASKまたは保存済みspreadを使う
  - 5m / 15mはアプリ側でprice_typeごとに再集計して保存する
```

初期実装では、collectorによるlive candle生成と、historical importerによるREST KLine backfillを分ける。liveとbackfillの両方が同じ`candles` schemaにupsertできるようにする。

## Database

TimescaleDBを最初から使う。Drizzleで通常テーブルを定義し、hypertable、retention policy、continuous aggregateなどのTimescaleDB固有設定はSQL migrationで管理する。

主要テーブル:

```text
candles
  - symbol
  - timeframe
  - price_type
  - opened_at
  - open
  - high
  - low
  - close
  - volume
  - source
  - unique(symbol, timeframe, price_type, opened_at)
  - hypertable(opened_at)

features
  - symbol
  - timeframe
  - price_type
  - opened_at
  - feature_set_version
  - input_source_version
  - values_jsonb
  - unique(symbol, timeframe, price_type, opened_at, feature_set_version)
  - hypertable(opened_at)

strategy_definitions
strategy_config_versions
strategy_runs
tuning_policies
ai_invocations
ai_tuning_proposals
ai_daily_reviews
paper_accounts
paper_positions
paper_trades
paper_orders
economic_events
```

### Candle Schema

`candles`は1m / 5m / 15mを同一テーブルで扱う。BID/ASK由来とmid由来を区別できるようにする。

```text
candles:
  id: uuid
  symbol: text
  timeframe: text
  price_type: bid | ask | mid
  opened_at: timestamptz
  open: numeric
  high: numeric
  low: numeric
  close: numeric
  source: websocket | rest_klines | derived
  source_version: text
  created_at: timestamptz
  updated_at: timestamptz

unique:
  - symbol
  - timeframe
  - price_type
  - opened_at
```

初期は`volume`を必須にしない。GMO FXのKLine payloadがOHLC中心であるため、volume依存の戦略は初期DSLでは無効にする。

1mのBID/ASK candleは`rest_klines`または`websocket`由来で保存する。mid 1m candleはBID/ASK 1m candleから生成し、`source = derived` として保存する。5m / 15mは1mからprice_typeごとにアプリ側で生成し、`source = derived` として保存する。

canonical input方針:

```text
strategy signal:
  - price_type = mid
  - timeframe = strategy timeframe

feature generation:
  - price_type = mid
  - spread_pips / spread_sourceはBID/ASKまたはticker snapshotから保存する

paper execution:
  - BUY entry / close SELLはASK相当
  - SELL entry / close BUYはBID相当
  - BID/ASK candleがない場合のみmid +/- spread/2で代替する
```

### Feature Schema

特徴量は戦略実行時に再計算可能にするが、AI tuningとdashboardの速度のためDBにも保存する。

```text
features:
  id: uuid
  symbol: text
  timeframe: text
  price_type: mid
  opened_at: timestamptz
  feature_set_version: text
  input_source_version: text
  values: jsonb
  created_at: timestamptz

unique:
  - symbol
  - timeframe
  - price_type
  - opened_at
  - feature_set_version
```

初期の`feature_set_version`は`fx-core-v1`にする。

`features.values`はjsonbで保存するが、`feature_set_version`ごとにschema manifestをコード上に持ち、AI proposal validationとpaper traderは同じmanifestを参照する。strategy runには使用した`feature_set_version`と`input_source_version`を保存し、後から同じ入力で再計算できるようにする。

`fx-core-v1`:

```text
price:
  - close
  - return_1
  - return_3
  - return_5

volatility:
  - atr
  - atr_long
  - atr_spike_ratio
  - bb_width_pips

trend:
  - sma_20
  - sma_50
  - sma_100
  - ema_9
  - ema_21
  - ema_55
  - adx

momentum:
  - rsi
  - macd
  - macd_signal
  - macd_histogram

execution:
  - spread_pips
  - spread_source

calendar:
  - hour_of_day_utc
  - day_of_week_utc
  - is_rollover_window
  - is_news_blackout
```

### TimescaleDB Policy

初期のretention:

```text
sampled_ticks:
  retention: 30 days

candles:
  retention: none

features:
  retention: none

ai_invocations:
  retention: 180 days
```

continuous aggregateは初期MVPでは必須にしない。まずアプリ側集計で5m / 15mを生成し、dashboardで重い集計が出た段階で追加する。

## Strategy DSL

AIに自由なTypeScriptコードを生成・実行させない。AIは許可済みのindicator、condition、gate、exit、riskを組み合わせたJSON/DSLを出力する。

初期の使用可能指標:

- SMA
- EMA
- RSI
- Bollinger Bands
- ATR
- ADX
- MACD

FX向けの初期indicator presetは以下を使う。AI tunerはこのpresetを出発点にし、許可された範囲内でパラメータを調整する。

```text
sma:
  periods: [20, 50, 100]

ema:
  periods: [9, 21, 55]

rsi:
  period: 14
  oversold: 30
  overbought: 70

bollingerBands:
  period: 20
  stdDev: 2

atr:
  period: 14
  longPeriod: 50
  maxSpikeRatio: 2.5

adx:
  period: 14
  trendThreshold: 25
  weakTrendThreshold: 18

macd:
  fastPeriod: 12
  slowPeriod: 26
  signalPeriod: 9
```

timeframeごとの初期方針:

```text
1m:
  - noiseが多いためspread/slippage stressを強めに見る
  - RSIとBBの逆張りはconfirmationを強める
  - ADXが弱い局面のbreakoutを抑制する

5m:
  - baselineの標準timeframe
  - rangeではBB + RSI、trendではADX + EMA/SMA整合を重視する

15m:
  - trade countが少ないためvalidation windowを長めにする
  - trend followとregime判定を重視する
```

初期parameter ranges:

```text
rsi.period: 7..21
rsi.oversold: 20..40
rsi.overbought: 60..80

bollingerBands.period: 10..30
bollingerBands.stdDev: 1.5..2.5

atr.period: 7..21
atr.longPeriod: 30..100
atr.maxSpikeRatio: 1.5..3.5

adx.period: 10..21
adx.trendThreshold: 18..35
adx.weakTrendThreshold: 12..25

macd.fastPeriod: 8..15
macd.slowPeriod: 20..35
macd.signalPeriod: 5..12
```

戦略定義の概形:

```ts
type StrategyDefinition = {
  meta: {
    name: string
    description: string
    symbol: string
    timeframe: '1m' | '5m' | '15m'
    enabled: boolean
  }

  indicators: {
    sma?: { periods: number[] }
    ema?: { periods: number[] }
    rsi?: { period: number }
    bollingerBands?: { period: number; stdDev: number }
    atr?: { period: number; longPeriod?: number }
    adx?: { period: number }
    macd?: {
      fastPeriod: number
      slowPeriod: number
      signalPeriod: number
    }
  }

  gates: StrategyGates
  regime: RegimeDefinition
  entry: EntryDefinition
  exit: ExitDefinition
  risk: RiskDefinition
}
```

AIができること:

- 新しい戦略候補を提案する。
- timeframeを選ぶ。
- 指標を組み合わせる。
- entry / exit条件を提案する。
- パラメータ範囲を提案する。

AIがしてはいけないこと:

- 本番コードを直接変更する。
- DBやファイルを直接編集する。
- shell実行権限を持つ。
- risk gateを自動で緩和する。
- live tradingに未検証ロジックを自動反映する。

### Initial Baseline Strategies

初期baselineは、1m / 5m / 15mにそれぞれ1つずつ置く。全て同じDSLで表現し、timeframe別にexit parameterとgateを変える。

```text
baseline_1m:
  mode: hybrid
  intent:
    - rangeではBB + RSIの逆張り
    - trendではEMA整合 + BB breakout
  strictness:
    - spread gateを厳しめ
    - candle confirmationを有効
    - ADXが弱いbreakoutは抑制

baseline_5m:
  mode: hybrid
  intent:
    - 標準baseline
    - range/trend regime切替
    - BB + RSI + ADX + EMA/SMA整合

baseline_15m:
  mode: trend_biased_hybrid
  intent:
    - trend follow寄り
    - 逆張りは弱め
    - regime invalidation exitを重視
```

初期baselineの目的は「勝つこと」だけではなく、AI candidateの比較基準を安定させること。baselineは人間承認なしに自動変更しない。

### DSL Validation

AI proposalは以下を通過しなければcandidateに投入しない。

```text
validation:
  - JSON parse
  - schema validation
  - allowed indicator validation
  - parameter range validation
  - risk gate cannot be relaxed
  - timeframe must be 1m | 5m | 15m
  - symbol must be USD_JPY in initial implementation
  - max open positions cannot exceed 2
  - allow_reversal_entry must remain false in initial implementation
```

risk gateの緩和、未許可indicator追加、TypeScriptコード生成、shell実行要求を含むproposalはrejectする。

## Trade Gates

entry gate、exit gate、AI tuning gateは分離する。

### Entry Gate

```text
data gate
  - candle本数不足ならHOLD
  - 欠損candleがあるならHOLD
  - 最新candleが古いならHOLD
  - spread推定不能ならHOLD

market time gate
  - 市場クローズ中はHOLD
  - ロールオーバー前後はHOLD
  - 週末クローズ前は新規停止
  - 除外時間帯は新規停止

event gate
  - 重要経済指標前後は新規停止
  - exitは原則止めない

volatility gate
  - BB幅が狭すぎるならHOLD
  - 短期ATR / 長期ATRが高すぎるならHOLD
  - spreadが上限超過ならHOLD

regime gate
  - SIDEWAYS / UP / DOWN / TRANSITIONを判定
  - レジーム遷移直後は一定本数HOLD
  - ADXまたはslope + ADXの併用を基本候補にする

signal quality gate
  - レンジならBB + RSI逆張り
  - トレンドならbreakout / pullback順張り
  - SMA整合で危険な逆方向entryを抑止
  - candle confirmationはパラメータ化

account risk gate
  - 日次損失上限
  - 連敗クールダウン
  - rolling PnL gate
  - 証拠金維持率
  - 最大ポジション数
  - 最大同方向exposure
```

FX取引時間ゲートの初期値:

```text
rollover_blackout:
  before: 10m
  after: 10m

monday_open_blackout:
  after_open: 30m

weekend_close_blackout:
  before_close: 60m

news_blackout:
  high_impact:
    before: 30m
    after: 30m
  medium_impact:
    before: 10m
    after: 10m
```

これらのblackoutは新規entry停止を目的とする。exit、hard SL、emergency exit、週末クローズ前exitはblackout中でも止めない。

経済指標カレンダーは、初期実装では手動登録にする。信頼できる外部API連携は後続拡張として扱う。

```text
economic_events
  - title
  - country
  - impact: high | medium | low
  - scheduled_at
  - blackout_before_minutes
  - blackout_after_minutes
  - source: manual | imported
```

初期登録対象:

- 米雇用統計。
- FOMC。
- 米CPI。
- 米PPI。
- 米GDP。
- 日銀政策金利。
- FRB議長会見。
- 日銀総裁会見。

spread / slippageの初期値:

```text
max_spread_pips:
  1m: 0.5
  5m: 0.8
  15m: 1.0

slippage_pips:
  normal: 0.2
  stress: 0.5
  severe_stress: 1.0
```

1mはspread負けしやすいため厳しめに扱う。15mは保有時間が長くなりやすいため、entry gate上はやや広めに許容する。candidate採用ではnormalだけでなくstress条件でも大きく崩れないことを確認する。

spread推定は以下の優先順位で行う。

```text
spread_source_priority:
  1. live bid/ask from WebSocket
  2. REST ticker bid/ask snapshot
  3. timeframe default spread

default_spread_pips:
  1m: 0.5
  5m: 0.8
  15m: 1.0
```

paper execution、backtest、candidate evaluationでは、使用したspreadの値と取得元を保存する。

```text
spread_source: websocket_bid_ask | rest_snapshot | default
spread_pips: number
```

### Exit Gate

exitはentry gateと独立させ、ニュースブラックアウト中でもhard exitは止めない。

優先順位:

```text
1. 証拠金維持率 / emergency exit
2. 週末クローズ前exit
3. ロールオーバー前のswap-negative exit
4. hard SL
5. TP
6. break-even
7. trailing stop
8. partial take profit
9. opposite signal / regime invalidation
```

exit parameterの初期値:

```text
1m:
  take_profit_pips: 5
  stop_loss_pips: 5
  trailing_stop_pips: 3
  break_even_trigger_pips: 2

5m:
  take_profit_pips: 10
  stop_loss_pips: 10
  trailing_stop_pips: 5
  break_even_trigger_pips: 3

15m:
  take_profit_pips: 20
  stop_loss_pips: 15
  trailing_stop_pips: 8
  break_even_trigger_pips: 6
```

1mは小さく早く、5mは標準、15mはやや伸ばす前提にする。AI tunerはこの値を初期値として、許可された範囲内で調整する。

反対シグナル発生時は、初期実装では既存ポジションの決済のみ行う。ドテンは取引回数を増やす一方で、1m戦略では往復ビンタやspread負けを増やしやすいため、週次レビュー後の拡張候補にする。

```text
opposite_signal_exit: true
allow_reversal_entry: false
```

## Paper Trading

初期実装ではpaper tradingのみを実行する。MVP buildにはlive order adapter、GMO Private API client、実注文route、実注文用secretを含めない。

```text
Strategy Engine
  -> Risk Gate
  -> OrderIntent
  -> ExecutionAdapter
       - PaperExecutionAdapter
```

将来live tradingへ進む場合も、MVPとは別設計、別PR、別Compose profileで追加する。paper trading用のdomain modelは将来adapterを差し替えられる形に保つが、初期実装では`GmoFxExecutionAdapter`という具体実装を作らない。

### Execution Model

初期のpaper executionは、シグナル確定後に次足始値で約定したものとして扱う。

```text
signal confirmed at candle close
  -> execute at next candle open
  -> fixed spread + slippageを加算
```

entry:

```text
BUY
  - execution_price = next_open + spread_pips / 2 + slippage_pips

SELL
  - execution_price = next_open - spread_pips / 2 - slippage_pips
```

exit:

```text
close BUY position
  - execution_price = next_open - spread_pips / 2 - slippage_pips

close SELL position
  - execution_price = next_open + spread_pips / 2 + slippage_pips
```

signal entry / opposite signal exitは次足openで約定させる。hard SL、TP、break-even、trailing stop、emergency exitは保守的にintrabar判定する。

intrabar判定:

```text
source:
  - 1m strategy: 次の1m candleのhigh/low
  - 5m strategy: 5m保有区間内の1m candle high/low
  - 15m strategy: 15m保有区間内の1m candle high/low

BUY position:
  - SL判定はBID lowで見る
  - TP判定はBID highで見る

SELL position:
  - SL判定はASK highで見る
  - TP判定はASK lowで見る

when both TP and SL touched in same 1m candle:
  - SL優先で約定させる
  - 理由をpaper_orders.execution_reasonに保存する
```

BID/ASK candleがない区間では、mid candleに保存済みspreadを加減してBID/ASK相当を推定する。spread_sourceが`default`の区間はcandidate採用判定で不利に扱う。

シグナル足のcloseで約定させる方式は、検証が楽観的になりやすいため採用しない。tick/orderbook由来の可変slippageや約定拒否は、より現実寄りのモデルが必要になった段階で将来拡張として扱う。

### Paper Account

初期のpaper accountは、将来の実運用想定に合わせる。

```text
initial_balance_jpy: 20,000
leverage: 25x
currency: JPY
```

baselineとcandidateはすべて同じ初期資金、同じレバレッジ条件で独立した仮想口座として動かす。これにより、timeframeやstrategy candidate間で、取引回数、手数料・スプレッド込み損益、最大ドローダウン、証拠金維持余力を公平に比較する。

少額・高レバレッジ運用では、損益率よりも破綻回避を優先する。paper評価では以下を必ず見る。

- 証拠金維持率の最低値。
- 最大ドローダウン。
- 連敗数。
- 1日の最大損失。
- spread / slippage stress後の残高。
- 最小取引単位に丸めた後の実取引可能性。

lot sizingは初期実装では固定ロット方式にする。口座残高とSL幅から計算するrisk% sizingは、少額運用では最小取引単位や丸めの影響が強く出るため、将来拡張として扱う。

```text
lot_sizing:
  mode: fixed
  fixed_quantity: 1,000
  guards:
    - max_margin_usage_pct: 50
    - max_loss_per_trade_jpy: 1,000
    - max_daily_loss_jpy: 2,000
    - min_margin_maintenance_rate_for_entry: 300
    - warning_margin_maintenance_rate: 250
    - emergency_exit_margin_maintenance_rate: 150
```

固定数量はUSD/JPYの1,000通貨を初期値にする。固定数量でもrisk gateは必ず通す。固定数量が証拠金余力、最大損失、スプレッド悪化耐性を満たさない場合はentryしない。

20,000円口座、25倍、USD/JPYが150〜160円台の場合、1,000通貨の必要証拠金は概ね6,000〜6,400円で、口座の約30%強を使う。`max_margin_usage_pct: 50`を守ると2ポジション同時保有はほぼ通らないため、初期実装では1口座1ポジションに固定する。

日次損失上限は初期値として2,000円にする。20,000円口座では10%に相当するため、日次レビューではこの上限到達だけでなく、1,000円以上の損失も警告対象として扱う。

1取引あたりの最大許容損失は初期値として1,000円にする。これは日次損失上限2,000円の50%に相当するため、2回の大きな負けで当日停止しうる前提で評価する。

証拠金維持率は3段階で扱う。

```text
min_margin_maintenance_rate_for_entry: 300%
warning_margin_maintenance_rate: 250%
emergency_exit_margin_maintenance_rate: 150%
```

300%未満では新規entryを停止する。250%未満ではdashboardと日次レビューで警告する。150%未満ではpaper上でもemergency exit相当として評価し、将来live tradingでは緊急決済候補にする。

同時保有ポジションは、各paper accountごとに最大1までにする。積み増しと両建ては初期実装では禁止し、証拠金使用率50%のrisk gateを必ず通す。

```text
max_open_positions_per_account: 1
allow_pyramiding: false
max_same_direction_positions: 1
allow_hedged_positions: false
max_margin_usage_pct: 50
```

2ポジション同時保有は、残高、固定数量、margin usage上限を再設計する週次レビュー後の拡張候補にする。

paper tradingは複数候補を同時に並走する。

```text
1m
  - baseline_1m
  - candidate_1m_1
  - candidate_1m_2
  - candidate_1m_3

5m
  - baseline_5m
  - candidate_5m_1
  - candidate_5m_2
  - candidate_5m_3

15m
  - baseline_15m
  - candidate_15m_1
  - candidate_15m_2
  - candidate_15m_3
```

candidateはtimeframeごとに最大3個、合計9個まで。baseline昇格は人間承認とする。

candidate lifecycle:

```text
proposed
  -> validated
  -> running_paper
  -> promoted_to_baseline
  -> retired
```

候補入れ替え:

- 最低24時間は走らせる。
- emergency reject条件に触れたら即停止する。
- 枠が満杯の場合、最低評価期間を満たした低スコア候補から入れ替える。

## AI Tuning

Claude CLIをworkerコンテナ内で実行し、`claude -p`をAI providerとして扱う。worker中核はClaude CLIに直接依存させず、`AiProvider` interfaceの一実装として閉じ込める。

```ts
interface AiProvider {
  generateStrategyProposal(input: StrategyProposalInput): Promise<StrategyProposal>
  generateDailyReview(input: DailyReviewInput): Promise<DailyReview>
}
```

`ClaudeCliProvider`の責務:

- child processで`claude -p`を実行する。
- 構造化JSON出力を要求する。
- timeoutを必ず設定する。
- stdout / stderrを保存する。
- JSON schema validationを行う。
- invalid outputはrejectする。
- provider healthを`/status`に表示する。

Claude CLI実行の初期設定:

```text
timeout:
  tuning: 120s
  daily_review: 180s

retry:
  max_attempts: 1
  retry_on:
    - timeout
    - non_json_output
    - non_zero_exit

output:
  - JSON only
  - markdownは禁止
  - explanationはJSON field内に限定
```

失敗時は既存baseline/candidateを維持し、AI proposalは`failed`として保存する。

AI tunerに渡す情報:

- 現在のstrategy definition。
- 現在のparameter ranges。
- 直近paper成績。
- 過去backtest要約。
- walk-forward要約。
- rejectされた過去候補の理由。
- 現在の探索方針。

`ai_invocations`に保存する内容:

```text
provider: claude_cli
command: claude -p
prompt_hash
prompt_redacted
stdout_raw
stderr_summary
parsed_json
started_at
finished_at
status
timeout_ms
cli_version
```

API key、DB URL、GMO secret、Cloudflare tokenなどはpromptに含めない。

渡さない情報:

- 生candle全量。
- 生tick全量。
- DB接続情報。
- API secret。
- shell実行権限。
- risk gateを緩和する権限。

### Tuning Cadence

```text
hourly tuning
  - 既存strategy definitionのパラメータ微調整候補を生成
  - gate通過後、paper candidateへ自動投入
  - liveには反映しない

daily review
  - AIが日次レビューを作成
  - 1m / 5m / 15mの成績比較
  - baseline昇格候補を推薦
  - candidate停止候補を推薦
  - 人間レビュー対象にする

weekly review
  - ロジック構造の変更
  - 指標セットの追加削除
  - DSL拡張
  - live適用候補の承認
```

hourly tuningの検証窓:

```text
1m
  - train: 24h
  - validation: 6h
  - min_trade_count: 5

5m
  - train: 72h
  - validation: 24h
  - min_trade_count: 5

15m
  - train: 14d
  - validation: 3d
  - min_trade_count: 5
```

採用判定はgate + scoreで行う。

重視する指標:

1. 手数料・スプレッド込み損益。
2. 取引回数。
3. 最大ドローダウン。

最大ドローダウンの初期閾値:

```text
daily_review_warning_drawdown_pct: 10
candidate_adoption_max_drawdown_limit_pct: 15
emergency_retire_drawdown_pct: 20
```

20,000円口座では、10%は2,000円、15%は3,000円、20%は4,000円に相当する。10%到達で日次レビュー警告、15%超過でcandidate採用拒否、20%到達でcandidate即停止候補とする。

gate例:

- `net_profit_after_cost > 0`
- `trade_count >= min_trade_count`
- `max_drawdown <= max_drawdown_limit`
- spread / slippage stressで大きく崩れない。
- validationがtrainより極端に悪くない。
- baselineより一定以上改善している。

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
  - Claude CLI health
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
  - ClaudeCliProvider with fake executable

e2e:
  - docker compose up
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
    target: next-standalone
  command: node server.js
  internal_port: 3000
  exposed_to_tunnel: true

worker:
  build:
    target: worker
  command: node dist/worker/main.js
  internal_port: 8787
  exposed_to_tunnel: false
  mounts:
    - claude config read-only
    - backup volume if backup runs here

timescaledb:
  image: timescale/timescaledb:latest-pg16
  exposed_to_host: false
  volume:
    - timescaledb-data

cloudflared:
  image: cloudflare/cloudflared
  route:
    - ai-trading.rayven.cloud -> http://next-web:3000
```

local開発では`cloudflared`は必須にしない。`next-web`はlocalhostで確認し、workerとDBはDocker Composeで起動する。

### Environment

初期env:

```text
DATABASE_URL
NODE_ENV
APP_BASE_URL
WORKER_INTERNAL_URL
GMO_FX_PUBLIC_REST_BASE_URL
GMO_FX_PUBLIC_WS_URL
ENABLED_SYMBOLS
CLAUDE_CONFIG_DIR
AI_TUNING_ENABLED
```

MVP envにはlive trading用secretや`LIVE_TRADING_ENABLED`を置かない。将来live tradingを実装する場合も、default falseのfeature flagだけで有効化できる形にはせず、別Compose profile、別secret mount、明示的な人間承認flowを必須にする。

### Target VM

初期デプロイ先はProxmox上の専用VM `ai-trading-01` とする。

```text
host: Proxmox PC2 pve-pc2
vmid: 203
hostname: ai-trading-01
ip: 10.30.0.2/24
gateway: 10.30.0.1
spec:
  - 4 cores
  - 8GB RAM
  - 100GB disk
network:
  - vmbr-trading only
```

VMは専用内部ブリッジ `vmbr-trading` にのみ接続する。`vmbr-trading` のhost側IPは `10.30.0.1/24` とし、物理LANへ直接ブリッジしない。

ネットワーク分離方針:

```text
allowed:
  - VM -> internet via NAT
  - SSH from 10.30.0.1
  - SSH from 10.11.0.10 via Cloudflare tunnel route

blocked:
  - VM -> 10.0.0.0/8
  - VM -> 172.16.0.0/12
  - VM -> 192.168.0.0/16
  - Mac -> 10.30.0.2 direct SSH
```

nftablesでVMから既存VM/LANへの横移動を遮断する。UFWは有効化し、incoming deny / outgoing allowを基本とする。

Cloudflare / SSH:

```text
ssh hostname: ai-trading-ssh.rayven.cloud
ssh route:
  Cloudflare
  -> PC1 cloudflared
  -> PC1 static route
  -> PC2
  -> 10.30.0.2:22

local ssh alias:
  ssh ai-trading
```

Web公開用hostname `ai-trading.rayven.cloud` はNext.js導入後に追加する。Cloudflare Tunnelは `next-web` service のみを公開対象にし、`timescaledb` と `worker` は公開しない。

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
2. /opt/ai-trade を作成する。
3. /opt/ai-trade/secrets/claude を作成する。
4. /opt/ai-trade/backups を作成する。
5. repositoryを配置する。
6. .env.production を配置する。
7. docker compose pull/buildを実行する。
8. migrationを適用する。
9. workerの/readyを確認する。
10. next-webのhealthを確認する。
11. Cloudflare Tunnelに ai-trading.rayven.cloud を追加する。
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

Claude CLIの認証情報は、VM上の専用ディレクトリをworker containerにread-only mountする。

```text
host:
  /opt/ai-trade/secrets/claude/

worker container:
  /home/node/.claude:ro
```

方針:

- 認証情報をDocker imageに焼かない。
- git管理しない。
- worker containerにのみmountする。
- next-web containerには渡さない。
- 可能な限りread-only mountにする。

GMO API keyなど将来のlive trading用secretも、同じくworker専用secretとして扱う。初期実装ではlive tradingを無効化するため、GMO Private API secretは必須にしない。

## 未決事項

- Claude CLIをDocker container内で安定動作させるためのベースイメージと認証mountの実機検証。
- Cloudflare TunnelのWeb hostname `ai-trading.rayven.cloud` 追加。
- 外部backup保存先の選定。paper段階ではVM内backup volumeで開始する。

## 次に実装すること

おすすめの初期実装順:

```text
1. Next.js + tRPC + Drizzle + TimescaleDBの最小構成を作る。
2. docker-compose.local.ymlでnext-web / worker / timescaledbを起動する。
3. Drizzle schemaとTimescaleDB migrationを作る。
4. GMO public REST clientを作り、/status /ticker /symbols /klinesを取得する。
5. historical importerでUSD_JPY 1min BID/ASK KLineをbackfillする。
6. WebSocket collectorでUSD_JPY tickerを購読する。
7. 1m candle builderと5m/15m aggregatorを実装する。
8. paper execution modelを実装する。entryは次足open、SL/TP/trailingは1m intrabar判定で実装する。
9. strategy DSLとbaseline strategyを実装する。
10. ClaudeCliProviderを実装する。
11. hourly tuningとcandidate並走を実装する。
12. dashboardでsystem status / paper accounts / strategy comparison / daily reviewを表示する。
```

初期実装ではlive trading、GMO Private API、実注文、保護注文、live用secret/env、live用dashboard操作は実装しない。

## MVP Phases

### Phase 0: Scaffold

```text
goal:
  - Next.js / tRPC / Drizzle / TimescaleDB / Docker Composeの骨格を作る

done:
  - docker composeでnext-web / worker / timescaledbが起動する
  - migrationが適用できる
  - dashboardにSystem Statusの空表示が出る
```

### Phase 1: Market Data

```text
goal:
  - GMO FX public dataを保存できる

done:
  - /symbols /status /ticker /klinesを取得できる
  - USD_JPY 1m BID/ASK KLineをbackfillできる
  - WebSocket tickerを購読できる
  - 1m / 5m / 15m candlesを保存できる
```

### Phase 2: Paper Trading Baseline

```text
goal:
  - AIなしでbaseline strategyをpaper実行できる

done:
  - 1m / 5m / 15m baselineが並走する
  - fixed quantity 1,000でpaper tradesが記録される
  - 各paper accountは最大1ポジションで動く
  - spread/slippage込み損益が表示される
  - SL/TP/trailingが1m intrabarで保守的に判定される
  - risk gateでentryが止まる
```

### Phase 3: AI Candidate Tuning

```text
goal:
  - Claude CLIでcandidateを生成し、paperに自動投入する

done:
  - ClaudeCliProviderがJSON proposalを返す
  - invalid proposalがrejectされる
  - hourly tuningでcandidate slotに投入される
  - baseline/candidate比較がdashboardに出る
```

### Phase 4: Daily Review

```text
goal:
  - AI daily reviewで運用判断を補助する

done:
  - daily reviewが保存される
  - baseline昇格候補が表示される
  - candidate停止候補が表示される
  - warningが表示される
```

### Phase 5: Production Paper Run

```text
goal:
  - ai-trading-01上でpaper tradingを継続稼働する

done:
  - VM上でDocker Composeが常時起動する
  - Cloudflare Tunnelでdashboardを見られる
  - backupが毎日作成される
  - restore rehearsalが週1回成功する
  - 7日以上連続稼働する
```

live tradingはMVPに含めない。Phase 5のpaper runで十分な運用実績が出てから、別設計として扱う。
