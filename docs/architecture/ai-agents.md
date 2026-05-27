# AI Agents

## 目的と背景

既存のAI関与は、hourly tunerがStrategy Definition候補を生成し、Daily ReviewがPaper Trading成績をレビューするbatch処理として設計されている。この設計は安全境界が明確で、AIは直接Paper AccountやPaper Orderを変更しない。

今後のAI Agentは、この安全境界を維持したまま、継続的に市場、Candidate Strategy、過去の失敗理由を観察し、Strategy Definitionの改善仮説とCandidate Reviewを蓄積する **Research + Evaluation Agent** として導入する。

AI Agentは取引執行者ではない。Paper Order、position close、Baseline Strategy昇格、Candidate Strategy停止は、worker/domain pipelineだけが実行する。Baseline Strategy昇格はAdoption GateとDaily Review `confidence: high`のANDで自動適用し、Candidate Strategy停止はDaily Review `confidence: high`で自動適用する。

## Goals

- AI Agentを第一級のresearch entityとしてdomain modelに追加する。
- AI Agentはpersona、system prompt、tool allowlist、memoryを持つ。
- AI Agentは市場データ、指標、Candidate Strategy成績、reject履歴、memory、skillsをread-only toolで参照できる。
- AI AgentはStrategy Definition候補、Candidate Review、Observation、memory write intent、skill write intentを構造化出力する。
- 出力は用途別のlifecycleに分解し、host側でschema validation、Risk Gate validation、永続化、Paper Trading投入を行う。
- AI Agentのsystem promptとtool構成はweb UIから編集でき、version履歴を残す。
- 最初は1体だけ動かすが、schemaとrunnerはN体対応にする。

## Non-Goals

- live tradingへの自動反映。
- AI AgentがPaper Orderやpositionを直接変更すること。
- AI AgentがDB、filesystem、shell、GMO Private API secretへ直接アクセスすること。
- AI AgentがRisk Gateを緩和すること。
- 既存Strategy DSLを外れた任意コード生成や実行。
- embedding/vector-based memory recall。Phase 1ではtag + full-textに限定する。

## Core Decision

Phase 1のAI Agentは **Research + Evaluation Agent** とする。

```text
AgentScheduler
  -> AgentRunEnvelopeBuilder
      -> agent id / version / prompt
      -> read-only tool allowlist / budgets
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
      -> Candidate Strategy用Paper Account
      -> Paper Trading evaluation
      -> Candidate Slot management
      -> Adoption Gate
      -> Baseline Strategy auto-promotion / Candidate Strategy auto-retirement
      -> Shadow Baseline Run / Baseline Rollback
```

AI Agentが行うこと:

- 市場状態とCandidate Strategy成績を観察する。
- 過去のrejection、Candidate Review、memoryを参照する。
- 新しいStrategy Definition候補を提案する。
- 評価中Candidate Strategyの継続、停止、昇格に関するCandidate Reviewを出す。
- 自分の仮説、失敗学習、提案レビューをmemory write intentとして出す。
- Agent Proposal Cadence内の提案比率は、70%を現Baseline Strategyまたは有望Candidate Strategyのparameter refinement、30%をentry / exit / regime構造のexplorationを目安にする。

AI Agentが行わないこと:

- `place_paper_order`や`close_position`を呼ぶ。
- Paper Accountのbalance、position、Paper Order、Paper Tradeを直接更新する。
- Baseline Strategy昇格やCandidate Strategy停止を直接適用する。これらはworker/domain pipelineが適用する。
- DBへ直接writeする。
- Risk Gateを緩和する。

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

AI Agentは個別のprivate skillsを持つ。再利用価値のあるskillsは、日次または週次のFeedback Agentがrun log、proposal validation、reject履歴、Candidate Strategy成績を見た上でshared skillsへ昇格する。通常Agentが `desiredScope: "shared"` を希望しても、直接sharedには保存せず、host側がprivate skillとして保存して昇格レビュー対象にする。

AI AgentはPaper Accountを直接所有しない。AI Agentが提案したStrategy Definitionがvalidationを通過した場合、StrategyEvaluationPipelineがCandidate Strategy用のStrategy RunとPaper Accountを作る。

提案と評価の対応は `agent_strategy_proposals.agent_id`、`strategy_runs.source_agent_id`、`strategy_runs.source_proposal_id` で追跡する。

## Output Lifecycle

LLM呼び出しは1回でもよいが、出力は用途別に分解して扱う。

```ts
type AgentRunOutput = {
  observations: AgentObservation[]
  strategyProposals: StrategyProposal[]
  candidateReviews: CandidateReview[]
  memoryWrites: AgentMemoryWrite[]
  skillWriteIntents: AgentSkillWriteIntent[]
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

評価中Candidate Strategyの継続、停止、昇格に関するCandidate Review。`promote`はAdoption Gate通過と`confidence: high`を満たす場合だけBaseline Strategy昇格に使う。`retire`は`confidence: high`の場合にCandidate Strategy停止へ使う。`confidence: medium / low`は保存するが自動適用しない。

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

AI Agentが保存したい学習内容。toolとして直接保存させず、host側がvalidationして保存する。

```ts
type AgentMemoryWrite = {
  type: "market_observation" | "strategy_hypothesis" | "proposal_review" | "rejection_learning"
  content: string
  tags: string[]
  sourceRefs: string[]
}
```

### AgentSkillWriteIntent

AI Agentが次回以降に再利用したい判断手順や観察手順。必ず日本語で作る。toolとして直接保存させず、host側がvalidationしてprivate skillとして保存する。shared化はFeedback Agentの昇格処理だけが行う。

```ts
type AgentSkillWriteIntent = {
  title: string
  body: string
  tags: string[]
  sourceRefs: string[]
  reason: string
  desiredScope: "private" | "shared"
}
```

## Observation Input

AI Agent入力は **minimal run envelope + read-only tool access** にする。

workerがAI Runnerへ渡すrun envelopeは、agent id、agent version、system prompt、tool allowlist、budget、実行理由などの制御情報に限定する。市場状態、Candidate Strategy成績、reject履歴、Daily Review、memoryなどの観察データはrun envelopeに含めない。

Research Tool Serverは `get_context_snapshot` toolで、LLM呼び出し前後に必要な初期観察snapshotを返す。snapshotには以下を含める。

- 現在のBaseline Strategy / Candidate Strategy一覧。
- 評価中Candidate Strategyの直近PnL、trade count、drawdown、status。
- 直近のAI Proposal rejection理由。
- 直近のDaily Review summary。
- market status、最新Canonical Candle時刻、spread状態。
- memory recallの初期結果。

AI Agentはまず `get_context_snapshot` を呼び、必要な場合だけ追加のread-only toolを呼ぶ。

Phase 1のtool allowlist:

```text
get_context_snapshot(agentId, timeframe?)
read_bars(symbol, timeframe, count, priceType)
calc_indicator(symbol, timeframe, indicator, params, count)
get_candidate_performance(strategyName)
get_rejection_history(strategyName?, limit)
recall_memory(agentId, query, types, limit)
recall_skills(agentId, query, scopes, tags, limit)
get_skill(agentId, skillId)
```

write toolは持たせない。`save_memory` は存在させず、`memoryWrites` をAgentOutputProcessorが検証して保存する。
`save_skill` も存在させない。skillsは `skillWriteIntents` として出力し、host側が日本語チェックとscope制御を行って保存する。

## Tool Runtime

`apps/ai-runner` はLLM実行とtool loopだけを担当する。DB接続、repository、Paper Account更新、Risk Gate decisionは持たない。

read-only toolsはMCP互換のtool serverとして分離する。Claude CLIには `--mcp-config` で `mcp-agent-research` のStreamable HTTP endpointを渡す。これにより、`apps/ai-runner` はDB credentialを持たず、DB readは `mcp-agent-research` 側に閉じる。

AI Agent / LLM tool loopの観察データはすべてResearch Tool Server経由にする。初期context summaryも例外にしない。一方で、workerのAgentOutputProcessor、StrategyEvaluationPipeline、Paper Trading、Adoption GateはMCPを経由しない。これらはDeterministic Control Planeとして、DB repositoryとdomain logicを直接使い、transaction境界と再現性を保つ。

```text
apps/ai-runner
  -> Claude CLI --mcp-config
  -> http://mcp-agent-research:8789/mcp
       -> get_context_snapshot
       -> read_bars / calc_indicator
       -> get_candidate_performance / get_rejection_history
       -> recall_memory / recall_skills / get_skill
```

MCP serverはDB readだけを許可する。writeが必要な処理は、workerのAgentOutputProcessorがDB repository経由で行う。

Phase 1では、process数を抑えるためにread-only MCP serverを1つの `mcp-agent-research` serviceとして実装してもよい。ただしtool権限はread-onlyに固定する。

Research Tool ServerはAI Agentの観察インターフェースであり、market data collectorやcandle aggregationの実行主体ではない。保存済みmarket data、評価済みCandidate Strategy成績、reject履歴、memory、skillsを読み、必要な外部参照が増えた場合もread-only toolとして追加する。system of recordへの書き込みはworker pipelineだけが行う。

## Strategy Evaluation Pipeline

AI Agentが出したStrategyProposalは、以下の順に処理する。

```text
JSON parse
  -> AI Agent output schema validation
  -> validateAiStrategyProposal
  -> forbidden capability scan
  -> Risk Gate cannot be relaxed
  -> Candidate Similarity Check
  -> Candidate Slot check
  -> Candidate Strategy用Strategy Run作成
  -> Candidate Strategy用Paper Account作成
  -> PaperTraderServiceで評価
  -> Adoption Gate
  -> Daily Review confidence check
  -> Baseline Strategy auto-promotion or Candidate Strategy auto-retirement
  -> Shadow Baseline Run
  -> Baseline Rollback if regression is detected
```

CandidateReviewの扱い:

- `promote + confidence: high` はAdoption Gate通過時だけ自動昇格に使う。
- `retire + confidence: high` はAdoption Gateを待たず自動停止に使う。
- `medium / low` はUIと次回context building用に保存し、自動適用しない。

Adoption Gate:

- net profit after costが同じtimeframeの現Baseline Strategyを5%以上上回る。
- trade countが1mは20件、5mは12件、15mは6件以上。
- max drawdownが現Baseline Strategy以下、かつ15%以下。
- spread/slippage stressで極端に崩れない。
- validationがtrainより極端に悪くない。
- Risk Gateを緩和していない。
- Candidate StrategyとBaseline Strategyのtimeframeが一致している。

Candidate Slot:

- active Candidate Strategyはtimeframeごとに最大3本。
- 枠が埋まっている状態で新Candidate Strategyがschema/Risk Gate validationを通過した場合は保留せず即投入する。
- 押し出し対象は、停止推薦があるもの、Adoption Gateの最低条件から最も遠いもの、validation windowを終えた最古のものの順で選ぶ。

Shadow Baseline Run:

- 新Baseline Strategy昇格後、旧Baseline Strategyはtimeframe別validation window 1回分だけ継続評価する。
- Shadow Baseline Runが新Baseline Strategyより明確に良い場合、旧Baseline Strategyを同じtimeframeの現役Baseline Strategyへ自動rollbackする。

## Existing AI Tuner / Daily Reviewer

最適設計では、既存hourly tunerとdaily reviewerは長期的にAgent Pipelineへ吸収する。

Phase 1:

- 既存tuner / daily reviewerは残す。
- 新しいAgent Pipelineは別serviceとして導入する。
- AI Proposalも既存と同じStrategy DSL validationを通す。

Phase 2:

- hourly tunerのmanual run triggerはResearch Agent pipelineを優先実行する。旧 `AiTunerService` はfallback serviceとして残す。
- daily reviewerのmanual run triggerはactive AI Agentを横断実行し、CandidateReview数とpromotion/retirement Candidate Review数を集計する。旧 `AiDailyReviewerService` はfallback serviceとして残す。
- Agent proposal cadenceは1mが1時間、5mが3時間、15mが12時間を初期値にする。
- AI Agent Runにはtoken/cost budget、consecutive failure tracking、auto-pauseを持たせる。
- memory recallはAI Agent memoryと `shared_memory` tag付きmemory shelfを対象にし、PostgreSQL full-text + fallback substring searchを使う。
- 既存 `ai_invocations` は後方互換のため維持し、AI Agent Run logを主ログとして扱う。

Phase 3:

- seedは複数AI Agentを作成する。初期構成は `Research Agent 01` と `Research Agent 1H`。
- AI Agent一覧はproposal/runの成功・失敗件数を返し、比較UIの最小入力にする。
- `Research Agent 1H` はcontext buildingで1h candleを使う。
- shared memory shelfは `shared_memory` tagで表現する。Phase 3では独立tableを追加しない。
- live tradingへの反映は実装しない。live trading向けには人間承認ゲートを別設計し、AI Agent outputは直接live order pathへ接続しない。

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

ai_agent_skills
  id: uuid
  agent_id: uuid
  scope: text                 # private | shared
  title: text
  body: text
  tags: text[]
  source_refs: jsonb
  reason: text
  status: text                # draft | active | archived
  version: integer
  promoted_from_skill_id: uuid nullable
  created_run_id: uuid nullable
  created_at: timestamptz
  updated_at: timestamptz
  index(agent_id)
  index(scope, status)
  gin_index(tags)

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

既存 `paper_accounts` はAI Agentに直接紐づけない。Candidate Strategy用Paper AccountはStrategyEvaluationPipelineが作成し、source proposalを辿れるようにする。

## Web UI

`/agents` 配下にResearch Agent UIを追加する。

```text
/agents
  - AI Agent一覧
  - name, persona, status, model, latest run, proposal count

/agents/[id]
  - overview: latest observations, proposals, Candidate Review summary
  - prompt: systemPrompt編集、tool allowlist編集
  - memories: 検索、一覧、削除
  - skills: private / shared skillsの一覧
  - proposals: validation結果、paper投入状況、関連Strategy Run
  - reviews: continue / retire / promote Candidate Reviewとdeterministic gate結果
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
  あなたはUSD/JPYのPaper Trading戦略を研究するAI Agentです。
  あなたはPaper Order、決済、Baseline Strategy昇格、Candidate Strategy停止を直接実行してはいけません。
  あなたの役割は、市場状態、候補成績、過去の失敗理由、自分のmemoryを観察し、
  Strategy Definition候補、Candidate Review、Observation、Memory WriteをJSONで出力することです。
  Strategy Definitionは許可済みDSLだけを使い、Risk Gateを緩和してはいけません。
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

- AI Agentはwrite toolを持たない。
- AI Agent outputは用途別schemaでvalidationする。
- StrategyProposalは既存Strategy DSL validatorとrisk validatorを通す。
- CandidateReviewの`promote`はAdoption Gateなしに適用しない。`retire`は`confidence: high`の場合に自動停止へ使える。
- `apps/ai-runner` はDB credential、repository write mount、GMO Private API secretを持たない。
- read-only MCP serverにはwrite SQL、mutation repository、paper execution APIを置かない。
- prompt、tool args、tool resultはredactしてrun logへ保存する。
- system prompt保存時はsecret-like文字列を検出し、UIで警告する。
- memory / skills lookup toolの `agentId` はLLM出力を信用せず、ai-runner側で実行中Agentのidに固定する。
- skillWriteIntentsは日本語を含まない場合schema validationでrejectする。
- output size、tool hop、timeout、token budgetをagent単位で制限する。

## Implementation Phases

```text
Phase 1
  - ai_agents / versions / runs / memories / observations / proposals / reviews schema追加
  - `get_context_snapshot` を含むread-only research tools実装
  - AiAgentRunner実装
  - AgentScheduler / AgentRunEnvelopeBuilder / AgentOutputProcessor実装
- StrategyEvaluationPipelineにAI Agent source proposalを接続
- /agents UI追加
- seed AI Agent 1体投入

Phase 2
  - existing hourly tunerをAgent Pipelineへ統合
  - daily reviewerをCandidate Review / cross-agent reviewへ統合
  - token usage / cost budget UI
  - consecutive failure auto-pause
  - memory full-text search改善

Phase 3
  - 複数AI Agent
  - AI Agent間比較
  - shared memory shelfの検討
  - 1h timeframe
  - live trading向け人間承認ゲートの別設計
```

## Relation To PR #37

PR #37の「AI Agentを第一級概念にする」「system promptとtool構成をversion管理する」「read-only indicator / memory toolを使う」方向は採用する。

一方で、以下はPhase 1から外す。

- `mcp-trading.place_paper_order`
- `mcp-trading.close_position`
- AI Agent と Paper Account を1対1に固定する設計
- AI Agentが直接Paper Tradingを行う常駐execution runtime

AI Agentはexecution runtimeではなく、Strategy DSL候補とCandidate Reviewを改善し続けるresearch entityとして扱う。

## 関連ドキュメント

- [System Architecture](./system.md)
- [Trading Design](./trading.md)
- [AI Tuning](./ai-tuning.md)
- [Data Architecture](./data.md)
- [Agent Personas (キャラクター仕様)](../personas/README.md)
- [ADR 0001: Claude CLIはAI Runnerで隔離実行する](../adr/0001-run-claude-cli-in-ai-runner.md)
- [ADR 0003: Research + Evaluation Agentを導入する](../adr/0003-introduce-research-evaluation-ai-agents.md)
