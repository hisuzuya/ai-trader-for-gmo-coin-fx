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
        mcpAgentResearchCommand: "/usr/local/bin/node",
        mcpAgentResearchArgs: ["/app/apps/mcp-agent-research/dist/mcp-stdio.cjs"],
      });
      const result = await provider.invoke({ prompt: "Return JSON only." });

      expect(result).toMatchObject({ ok: true, provider: "claude_cli" });

      const args = (await readFile(argsFile, "utf8")).trim().split("\n");

      expect(args).toContain("--strict-mcp-config");
      expect(args).toContain("--mcp-config");
      expect(args).toContain("--allowedTools");
      expect(args.at(-2)).toBe("--");
      expect(args.at(-1)).toBe("Return JSON only.");
      expect(args[args.indexOf("--allowedTools") + 1]).toContain(
        "mcp__agent_research__read_bars,mcp__agent_research__calc_indicator",
      );

      const config = JSON.parse(args[args.indexOf("--mcp-config") + 1]);
      expect(config.mcpServers.agent_research).toEqual({
        type: "stdio",
        command: "/usr/local/bin/node",
        args: ["/app/apps/mcp-agent-research/dist/mcp-stdio.cjs"],
      });
    } finally {
      await rm(dir, { force: true, recursive: true });
    }
  });

  it("summarizes MCP tool use from Claude transcript files", async () => {
    const dir = await mkdtemp(join(tmpdir(), "claude-mcp-transcript-"));
    const executable = join(dir, "claude-mcp-transcript");
    const configDir = join(dir, "claude-config");
    const previousConfigDir = process.env.CLAUDE_CONFIG_DIR;

    try {
      process.env.CLAUDE_CONFIG_DIR = configDir;
      await writeFile(
        executable,
        `#!/usr/bin/env bash
mkdir -p "$CLAUDE_CONFIG_DIR/projects/-app-apps-ai-runner"
cat > "$CLAUDE_CONFIG_DIR/projects/-app-apps-ai-runner/session.jsonl" <<'JSONL'
{"message":{"content":[{"type":"tool_use","id":"toolu_1","name":"mcp__agent_research__recall_skills","input":{"agentId":"agent-1","limit":3}}]}}
{"message":{"content":[{"type":"tool_result","tool_use_id":"toolu_1","content":[{"type":"text","text":"{\\"skills\\":[{\\"id\\":\\"skill-1\\"}]}"}]}]}}
JSONL
printf '{"ok":true}'
`,
      );
      await chmod(executable, 0o755);

      const provider = new ClaudeCliProvider({ enabled: true, executable });
      const result = await provider.invoke({ prompt: "Return JSON only." });

      expect(result).toMatchObject({
        ok: true,
        provider: "claude_cli",
        mcpToolCalls: [
          {
            name: "recall_skills",
            argsSummary: {
              source: "claude_mcp",
              toolName: "mcp__agent_research__recall_skills",
              toolUseId: "toolu_1",
              input: { agentId: "agent-1", limit: 3 },
            },
          },
        ],
      });
    } finally {
      if (previousConfigDir === undefined) {
        delete process.env.CLAUDE_CONFIG_DIR;
      } else {
        process.env.CLAUDE_CONFIG_DIR = previousConfigDir;
      }
      await rm(dir, { force: true, recursive: true });
    }
  });
});
