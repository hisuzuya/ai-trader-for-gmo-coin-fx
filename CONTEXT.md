# AI Trade

AI Tradeは、live tradingへ進む前にUSD/JPY FX戦略をpaper tradingで検証するためのシステム。このglossaryは、設計、issue、実装会話で使うドメイン用語を揃えるために存在する。

## Language

### Strategy Evaluation

**Baseline Strategy**:
timeframeごとに置く安定した比較基準の戦略。**Baseline Strategy** は自動変更せず、**Candidate Strategy** の評価基準として使う。
_Avoid_: default strategy, production strategy, control strategy

**Candidate Strategy**:
paper tradingで評価中の提案戦略。validation通過後にpaper評価へ自動投入できるが、人間承認なしに **Baseline Strategy** へ昇格しない。
_Avoid_: experiment, variant, AI strategy

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

**AI Runner**:
Claude CLIを隔離実行し、proposalまたはreview JSONだけを返すruntime。DB write、candidate adoption、paper account更新、risk decisionは持たない。
_Avoid_: AI worker, Claude worker

**Daily Review**:
直近paper trading成績、warning、candidate recommendationをまとめる構造化review。人間レビューを補助するもので、単独ではbaselineを変更しない。
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

Domain expert: "いいえ。validation後にCandidate StrategyとしてPaper Accountで走らせます。Baseline Strategyへの昇格には人間承認が必要です。"

Developer: "Strategy Runはどの価格を読みますか?"

Domain expert: "signalとFeature SetはMID Candleを読みます。Execution ModelはBID/ASK Candleを使い、欠損時だけspread調整したMID Candleを使います。"
