import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
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
});
