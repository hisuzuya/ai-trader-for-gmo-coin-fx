# Trading Design

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
- Risk Gateを自動で緩和する。
- live tradingに未検証ロジックを自動反映する。

### Initial Baseline Strategies

初期Baseline Strategyは、1m / 5m / 15mにそれぞれ1つずつ置く。全て同じDSLで表現し、timeframe別にexit parameterとgateを変える。

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
    - 標準Baseline Strategy
    - range/trend regime切替
    - BB + RSI + ADX + EMA/SMA整合

baseline_15m:
  mode: trend_biased_hybrid
  intent:
    - trend follow寄り
    - 逆張りは弱め
    - regime invalidation exitを重視
```

初期Baseline Strategyの目的は「勝つこと」だけではなく、AI Proposalから作られるCandidate Strategyの比較基準を作ること。Baseline Strategyは固定controlではなく、timeframeごとに1つだけ存在する現役の基準戦略として継続的に自動更新する。

### Baseline Auto-Update

Baseline Strategyは同じtimeframeのCandidate Strategyだけから自動昇格できる。

```text
candidate_1m  -> baseline_1m
candidate_5m  -> baseline_5m
candidate_15m -> baseline_15m
```

自動昇格条件:

```text
Adoption Gate通過
AND
Daily Review recommendation = promote
AND
Daily Review confidence = high
```

新しいBaseline Strategyが昇格した場合、旧Baseline Strategyはtimeframe別validation window 1回分だけShadow Baseline Runとして継続評価する。Shadow Baseline Runが新Baseline Strategyより明確に良い場合は、Baseline Rollbackで旧Baseline Strategyを現役Baseline Strategyに戻す。

自動停止条件:

```text
Daily Review recommendation = retire
AND
Daily Review confidence = high
```

停止はAdoption Gateを待たない。昇格は厳しく、停止は早く扱う。

Candidate Slotはtimeframeごとに最大3本にする。枠が埋まっている状態で新しいCandidate Strategyがschema/Risk Gate validationを通過した場合は、保留せず即投入し、既存Candidate Strategyから1本を自動停止して枠を空ける。

押し出し優先順位:

1. Daily Reviewで`confidence: high`の停止推薦があるもの。
2. Adoption Gateの最低条件から最も遠いもの。
3. validation windowを終えた最古のもの。

新Candidate Strategy投入前にCandidate Similarity Checkを行い、直近のactive、rejected、retired Candidate StrategyとStrategy Definitionの構造が近すぎる候補はrejectする。ただし、明確な改善理由と主要parameter差分がある場合は投入を許可する。

### DSL Validation

AI Proposalは以下を通過しなければCandidate Strategyに投入しない。

```text
validation:
  - JSON parse
  - schema validation
  - allowed indicator validation
  - parameter range validation
  - Risk Gate cannot be relaxed
  - timeframe must be 1m | 5m | 15m
  - symbol must be USD_JPY in initial implementation
  - max open positions cannot exceed 2
  - allow_reversal_entry must remain false in initial implementation
  - Candidate Strategy must not be structurally too similar to recent active/rejected/retired Candidate Strategies
```

Risk Gateの緩和、未許可indicator追加、TypeScriptコード生成、shell実行要求を含むAI Proposalはrejectする。

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

Paper Account Risk Gate
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

1mはspread負けしやすいため厳しめに扱う。15mは保有時間が長くなりやすいため、entry gate上はやや広めに許容する。Candidate Strategy採用ではnormalだけでなくstress条件でも大きく崩れないことを確認する。

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

paper execution、Strategy Run evaluation、Candidate Strategy evaluationでは、使用したspreadの値と取得元を保存する。

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

BID/ASK candleがない区間では、mid candleに保存済みspreadを加減してBID/ASK相当を推定する。spread_sourceが`default`の区間はCandidate Strategy採用判定で不利に扱う。

シグナル足のcloseで約定させる方式は、検証が楽観的になりやすいため採用しない。tick/orderbook由来の可変slippageや約定拒否は、より現実寄りのモデルが必要になった段階で将来拡張として扱う。

### Paper Account

初期のPaper Accountは、将来の実運用想定に合わせる。

```text
initial_balance_jpy: 20,000
leverage: 25x
currency: JPY
```

Baseline StrategyとCandidate Strategyはすべて同じ初期資金、同じレバレッジ条件で独立したPaper Accountとして動かす。これにより、timeframeやCandidate Strategy間で、取引回数、手数料・スプレッド込み損益、最大ドローダウン、証拠金維持余力を公平に比較する。

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

固定数量はUSD/JPYの1,000通貨を初期値にする。固定数量でもRisk Gateは必ず通す。固定数量が証拠金余力、最大損失、スプレッド悪化耐性を満たさない場合はentryしない。

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

同時保有ポジションは、各Paper Accountごとに最大1までにする。積み増しと両建ては初期実装では禁止し、証拠金使用率50%のRisk Gateを必ず通す。

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

Candidate Strategyはtimeframeごとに最大3個、合計9個まで。Baseline Strategy昇格は同じtimeframe内で、Adoption GateとDaily Review `confidence: high`のANDにより自動適用する。

Candidate Strategy lifecycle:

```text
proposed
  -> validated
  -> running_paper
  -> promoted_to_baseline
  -> retired
```

候補入れ替え:

- emergency reject条件に触れたら即停止する。
- 枠が満杯の場合、新Candidateを保留せず、停止推薦があるもの、Adoption Gateの最低条件から最も遠いもの、validation windowを終えた最古のものの順で入れ替える。
