# AI Trade

AI Tradeは、live tradingへ進む前にUSD/JPY FX戦略をpaper tradingで検証するためのシステム。このglossaryは、設計、issue、実装会話で使うドメイン用語を揃えるために存在する。

## Language

## Pull Request Operations

PRのタイトル、本文、担当者は次のルールで統一する。

- PR titleは英語と日本語を併記し、`English title / 日本語タイトル` の形式にする。
- PR titleに`[codex]` prefixを付けない。
- PR bodyは日本語で書く。見出しは原則として `## 概要` と `## 検証` を使い、必要に応じて `## 補足`、`## スコープ`、`## 注意` を追加する。
- PRには必ずassigneeを設定する。個人作業では原則としてPR author本人をassignする。
- 既存PRのタイトル、本文、assigneeがこのルールから外れている場合は、見つけた時点で修正する。

### Strategy Evaluation

**Baseline Strategy**:
timeframeごとに1つだけ存在する現役の基準戦略。**Baseline Strategy** は固定されたcontrolではなく、**Candidate Strategy** がvalidation、paper評価、adoption gateを通過し、**Daily Review** が `confidence: high` で推奨した場合に自動昇格によって継続的に更新される。新しい **Baseline Strategy** が昇格した場合、同じtimeframeの旧 **Baseline Strategy** は履歴として残す。
_Avoid_: fixed baseline, default strategy, production strategy, control strategy

**Candidate Strategy**:
paper tradingで評価中の提案戦略。validation通過後にpaper評価へ自動投入され、同じtimeframeの **Baseline Strategy** と比較する。自動昇格 (auto-promotion) は、**Adoption Gate** を通過し、かつ **Daily Review** が `confidence: high` で昇格を推奨した場合にだけ行う。自動停止 (auto-retirement) は **Adoption Gate** を待たず、**Daily Review** が `confidence: high` で停止を推奨した場合に行う。`confidence: medium / low` の推奨は自動適用せず、運用確認対象として扱う。
_Avoid_: experiment, variant, AI strategy

**Candidate Slot**:
同じtimeframeで同時に評価できる **Candidate Strategy** の枠。初期上限はtimeframeごとに3本とする。枠が埋まっている状態で新しい **Candidate Strategy** がschema/risk validationを通過した場合は、保留せず即投入し、既存 **Candidate Strategy** から1本を自動停止して枠を空ける。押し出す候補は、停止推薦があるもの、**Adoption Gate** の最低条件から最も遠いもの、validation windowを終えた最古のものの順で選ぶ。
_Avoid_: queue, experiment slot, paper slot

**Candidate Similarity Check**:
新しい **Candidate Strategy** を投入する前に、直近のactive、rejected、retired candidateとStrategy Definitionの構造を比較する重複防止。indicator構成、entry/exit条件、risk設定、主要parameter差分が小さい場合は類似candidateとしてrejectする。ただし、明確な改善理由と主要parameter差分がある場合は投入を許可する。
_Avoid_: semantic memory search, duplicate filter, prompt dedupe

**Adoption Gate**:
**Candidate Strategy** を **Baseline Strategy** へ自動昇格してよいかを数値とルールだけで判定するdeterministic gate。net profit after costが同じtimeframeの現 **Baseline Strategy** を5%以上上回ること、最低取引回数(1mは20件、5mは12件、15mは6件)、max drawdownが現 **Baseline Strategy** 以下かつ15%以下であること、spread/slippage stress、train/validation差、risk gate緩和の有無、timeframe一致を確認する。**Adoption Gate** 単独では自動昇格しない。
_Avoid_: AI review, recommendation, manual approval

**Risk Gate**:
自動更新ループの安全枠。AI Agentは **Risk Gate** を緩和できない。max drawdown上限、max open positions、spread上限、slippage stress条件、reversal entry禁止などを緩めたい場合は、AI Proposalではなく別の設計変更として扱う。AI Agentは **Risk Gate** を維持するか、より厳しくする提案だけを出せる。
_Avoid_: tunable risk, adaptive risk, AI risk setting

**Shadow Baseline Run**:
新しい **Baseline Strategy** が昇格した後に、同じtimeframeの旧 **Baseline Strategy** をregression detection用に継続評価する期間限定の **Strategy Run**。保持期間はtimeframe別のvalidation window 1回分とする。
_Avoid_: second baseline, active baseline, fallback baseline

**Baseline Rollback**:
**Shadow Baseline Run** が新しい **Baseline Strategy** より明確に良い成績を出した場合に、旧 **Baseline Strategy** を同じtimeframeの現役 **Baseline Strategy** へ自動復帰させること。**Baseline Rollback** はrisk gateを緩和せず、Candidate生成も行わない。
_Avoid_: manual revert, emergency switch, fallback activation

**Strategy Definition**:
indicator、gate、entry、exit、riskを表す宣言的なStrategy DSL。実行可能なTypeScriptコードではない。
_Avoid_: strategy code, bot code, script

**Strategy Run**:
特定の **Strategy Definition** を、特定の **Paper Account**、symbol、timeframe、Feature Set、Execution Modelで評価した1回の実行。
_Avoid_: backtest, session, job

**Feature Set**:
戦略評価で使う派生market valueの名前付きversion。再現性のため、candle price typeとinput source versionに紐づく。
_Avoid_: indicators, metrics, model input

### Paper Trading

**Paper Account**:
balance、positions、orders、trades、risk stateを持つシミュレーション口座。公平に比較するため、各 **Baseline Strategy** と **Candidate Strategy** は独立した **Paper Account** を持つ。
_Avoid_: account, wallet, portfolio

**Paper Order**:
paper execution modelが生成するシミュレーション上のorder intentとexecution result。price source、spread、slippage、execution reasonを記録する。
_Avoid_: order, fake order

**Paper Trade**:
**Paper Account** のbalanceとperformance metricsへ反映される完了済みのシミュレーション取引。paper ordersとposition lifecycleから導出される。
_Avoid_: transaction, fill

**Execution Model**:
strategy signalをsimulated fillへ変換するルール。初期 **Execution Model** はsignal entryを次足openで扱い、SL、TP、trailing stop、emergency exitは1m intrabarで保守的に判定する。
_Avoid_: fill logic, simulator

### Market Data

**Canonical Candle**:
共通candle schemaに保存される正規化済みcandle。`price_type`でBID、ASK、MIDを分けて保存する。
_Avoid_: kline, bar

**MID Candle**:
対応するBID candleとASK candleから導出するcandle。strategy signalとfeature generationのcanonical inputとして使う。
_Avoid_: average candle, signal candle

**BID/ASK Candle**:
bid側またはask側のpriceを表すcandle。**Execution Model** はBID/ASK candle、またはspread調整したMID candleを使って現実寄りのentry/exit priceを再現する。
_Avoid_: raw candle

### AI Tuning

**AI Proposal**:
AI Runnerが生成する構造化JSONの提案。**AI Proposal** はcandidate inputにすぎず、schema、range、risk、adoption gateを通過して初めてpaper評価へ進む。
_Avoid_: AI code, suggestion, prompt result

**Agent Proposal Cadence**:
AI Agentが **AI Proposal** を生成してよいtimeframe別の最短間隔。初期値は1mが1時間ごと、5mが3時間ごと、15mが12時間ごととする。長いtimeframeほど未成熟な **Candidate Strategy** の押し出しを避けるため、提案間隔を長くする。
_Avoid_: schedule, cron, tuning interval

**Agent Exploration Mix**:
AI Agentの提案配分。初期値は70%を現 **Baseline Strategy** または有望な **Candidate Strategy** のparameter refinement、30%をentry、exit、regime構造を変えるexplorationとする。自動更新の安定性を優先しつつ、局所最適に閉じないために構造違いの探索を残す。
_Avoid_: random exploration, full rewrite, parameter-only tuning

**AI Runner**:
Claude CLIを隔離実行し、proposalまたはreview JSONだけを返すruntime。DB write、candidate adoption、paper account更新、risk decisionは持たない。
_Avoid_: AI worker, Claude worker

**Daily Review**:
直近paper trading成績、warning、candidate recommendationをまとめる構造化review。`status: accepted` の review に含まれる `confidence: high` の `baseline_promotion_candidates` は、対象 **Candidate Strategy** が **Adoption Gate** も通過している場合にだけ **Baseline Strategy** へ自動昇格する。`confidence: high` の `candidate_retirement_candidates` は自動停止する。`confidence: medium / low` および `status: rejected / failed` の review は適用しない。
_Avoid_: report, summary

## Flagged Ambiguities

**Account**:
シミュレーション上の取引状態は **Paper Account** と呼ぶ。将来のlive brokerage accountを扱う文脈でない限り、単にaccountとは呼ばない。

**Order**:
シミュレーション上の注文は **Paper Order** と呼ぶ。将来live orderを設計するときは、別の明確な用語を定義する。

**Strategy**:
役割を話すなら **Baseline Strategy** または **Candidate Strategy**、DSL内容を話すなら **Strategy Definition** を使う。

## Example Dialogue

Developer: "このAI ProposalをBaseline Strategyに置き換えてよいですか?"

Domain expert: "AI Proposalを直接Baselineにはしません。validation後にCandidate StrategyとしてPaper Accountで走らせ、Adoption Gateを通過し、Daily Reviewが`confidence: high`で昇格推奨した場合に auto-promotion を行います。`medium / low` 推奨や `rejected` review は適用されません。"

Developer: "Strategy Runはどの価格を読みますか?"

Domain expert: "signalとFeature SetはMID Candleを読みます。Execution ModelはBID/ASK Candleを使い、欠損時だけspread調整したMID Candleを使います。"
