# appsとpackagesの境界を固定する

実行単位は`apps/web`、`apps/worker`、`apps/ai-runner`、`apps/mcp-agent-research`に分け、共有部分は`packages/db`、`packages/domain`、`packages/config`に限定する。`packages/domain`はDBやserver runtimeに依存しない純粋ドメインロジックだけを持ち、Drizzle schema、DB client、migrationは`packages/db`へ集約する。monorepo toolingは既存の`pnpm@10.20.0`に合わせてpnpm workspaceを使う。

**Status**: accepted

**Consequences**:
`apps/* -> packages/*`は許可するが、`packages/domain -> packages/db`、`packages/db -> apps/*`、`apps/* -> apps/*`は許可しない。例外として`apps/mcp-agent-research -> packages/db`はread-only tool APIを提供するために許可する。`apps/ai-runner -> packages/db`は禁止し、AI実行面をDB credentialから分離する。Phase 0でimport boundary checkを導入し、package境界が崩れた時点でCIで検出できるようにする。
