# AI Tuning

## AI Tuning

Claude CLIは`ai-runner`コンテナ内で実行し、workerは内部API越しに`AiProvider` interfaceとして扱う。worker中核はClaude CLIに直接依存させない。

```ts
interface AiProvider {
  generateStrategyProposal(input: StrategyProposalInput): Promise<StrategyProposal>
  generateDailyReview(input: DailyReviewInput): Promise<DailyReview>
}
```

`ai-runner`の責務:

- child processで`claude -p`を実行する。
- 構造化JSON出力を要求する。
- timeoutを必ず設定する。
- stdout / stderrを保存する。
- JSON schema validationを行う。
- invalid outputはrejectする。
- provider healthをworkerの`/status`に表示できる形で返す。
- DB接続情報、GMO Private API secret、repository write mountを持たない。
- read-onlyのClaude config mountのみを受け取る。

workerの責務:

- `ai-runner`へproposal/review生成リクエストを送る。
- 戻り値を再度schema validationする。
- AI invocation summaryをDBへ保存する。
- candidate投入、採用判定、risk gate判定を行う。

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
