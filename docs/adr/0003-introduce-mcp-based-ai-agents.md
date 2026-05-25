# AI agentをMCPベースで導入する

paper trading向けのAIを、既存のhourly tuner / daily reviewerというbatch jobの上に、**継続的に存在するAI agent**として拡張する。1つのagentが1つのpaper accountを担当し、自分のpersona、system prompt、long-term memoryを持つ。指標取得、記憶操作、取引執行は3つのMCP serverに分離する。agentはMCP clientとしてこれらに接続する。最初は1体だけ起動し、N体への拡張をschema / runner段階で確保しておく。詳細は [docs/architecture/ai-agents.md](../architecture/ai-agents.md) を参照する。

**Status**: accepted

**Consequences**:
新規にMCP serverを3つ (mcp-indicators / mcp-memory / mcp-trading) 用意する。agent実行は既存`ai-runner` containerに同居させる。`ai-runner -> packages/db` 禁止ルールは維持し、DBアクセスはMCP server経由のみとする。agent操作はweb UIから可能にし、system promptとskill構成の変更はversionとして履歴を残す。既存6つのpaper accountは`stopped`に遷移させ、agent担当口座とは分離する。
