# Claude CLIはAI Runnerで隔離実行する

Claude CLIはmain worker containerではなく、専用の`ai-runner` containerで実行する。workerはscheduler、DB write、Candidate Strategy adoption、Paper Account更新、Risk Gate decisionを持ち、AI RunnerはClaude CLIを実行してAI ProposalまたはDaily Review JSONを返すだけにする。これにより、内部serviceとAPI境界は増えるが、AI実行面をDB credentialやworker stateから分離できる。

**Status**: accepted

**Consequences**:
AI Runnerはread-onlyのClaude config mountだけを持ち、DB接続、repository write mount、GMO Private API secretを持たない。timeout、output size limit、JSON schema validationを必須にし、workerとはDocker内部networkだけで通信する。
