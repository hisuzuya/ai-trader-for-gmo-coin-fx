import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { ClaudeCliProvider } from "./claude-cli-provider.js";

describe("ClaudeCliProvider", () => {
  it("treats empty stdout as a failed invocation", async () => {
    const dir = await mkdtemp(join(tmpdir(), "claude-empty-"));
    const executable = join(dir, "claude-empty");

    try {
      await writeFile(executable, "#!/usr/bin/env bash\nexit 0\n");
      await chmod(executable, 0o755);

      const provider = new ClaudeCliProvider({ enabled: true, executable });
      const result = await provider.invoke({ prompt: "Return JSON only." });

      expect(result).toMatchObject({
        ok: false,
        provider: "claude_cli",
        error: "Claude CLI returned empty stdout.",
      });
    } finally {
      await rm(dir, { force: true, recursive: true });
    }
  });

  it("passes Claude Code MCP config when MCP is enabled", async () => {
    const dir = await mkdtemp(join(tmpdir(), "claude-mcp-args-"));
    const executable = join(dir, "claude-mcp-args");
    const argsFile = join(dir, "args.json");

    try {
      await writeFile(
        executable,
        `#!/usr/bin/env bash\nprintf '%s\\n' "$@" > "${argsFile}"\nprintf '{"ok":true}'\n`,
      );
      await chmod(executable, 0o755);

      const provider = new ClaudeCliProvider({
        enabled: true,
        executable,
        mcpEnabled: true,
        mcpAgentResearchUrl: "http://mcp-agent-research:8789",
      });
      const result = await provider.invoke({ prompt: "Return JSON only." });

      expect(result).toMatchObject({ ok: true, provider: "claude_cli" });

      const args = (await readFile(argsFile, "utf8")).trim().split("\n");

      expect(args).toContain("--strict-mcp-config");
      expect(args).toContain("--mcp-config");
      expect(args).toContain("--allowedTools");
      expect(args).toContain("mcp__agent_research__read_bars");
      expect(args.at(-1)).toBe("Return JSON only.");

      const config = JSON.parse(args[args.indexOf("--mcp-config") + 1]);
      expect(config.mcpServers.agent_research).toEqual({
        type: "http",
        url: "http://mcp-agent-research:8789/mcp",
      });
    } finally {
      await rm(dir, { force: true, recursive: true });
    }
  });
});
