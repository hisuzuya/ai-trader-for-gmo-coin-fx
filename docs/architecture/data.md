# Data Architecture

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
  - unique(symbol, timeframe, price_type, opened_at, feature_set_version, input_source_version)
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
  - input_source_version
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
