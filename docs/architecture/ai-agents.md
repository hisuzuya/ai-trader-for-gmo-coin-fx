# AI Agents

## 目的と背景

既存設計では、AIはhourly tunerとdaily reviewerの2つのbatch jobとして関与する。tunerはJSON戦略候補を出し、workerがpaper traderで実行する。AIは「設計者」、workerは「執行者」という分担になっている。

この設計では、AIを**継続的に存在するtrading agent**として導入する。agentはsystem promptとskill (tool) を持ち、必要なときに必要な指標を動的に取得し、自分の経験を長期記憶として保存しながら判断する。1つのagentが1つのpaper accountを担当し、UI上で人間がpersonaとsystem promptを編集できる。

最初は1体だけ動かす。動作確認後にN体に増やす拡張性を持たせる。

## Goals

- AI agentを第一級の概念としてdomain modelに追加する。
- agentは指標を動的に取得できる。固定の特徴量セットに縛られない。
- agentは長期記憶を持ち、過去の判断と結果を参照できる。
- agentのsystem promptとskill構成はweb UIから編集でき、バージョン履歴を残す。
- 1 agent = 1 paper account とする。
- 最初は1体だけ動かす。複数化はスキーマと runner で同時にできるよう確保する。

## Non-Goals

- live tradingへの自動反映。本ドキュメントでもpaper accountのみを対象にする。
- agentがコードを書く / shellを実行する権限を持つこと。toolは事前定義したMCP toolに限定する。
- 既存hourly tuner / daily reviewerの即時廃止。両者は併存し、agent側が安定してから廃止判断する。
- semantic memory search。Phase 1ではtag + full-text。pgvectorはPhase 2以降。

## 概念モデル

```text
AIAgent
  - id
  - name
  - persona (description)
  - systemPrompt
  - mcpServers          # 接続するMCPサーバー一覧
  - allowedTools        # MCP toolホワイトリスト
  - paperAccountId      # 1:1 で紐づくpaper account
  - status              # active | paused
  - currentVersion      # promptとskill構成のversion
  - tickIntervalSec     # agent loopの周期
```

agentは自分のpaper accountに対してのみ取引できる。他agentのaccountには触れない。

## 既存AI Tuner / Daily Reviewerとの関係

| 観点 | 既存 (tuner / daily reviewer) | 本設計 (AI agent) |
|---|---|---|
| 実行形態 | batch job (hourly / daily) | 常駐loop (`tickIntervalSec`ごと) |
| 役割 | 戦略候補のJSON生成 / 日次レビュー | trade判断 / 自己記憶 |
| AI provider | `apps/ai-runner` (Claude CLI) | `apps/ai-runner` 拡張 (Anthropic SDK + MCP client) |
| 出力 | JSON proposal / review | tool call (MCP) |
| 採用判定 | gate + score + DBへ書き込み | agentが直接 `mcp-trading` でorder発行 |
| risk gate | proposal validatorで適用 | `mcp-trading` 内で適用 |

既存tunerが生成するstrategy proposalは、Phase 2でagentの`save_memory`にfeedされる候補にする (`hypothesis` 型として記憶に投入)。

ADR [0001 Claude CLIはAI Runnerで隔離実行する](../adr/0001-run-claude-cli-in-ai-runner.md) の方針は維持する。Claude CLIに代わってAnthropic SDK経由でMCPクライアントを動かすが、`ai-runner` containerに隔離するという制約は変わらない。

## 全体アーキテクチャ

```text
Docker Compose on VM
  ├─ next-web
  │   ├─ /agents               (agent一覧 / 詳細 / 編集 / memory viewer)
  │   └─ tRPC routers
  │
  ├─ worker
  │   ├─ CollectorService
  │   ├─ PaperTraderService    (既存baseline用、agent担当口座は除外)
  │   ├─ AiTunerService        (既存、Phase 1では存続)
  │   ├─ AiDailyReviewerService(既存)
  │   └─ AiAgentSupervisor     (新規: 各agentのlifecycle管理)
  │
  ├─ ai-runner
  │   ├─ Hono internal API
  │   ├─ Claude CLI provider   (既存)
  │   └─ AiAgentRunner         (新規: MCP client + Anthropic SDK)
  │
  ├─ mcp-indicators            (新規: MCP server, 別process)
  ├─ mcp-memory                (新規: MCP server, 別process)
  ├─ mcp-trading               (新規: MCP server, 別process)
  │
  ├─ timescaledb
  └─ cloudflared
```

agentの実行系統:

```text
worker (AiAgentSupervisor)
  -> tick scheduler ──> ai-runner (AiAgentRunner)
                          -> mcp-indicators (read_bars, calc_indicator, ...)
                          -> mcp-memory     (recall_memory, save_memory, ...)
                          -> mcp-trading    (get_position, place_paper_order, close_position, ...)
```

worker と ai-runner の責務境界:

- workerは「いつ走らせるか」「結果をDBに何として保存するか」を決める。
- ai-runnerは「LLMをどう呼ぶか」「MCPをどう繋ぐか」を持つ。DB接続は持たない。
- MCPサーバーがDBにアクセスする。MCPサーバー単位で接続スコープを最小化する。

依存方向 (既存ルールに追加):

```text
apps/worker     -> apps/ai-runner          (internal HTTP)
apps/ai-runner  -> mcp-*                   (MCP protocol, stdio / HTTP)
mcp-trading     -> packages/db, packages/domain
mcp-indicators  -> packages/db, packages/domain
mcp-memory      -> packages/db
apps/web        -> packages/db             (agent CRUD用)
```

`apps/ai-runner -> packages/db` は引き続き禁止。MCP server経由でのみDB操作する。

## MCP サーバー仕様

3つのMCP serverを別processとして起動する。プロトコルは [@modelcontextprotocol/sdk](https://github.com/modelcontextprotocol) 準拠。Phase 1のtransportはstdioを基本とし、必要に応じてHTTPに切り替える。

### mcp-indicators

役割: market dataと指標を動的に取得する。

```text
list_available_indicators()
  -> { indicators: [ { name, params_schema, description } ] }

read_bars(timeframe, count, priceType?)
  - timeframe: '1m' | '5m' | '15m' (Phase 1)
  - count: 1..500
  - priceType: 'mid' (default) | 'bid' | 'ask'
  -> { bars: [ { opened_at, open, high, low, close } ] }

calc_indicator(name, timeframe, params, count)
  - name: 'rsi' | 'ema' | 'sma' | 'bb' | 'adx' | 'macd' | 'atr' | 'stoch' | 'vwap'
  - params: indicator固有
  - count: 直近N本ぶんを返す
  -> { values: [ { opened_at, value: ... } ] }

get_spread()
  -> { spread_pips, spread_source, sampled_at }

get_market_status()
  -> { is_open, last_tick_at, websocket_connected }
```

`calc_indicator`はDBに保存済みの`features.values` (feature_set_version = `fx-core-v1`) をまず参照し、なければon-demand計算してreturnする。on-demand計算結果はキャッシュに保存し、同じ`(timeframe, name, params, opened_at)`の再呼び出しを高速化する。

### mcp-memory

役割: agentごとの長期記憶。

```text
save_memory(agentId, type, content, tags?)
  - type: 'observation' | 'hypothesis' | 'trade_review' | 'rule_self_imposed'
  - content: string (最大8192文字)
  - tags: string[] (最大16個)
  -> { id, createdAt }

recall_memory(agentId, query, limit?, types?)
  - query: tag一致または全文検索 (PG tsvector)
  - limit: default 10, max 50
  - types: 型filter
  -> { memories: [ { id, type, content, tags, createdAt, score } ] }

list_memories(agentId, filter)
  - filter: { type?, tag?, from?, to? }
  -> { memories: [...], total }

forget_memory(id, agentId)
  - 自分のmemoryのみ削除可能
  -> { ok }
```

すべてのtool callで`agentId`を要求する。MCP server側で「呼び出し元のagentId」と引数の`agentId`が一致するかを検証し、他agentのmemoryへの干渉を遮断する。

agentIdの検証は、Phase 1ではMCP接続時のheader (`X-Agent-Id`) で受け取り、tool callの引数と突き合わせる。Phase 2で署名付きtokenに置き換える。

### mcp-trading

役割: paper trade実行と状態照会。

```text
get_position(agentId)
  -> { position: { side, size, entryPrice, openedAt } | null }

get_pnl(agentId, window)
  - window: 'today' | 'yesterday' | '7d'
  -> { realizedPnl, unrealizedPnl, tradeCount, winRate }

get_trade_history(agentId, limit?)
  -> { trades: [ { side, size, entryPrice, exitPrice, pnl, openedAt, closedAt } ] }

place_paper_order(agentId, side, size, sl?, tp?, reason)
  - side: 'BUY' | 'SELL'
  - size: integer (sizeStepに合わせる)
  - sl: optional, price
  - tp: optional, price
  - reason: string (decision logに残す)
  - 既存risk gateを通過する場合のみaccept
  -> { orderId, acceptedAt } または { rejected: true, reason }

close_position(agentId, reason)
  -> { tradeId, closedAt, pnl }

get_constraints(agentId)
  - sizeStep, minOpenOrderSize, maxOrderSize, max spread, daily loss cap, max drawdown
  -> { constraints: { ... } }
```

`place_paper_order`は既存の `packages/domain/risk/gates.ts` を必ず通す。agentの判断であっても risk gate を緩めない。

## データモデル

新規テーブルは `packages/db/src/schema/ai-agents.ts` に置く。既存schemaは変更しない。

```text
ai_agents
  id: uuid
  name: text
  persona: text
  system_prompt: text
  mcp_servers: jsonb         # ["indicators", "memory", "trading"]
  allowed_tools: jsonb       # ["calc_indicator", "place_paper_order", ...]
  paper_account_id: uuid     # FK paper_accounts.id, unique
  status: text               # 'active' | 'paused'
  current_version: integer
  tick_interval_sec: integer # default 60
  model: text                # 'claude-opus-4-7' など
  created_at: timestamptz
  updated_at: timestamptz
  unique(paper_account_id)

ai_agent_versions
  id: uuid
  agent_id: uuid             # FK ai_agents.id
  version: integer
  system_prompt: text
  mcp_servers: jsonb
  allowed_tools: jsonb
  note: text
  created_at: timestamptz
  unique(agent_id, version)

ai_agent_memories
  id: uuid
  agent_id: uuid             # FK ai_agents.id
  type: text                 # 'observation' | 'hypothesis' | 'trade_review' | 'rule_self_imposed'
  content: text
  tags: text[]
  search_vector: tsvector    # generated from content
  created_at: timestamptz
  index(agent_id)
  index(agent_id, type)
  gin_index(search_vector)
  gin_index(tags)

ai_agent_decision_logs
  id: uuid
  agent_id: uuid             # FK ai_agents.id
  agent_version: integer
  tick_started_at: timestamptz
  tick_finished_at: timestamptz
  status: text               # 'succeeded' | 'failed' | 'timeout'
  llm_input_summary: jsonb   # prompt hash, model, token usage
  llm_output_summary: jsonb  # tool calls, final message
  tool_calls: jsonb          # [{ name, args, result_summary, duration_ms }]
  error: text
  index(agent_id, tick_started_at desc)
```

`ai_agent_decision_logs.tool_calls` には実行された全tool callを残す。これはdebugとUI上の「判断履歴」表示に使う。生のprompt textはredact後に`llm_input_summary.prompt_redacted`に格納する。

既存 `paper_accounts` には変更を加えない。agentは `paper_account_id` で1:1にlink付けする。

## AI Agent Runner (apps/ai-runner)

`apps/ai-runner`を拡張し、AiAgentRunnerを追加する。既存のClaude CLI providerは残す。

```ts
interface AiAgentRunner {
  runTick(agentId: string): Promise<AgentTickResult>
}

type AgentTickResult = {
  status: 'succeeded' | 'failed' | 'timeout'
  toolCalls: ToolCallSummary[]
  llmOutputSummary: LlmOutputSummary
  error?: string
}
```

実行ステップ:

1. workerから`POST /internal/agent/tick { agentId, agentVersion }` で呼ばれる。
2. ai-runnerはDBアクセスを持たないため、agent定義は呼び出し元 (worker) から渡される。
3. ai-runnerは Anthropic SDK の messages API を `tools` 配列付きで呼び、tool use loopを回す。
4. 各MCP serverへstdio接続し、tools listをmerge。
5. system promptには`agent.systemPrompt + 補助ガイダンス` (時刻、symbol、constraint要約) を含める。
6. LLMがtool useを返したら、対応MCPに転送、結果をLLMへfeedback。
7. `stop_reason = end_turn` でloop終了、または `maxToolHops` (default 12) で打ち切り。
8. tool callsとllm output summaryをworkerへ返す。

worker側 (AiAgentSupervisor) の責務:

- DBから`active`なagentを取得。
- 各agentについて、`tickIntervalSec`ごとに `runTick` を呼ぶ。
- 結果を`ai_agent_decision_logs`に保存。
- 連続failure閾値を超えたagentを自動的に`paused`へ移す (Phase 2)。

timeoutとretry:

```text
tick timeout: 90s
tool call timeout: 20s
maxToolHops: 12
retry: tickごとには行わない。次のtickで自然に再試行される。
```

prompt redaction:

- API key、DB URL、GMO secret、agentId以外のID類はpromptに含めない。
- agentの`systemPrompt`にユーザーがsecretを書き込んだ場合は、save時にweb UIで警告する (regex検出)。Phase 1ではbest-effort。

## Web UI

`/agents` 配下に新画面を追加する。既存dashboardからリンクする。

```text
/agents
  - agentカード一覧
  - 各カード: name, persona, status, 今日のPnL, win rate, 最終tickの状態, 最終tick時刻

/agents/[id]
  - overview tab: 状態, paperAccount summary, 直近trade
  - prompt tab: systemPrompt編集, mcpServers / allowedTools 選択
  - memories tab: 一覧 / 検索 / 個別削除
  - decisions tab: 直近tickの判断履歴 (tool callの中身を展開可能)
  - versions tab: バージョン履歴 / 差分表示 / rollback

/agents/[id]/edit
  - prompt保存時に新versionを作成
  - rollback時にも新versionを作成 (履歴を消さない)
```

`/agents/[id]/decisions` の表示要素:

```text
- tick_started_at / 状態
- LLMが呼んだtool一覧 (展開で引数と結果summary)
- LLMの最終messageテキスト
- token usage
```

memories tabからUIで`save_memory`を手動投入できるようにする (debug用)。

## シードする最初の1体

```text
name: "エージェント01"
persona: "(自由設計)"
systemPrompt:
  あなたは USD/JPY のペーパートレーダーです。
  現在は paper trading 検証段階で、live取引は禁止です。
  毎tickの最初に `recall_memory` で過去の自分の学びを思い出してください。
  必要に応じて `list_available_indicators` で使える指標を確認し、
  `calc_indicator` と `read_bars` でmarketを観察してください。
  取引判断は `place_paper_order`、決済は `close_position` を使ってください。
  気づき、仮説、自分への約束は `save_memory` で残してください。
  最初のtickで、自分のpersona (慎重派 / 積極派 / スキャルパー / スイング など) を選び、
  その方針を `save_memory(type='rule_self_imposed')` として記録してください。
mcpServers: ["indicators", "memory", "trading"]
allowedTools: 全tool
tickIntervalSec: 60
paperAccount: 新規作成 (残高 20,000 JPY)
model: "claude-opus-4-7"
status: "active"
```

## 既存6口座の扱い

```text
baseline_1m
baseline_5m
baseline_15m
usdjpy_1m_safer_sidewa...
usdjpy_1m_conservative_...
cand_usdjpy_1m_tighter_...
```

マイグレーション (`packages/db/src/migrations/NNNN_stop_legacy_paper_accounts.sql`) で、上記6口座の `paper_accounts.status` を `stopped` に更新する。trade履歴、position履歴は保持する。

PaperTraderServiceは`status = 'active'`のpaper accountだけを評価対象にする。agent担当のpaper accountはagent側で扱うため、PaperTraderServiceの対象から外す (`paper_accounts.controlled_by` 列で識別する。新規列、default `'paper_trader'`、agent管理は `'ai_agent'`)。

UI上は、既存6口座を `stopped` セクションに隠さず表示する。比較や履歴閲覧で残す。

## セキュリティ / ガードレール

- agentは自分の `paperAccountId` 以外のaccountを操作できない。MCP server側で強制。
- `place_paper_order` は既存 `packages/domain/risk/gates.ts` を通る。agent側で緩和不可。
- `mcp-trading` は `liveTradingEnabled = false` の間、live order pathにアクセスしない。
- `ai-runner` はDB credentialを持たない。MCP server経由でのみDB操作する。
- agentが投入する `save_memory.content` はそのままUI表示される。XSSは保存時にplain textとして扱う (HTML/markdownはrenderしない) ことで防ぐ。
- agent system promptはredaction regexでsecret-likeな文字列 (sk-, ghp_, AKIA など) を検出し、保存時に警告する。
- 1 tickあたりのtool hopsは `maxToolHops` で抑制。1日あたりのLLM呼び出し回数とtoken usageを `ai_agent_decision_logs` で集計し、上限超過で `paused` に移す閾値はPhase 2で設定する。

## 実装フェーズ

```text
Phase 1 (本ドキュメントの対象)
  - DB schema追加 + migration
  - mcp-trading, mcp-indicators, mcp-memory の実装
  - AiAgentRunner (ai-runner) の実装
  - AiAgentSupervisor (worker) の実装
  - web UI: /agents 一覧 / 詳細 / 編集 / memories / decisions / versions
  - 既存6口座のstopped化
  - シード1体の投入

Phase 2
  - 自己レビュー: hourlyに agentが自分の決定ログとPnLを読み、systemPromptの改善提案を出す
    - 提案はDBに保存され、ユーザー承認で新versionとして反映
  - 連続failureでの自動pause
  - token usageと費用の集計UI
  - mcp-memory に pgvector semantic search を追加

Phase 3
  - 2体目以降を投入
  - agent間の議論プロトコル (mcp-memory に共有棚を追加するオプション)
  - 1h timeframeの追加 (data側で先行対応が必要)
  - liveへの限定的橋渡し (人間承認ゲート付き)
```

## オープン問題

- **tick周期 vs 取引機会**: 60秒tickは1m足には合うが、5m / 15m判断には冗長。 agentに「次は何秒後に再思考すべきか」を返させる方式 (agent自身がidleを宣言) を Phase 2 で検討。
- **複数agentが同じ市場を見ることのコスト**: tick数 × agent数 × 1日 × LLM料金。Phase 1は1体なので問題ないが、N体時にbatch化または条件起動 (price moveが閾値超えたときだけtick) を検討。
- **MCP serverのprocess管理**: Docker Composeで別serviceにするか、ai-runner内でchild processとして起動するか。後者は依存が単純だが、serviceとして分離した方が再起動とlog分離がしやすい。Phase 1は ai-runner からchild processで起動し、Phase 2で別serviceに切り出すことを検討。
- **agentが`recall_memory`を毎tick呼ぶオーバーヘッド**: Phase 1は許容。Phase 2で「直近tickのmemory snapshot」をsystemPromptに自動埋め込む方式に変えるかもしれない。
- **既存hourly tuner / daily reviewerの去就**: agent運用が安定したら、tunerは「memory棚へのhypothesis投入器」、daily reviewerは「全agentのcross review」に役割変更することを検討。

## 関連ドキュメント

- [System Architecture](./system.md)
- [Trading Design](./trading.md)
- [AI Tuning (既存)](./ai-tuning.md)
- [Data Architecture](./data.md)
- [ADR 0001: Claude CLIはAI Runnerで隔離実行する](../adr/0001-run-claude-cli-in-ai-runner.md)
- ADR 0003: AI agentをMCPベースで導入する (本設計に紐づくADR、別途追加)
