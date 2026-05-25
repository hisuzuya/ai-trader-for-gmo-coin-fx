# AI Agents

## 目的と背景

既存のAI関与は、hourly tunerがStrategy Definition候補を生成し、daily reviewerがpaper trading成績をレビューするbatch jobとして設計されている。この設計は安全境界が明確で、AIは直接paper accountやorderを変更しない。

今後のAI agentは、この安全境界を維持したまま、継続的に市場、候補戦略、過去の失敗理由を観察し、Strategy Definitionの改善仮説と候補レビューを蓄積する **Research + Evaluation Agent** として導入する。

agentは取引執行者ではない。paper order、position close、baseline昇格、candidate停止は、deterministicなworker/domain pipelineだけが実行する。

## Goals

- AI agentを第一級のresearch entityとしてdomain modelに追加する。
- agentはpersona、system prompt、tool allowlist、memoryを持つ。
- agentは市場データ、指標、候補成績、reject履歴、memoryをread-only toolで参照できる。
- agentはStrategy Definition候補、候補レビュー、観察、memory write intentを構造化出力する。
- 出力は用途別のlifecycleに分解し、host側でschema validation、risk validation、永続化、paper投入を行う。
- agentのsystem promptとtool構成はweb UIから編集でき、version履歴を残す。
- 最初は1体だけ動かすが、schemaとrunnerはN体対応にする。

## Non-Goals

- live tradingへの自動反映。
- agentがpaper orderやpositionを直接変更すること。
- agentがDB、filesystem、shell、GMO Private API secretへ直接アクセスすること。
- agentがrisk gateを緩和すること。
- 既存Strategy DSLを外れた任意コード生成や実行。
- semantic memory search。Phase 1ではtag + full-textに限定する。

## Core Decision

Phase 1のagentは **Research + Evaluation Agent** とする。

```text
AgentScheduler
  -> AgentContextBuilder
      -> deterministic summary
      -> read-only tool allowlist
  -> AiAgentRunner
      -> LLM tool loop
      -> AgentRunOutput
  -> AgentOutputProcessor
      -> validate observations
      -> validate strategy proposals
      -> validate candidate reviews
      -> validate memory writes
  -> StrategyEvaluationPipeline
      -> proposal validation
      -> candidate paper account
      -> paper evaluation
      -> deterministic promote / retire gate
```

agentが行うこと:

- 市場状態と候補成績を観察する。
- 過去のrejection、candidate review、memoryを参照する。
- 新しいStrategy Definition候補を提案する。
- 評価中candidateの継続、停止、昇格に関する推薦を出す。
- 自分の仮説、失敗学習、提案レビューをmemory write intentとして出す。

agentが行わないこと:

- `place_paper_order`や`close_position`を呼ぶ。
- paper accountのbalance、position、order、tradeを直接更新する。
- baseline昇格やcandidate停止を直接適用する。
- DBへ直接writeする。

## Concept Model

```text
AIAgent
  - id
  - name
  - persona
  - systemPrompt
  - allowedTools
  - status              # active | paused
  - currentVersion
  - runIntervalSec
  - model
  - maxConsecutiveFailures
  - consecutiveFailures
  - tokenBudgetPerRun
  - costBudgetPerRunUsd
  - sharedMemoryEnabled
```

agentはpaper accountを直接所有しない。agentが提案したStrategy Definitionがvalidationを通過した場合、StrategyEvaluationPipelineがcandidate Strategy RunとPaper Accountを作る。

提案と評価の対応は `agent_strategy_proposals.agent_id`、`strategy_runs.source_agent_id`、`strategy_runs.source_proposal_id` で追跡する。

## Output Lifecycle

LLM呼び出しは1回でもよいが、出力は用途別に分解して扱う。

```ts
type AgentRunOutput = {
  observations: AgentObservation[]
  strategyProposals: StrategyProposal[]
  candidateReviews: CandidateReview[]
  memoryWrites: AgentMemoryWrite[]
}
```

### AgentObservation

市場、候補成績、運用上の注意を要約する。UIの判断履歴と次回context buildingに使う。

```ts
type AgentObservation = {
  kind: "market" | "candidate_performance" | "risk" | "operations"
  summary: string
  evidence: string[]
  tags: string[]
}
```

### StrategyProposal

既存のStrategy DSLに準拠した候補。必ず `validateAiStrategyProposal` とStrategyEvaluationPipelineを通す。

```ts
type StrategyProposal = {
  rationale: string
  strategy: StrategyDefinition
  expectedEdge: string
  risks: string[]
  memoryRefs: string[]
}
```

### CandidateReview

評価中candidateの継続、停止、昇格に関する推薦。推薦はそのまま適用しない。deterministic gateが最終判断する。

```ts
type CandidateReview = {
  strategyName: string
  recommendation: "continue" | "retire" | "promote"
  confidence: "low" | "medium" | "high"
  reason: string
  evidence: string[]
}
```

### AgentMemoryWrite

agentが保存したい学習内容。toolとして直接保存させず、host側がvalidationして保存する。

```ts
type AgentMemoryWrite = {
  type: "market_observation" | "strategy_hypothesis" | "proposal_review" | "rejection_learning"
  content: string
  tags: string[]
  sourceRefs: string[]
}
```

## Observation Input

agent入力は **deterministic summary + read-only tool access** にする。

AgentContextBuilderは、LLM呼び出し前に以下を要約する。

- 現在のbaseline/candidate一覧。
- 評価中candidateの直近PnL、trade count、drawdown、status。
- 直近のAI proposal rejection理由。
- 直近のDaily Review summary。
- market status、最新candle時刻、spread状態。
- memory recallの初期結果。

agentは必要な場合だけread-only toolを呼ぶ。

Phase 1のtool allowlist:

```text
read_bars(symbol, timeframe, count, priceType)
calc_indicator(symbol, timeframe, indicator, params, count)
get_candidate_performance(strategyName)
get_rejection_history(strategyName?, limit)
recall_memory(agentId, query, types, limit)
```

write toolは持たせない。`save_memory` は存在させず、`memoryWrites` をAgentOutputProcessorが検証して保存する。

## Tool Runtime

`apps/ai-runner` はLLM実行とtool loopだけを担当する。DB接続、repository、paper account更新、risk decisionは持たない。

read-only toolsはMCP互換のtool serverとして分離する。

```text
apps/ai-runner
  -> mcp-market-data-read
  -> mcp-candidate-read
  -> mcp-memory-read
```

MCP serverはDB readだけを許可する。writeが必要な処理は、workerのAgentOutputProcessorがDB repository経由で行う。

Phase 1では、process数を抑えるためにread-only MCP serverを1つの `mcp-agent-research` serviceとして実装してもよい。ただしtool権限はread-onlyに固定する。

## Strategy Evaluation Pipeline

agentが出したStrategyProposalは、以下の順に処理する。

```text
JSON parse
  -> agent output schema validation
  -> validateAiStrategyProposal
  -> forbidden capability scan
  -> risk gate cannot be relaxed
  -> candidate Strategy Run作成
  -> candidate Paper Account作成
  -> PaperTraderServiceで評価
  -> deterministic promotion / retirement gate
```

CandidateReviewはdeterministic gateの入力にできるが、単独では適用しない。

昇格または停止の初期条件:

- `confidence: high`
- net profit after costがpositive。
- trade countがtimeframe別minimum以上。
- max drawdownが閾値以下。
- spread/slippage stressで極端に崩れない。
- baselineより一定以上改善している。

これらを満たさない推薦はUIには表示するが、自動適用しない。

## Existing AI Tuner / Daily Reviewer

最適設計では、既存hourly tunerとdaily reviewerは長期的にAgent Pipelineへ吸収する。

Phase 1:

- 既存tuner / daily reviewerは残す。
- 新しいAgent Pipelineは別serviceとして導入する。
- agent proposalも既存と同じStrategy DSL validationを通す。

Phase 2:

- hourly tunerのmanual jobはResearch Agent pipelineを優先実行する。旧 `AiTunerService` はfallback serviceとして残す。
- daily reviewerのmanual jobはactive agentを横断実行し、CandidateReview数とpromotion/retirement推薦数を集計する。旧 `AiDailyReviewerService` はfallback serviceとして残す。
- agent runにはtoken/cost budget、consecutive failure tracking、auto-pauseを持たせる。
- memory recallはagent memoryと `shared_memory` tag付きmemory shelfを対象にし、PostgreSQL full-text + fallback substring searchを使う。
- 既存 `ai_invocations` は後方互換のため維持し、agent run logを主ログとして扱う。

Phase 3:

- seedは複数agentを作成する。初期構成は `Research Agent 01` と `Research Agent 1H`。
- agent一覧はproposal/runの成功・失敗件数を返し、比較UIの最小入力にする。
- `Research Agent 1H` はcontext buildingで1h candleを使う。
- shared memory shelfは `shared_memory` tagで表現する。Phase 3では独立tableを追加しない。
- live tradingへの反映は実装しない。live trading向けには人間承認ゲートを別設計し、agent outputは直接live order pathへ接続しない。

## Data Model

新規schemaは `packages/db/src/schema/ai-agents.ts` に置く。

```text
ai_agents
  id: uuid
  name: text
  persona: text
  system_prompt: text
  allowed_tools: jsonb
  status: text               # active | paused
  current_version: integer
  run_interval_sec: integer
  model: text
  created_at: timestamptz
  updated_at: timestamptz

ai_agent_versions
  id: uuid
  agent_id: uuid
  version: integer
  system_prompt: text
  allowed_tools: jsonb
  note: text
  created_at: timestamptz
  unique(agent_id, version)

ai_agent_runs
  id: uuid
  agent_id: uuid
  agent_version: integer
  started_at: timestamptz
  finished_at: timestamptz
  status: text               # succeeded | failed | timeout | rejected_output
  input_summary: jsonb
  output_summary: jsonb
  tool_calls: jsonb
  token_usage: jsonb
  error: text
  index(agent_id, started_at desc)

ai_agent_memories
  id: uuid
  agent_id: uuid
  type: text
  content: text
  tags: text[]
  source_refs: jsonb
  search_vector: tsvector
  created_at: timestamptz
  index(agent_id)
  index(agent_id, type)
  gin_index(tags)
  gin_index(search_vector)

ai_agent_observations
  id: uuid
  run_id: uuid
  agent_id: uuid
  kind: text
  summary: text
  evidence: jsonb
  tags: text[]
  created_at: timestamptz

ai_agent_strategy_proposals
  id: uuid
  run_id: uuid
  agent_id: uuid
  strategy_name: text
  proposal_json: jsonb
  validation_status: text
  rejection_reasons: jsonb
  inserted_strategy_run_id: uuid nullable
  created_at: timestamptz

ai_agent_candidate_reviews
  id: uuid
  run_id: uuid
  agent_id: uuid
  strategy_name: text
  recommendation: text       # continue | retire | promote
  confidence: text
  reason: text
  evidence: jsonb
  applied: boolean default false
  created_at: timestamptz
```

既存 `paper_accounts` はagentに直接紐づけない。candidateのpaper accountはStrategyEvaluationPipelineが作成し、source proposalを辿れるようにする。

## Web UI

`/agents` 配下にResearch Agent UIを追加する。

```text
/agents
  - agent一覧
  - name, persona, status, model, latest run, proposal count

/agents/[id]
  - overview: latest observations, proposals, candidate review summary
  - prompt: systemPrompt編集、tool allowlist編集
  - memories: 検索、一覧、削除
  - proposals: validation結果、paper投入状況、関連Strategy Run
  - reviews: continue / retire / promote推薦とdeterministic gate結果
  - runs: tool calls、token usage、output validation結果
  - versions: prompt/tool構成の履歴とrollback
```

system prompt保存時は必ず新versionを作る。rollbackも履歴を消さず、新versionとして保存する。

## Seed Agent

Phase 1では1体だけseedする。

```text
name: "Research Agent 01"
persona: "USD/JPY paper strategy researcher"
systemPrompt:
  あなたはUSD/JPYのpaper trading戦略を研究するAI agentです。
  あなたは注文、決済、baseline昇格、candidate停止を直接実行してはいけません。
  あなたの役割は、市場状態、候補成績、過去の失敗理由、自分のmemoryを観察し、
  Strategy Definition候補、Candidate Review、Observation、Memory WriteをJSONで出力することです。
  Strategy Definitionは許可済みDSLだけを使い、risk gateを緩和してはいけません。
allowedTools:
  - read_bars
  - calc_indicator
  - get_candidate_performance
  - get_rejection_history
  - recall_memory
runIntervalSec: 3600
model: configurable
status: active
```

## Security / Guardrails

- agentはwrite toolを持たない。
- agent outputは用途別schemaでvalidationする。
- StrategyProposalは既存Strategy DSL validatorとrisk validatorを通す。
- CandidateReviewは推薦として保存し、deterministic gateなしに適用しない。
- `apps/ai-runner` はDB credential、repository write mount、GMO Private API secretを持たない。
- read-only MCP serverにはwrite SQL、mutation repository、paper execution APIを置かない。
- prompt、tool args、tool resultはredactしてrun logへ保存する。
- system prompt保存時はsecret-like文字列を検出し、UIで警告する。
- output size、tool hop、timeout、token budgetをagent単位で制限する。

## Implementation Phases

```text
Phase 1
  - ai_agents / versions / runs / memories / observations / proposals / reviews schema追加
  - read-only research tools実装
  - AiAgentRunner実装
  - AgentScheduler / AgentContextBuilder / AgentOutputProcessor実装
  - StrategyEvaluationPipelineにagent source proposalを接続
  - /agents UI追加
  - seed agent 1体投入

Phase 2
  - existing hourly tunerをAgent Pipelineへ統合
  - daily reviewerをcandidate review / cross-agent reviewへ統合
  - token usage / cost budget UI
  - consecutive failure auto-pause
  - memory full-text search改善

Phase 3
  - 複数agent
  - agent間比較
  - shared memory shelfの検討
  - 1h timeframe
  - live trading向け人間承認ゲートの別設計
```

## Relation To PR #37

PR #37の「AI agentを第一級概念にする」「system promptとtool構成をversion管理する」「read-only indicator / memory toolを使う」方向は採用する。

一方で、以下はPhase 1から外す。

- `mcp-trading.place_paper_order`
- `mcp-trading.close_position`
- 1 agent = 1 paper account
- agentが直接paper取引を行う常駐trader model

agentはtraderではなく、Strategy DSL候補と候補レビューを改善し続けるresearch entityとして扱う。

## 関連ドキュメント

- [System Architecture](./system.md)
- [Trading Design](./trading.md)
- [AI Tuning](./ai-tuning.md)
- [Data Architecture](./data.md)
- [Agent Personas (キャラクター仕様)](../personas/README.md)
- [ADR 0001: Claude CLIはAI Runnerで隔離実行する](../adr/0001-run-claude-cli-in-ai-runner.md)
- [ADR 0003: Research + Evaluation Agentを導入する](../adr/0003-introduce-research-evaluation-ai-agents.md)
