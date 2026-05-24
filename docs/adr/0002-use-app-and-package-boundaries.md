# appsとpackagesの境界を固定する

実行単位は`apps/web`、`apps/worker`、`apps/ai-runner`に分け、共有部分は`packages/db`と`packages/domain`に限定する。`packages/domain`はDBやserver runtimeに依存しない純粋ドメインロジックだけを持ち、Drizzle schema、DB client、migrationは`packages/db`へ集約する。monorepo toolingは既存の`pnpm@10.20.0`に合わせてpnpm workspaceを使う。

**Status**: accepted

**Consequences**:
`apps/* -> packages/*`は許可するが、`packages/domain -> packages/db`、`packages/db -> apps/*`、`apps/* -> apps/*`は許可しない。Phase 0でimport boundary checkを導入し、package境界が崩れた時点でCIで検出できるようにする。
