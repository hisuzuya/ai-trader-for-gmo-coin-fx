# Roadmap

## 次に実装すること

おすすめの初期実装順:

```text
1. `apps/web`、`apps/worker`、`apps/ai-runner`、`packages/db`、`packages/domain`のpnpm workspace骨格を作る。
2. Next.js + tRPC + Drizzle + TimescaleDBの最小構成を作る。
3. docker-compose.local.ymlでnext-web / worker / ai-runner / timescaledbを起動する。
4. Drizzle schemaとTimescaleDB migrationを`packages/db`に作る。
5. GMO public REST clientを`packages/domain`に作り、/status /ticker /symbols /klinesを取得する。
6. historical importerでUSD_JPY 1min BID/ASK KLineをbackfillする。
7. WebSocket collectorでUSD_JPY tickerを購読する。
8. 1m candle builderと5m/15m aggregatorを実装する。
9. paper execution modelを実装する。entryは次足open、SL/TP/trailingは1m intrabar判定で実装する。
10. strategy DSLとbaseline strategyを実装する。
11. ai-runnerのClaudeCliProviderとworker側AiProvider clientを実装する。
12. hourly tuningとcandidate並走を実装する。
13. dashboardでsystem status / paper accounts / strategy comparison / daily reviewを表示する。
```

初期実装ではlive trading、GMO Private API、実注文、保護注文、live用secret/env、live用dashboard操作は実装しない。

## MVP Phases

### Phase 0: Scaffold

```text
goal:
  - pnpm workspace、Next.js / tRPC / Drizzle / TimescaleDB / Docker Composeの骨格を作る

done:
  - docker composeでnext-web / worker / ai-runner / timescaledbが起動する
  - migrationが適用できる
  - dashboardにSystem Statusの空表示が出る
  - import boundary checkで`packages/domain`がDB/env/server/appに依存していないことを確認できる
  - `apps/web`、`apps/worker`、`apps/ai-runner`が互いを直接importしていないことを確認できる
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
  - ai-runnerのClaudeCliProviderがJSON proposalを返す
  - workerがai-runnerを内部API越しに呼べる
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
