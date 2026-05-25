# Research + Evaluation Agentを導入する

AI agentはpaper orderを直接出すtraderではなく、Strategy Definition候補と候補レビューを継続的に改善する **Research + Evaluation Agent** として導入する。

agentはdeterministic summaryとread-only toolで、市場状態、指標、候補成績、reject履歴、memoryを参照する。出力は `AgentObservation`、`StrategyProposal`、`CandidateReview`、`AgentMemoryWrite` に分ける。host側のAgentOutputProcessorがschema validation、Strategy DSL validation、risk validation、memory保存、proposal永続化を行い、StrategyEvaluationPipelineがcandidate paper account作成、paper評価、昇格/停止判断を行う。

**Status**: accepted

**Consequences**:
agentに `place_paper_order`、`close_position`、DB write、shell実行、live trading toolは与えない。`apps/ai-runner` はLLM実行とread-only tool loopだけを担当し、DB接続、repository write mount、GMO Private API secretを持たない。既存hourly tuner / daily reviewerはPhase 1では残し、Phase 2以降でAgent Pipelineへ吸収する。
