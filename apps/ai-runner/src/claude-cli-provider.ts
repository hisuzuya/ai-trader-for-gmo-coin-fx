import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { promisify } from "node:util";

import type { AiStrategyProposalResponse, StrategyProposalInput } from "@ai-trade/domain/ai-tuning";
import { validateAiStrategyProposal } from "@ai-trade/domain/strategies";

const execFileAsync = promisify(execFile);

export type AiRunnerProviderState = {
  name: "claude_cli";
  mode: "enabled" | "disabled";
  implementation: "claude_cli";
  enabled: boolean;
  reason: string;
};

export interface StrategyProposalProvider {
  health(): Promise<AiRunnerProviderState>;
  generateStrategyProposal(input: StrategyProposalInput): Promise<AiStrategyProposalResponse>;
}

export type ClaudeCliProviderOptions = {
  enabled?: boolean;
  executable?: string;
  timeoutMs?: number;
};

export class ClaudeCliProvider implements StrategyProposalProvider {
  private readonly enabled: boolean;
  private readonly executable: string;
  private readonly timeoutMs: number;

  constructor(options: ClaudeCliProviderOptions = {}) {
    this.enabled = options.enabled ?? process.env.CLAUDE_CLI_ENABLED === "1";
    this.executable = options.executable ?? process.env.CLAUDE_CLI_PATH ?? "claude";
    this.timeoutMs = options.timeoutMs ?? 120_000;
  }

  async health(): Promise<AiRunnerProviderState> {
    return {
      name: "claude_cli",
      mode: this.enabled ? "enabled" : "disabled",
      implementation: "claude_cli",
      enabled: this.enabled,
      reason: this.enabled
        ? "Claude CLI provider is enabled."
        : "Set CLAUDE_CLI_ENABLED=1 to enable strategy proposal generation.",
    };
  }

  async generateStrategyProposal(
    input: StrategyProposalInput,
  ): Promise<AiStrategyProposalResponse> {
    const startedAt = new Date();
    const prompt = buildStrategyProposalPrompt(input);
    const promptHash = hashPrompt(prompt);
    const invocationId = randomUUID();

    if (!this.enabled) {
      return {
        invocation: {
          id: invocationId,
          provider: "claude_cli",
          status: "failed",
          promptHash,
          promptRedacted: prompt,
          timeoutMs: this.timeoutMs,
          startedAt: startedAt.toISOString(),
          finishedAt: new Date().toISOString(),
          errorSummary: "Claude CLI provider is disabled.",
        },
      };
    }

    try {
      const { stdout, stderr } = await execFileAsync(this.executable, ["-p", prompt], {
        timeout: this.timeoutMs,
        maxBuffer: 1024 * 1024,
      });
      const validation = validateAiStrategyProposal(stdout);
      const finishedAt = new Date();

      if (validation.status === "rejected") {
        return {
          invocation: {
            id: invocationId,
            provider: "claude_cli",
            status: "failed",
            promptHash,
            promptRedacted: prompt,
            stdoutRaw: stdout,
            stderrSummary: summarizeStderr(stderr),
            parsedJson: undefined,
            timeoutMs: this.timeoutMs,
            startedAt: startedAt.toISOString(),
            finishedAt: finishedAt.toISOString(),
            errorSummary: validation.reasons.map((reason) => reason.message).join("; "),
          },
        };
      }

      return {
        invocation: {
          id: invocationId,
          provider: "claude_cli",
          status: "succeeded",
          promptHash,
          promptRedacted: prompt,
          stdoutRaw: stdout,
          stderrSummary: summarizeStderr(stderr),
          parsedJson: validation.proposal,
          timeoutMs: this.timeoutMs,
          startedAt: startedAt.toISOString(),
          finishedAt: finishedAt.toISOString(),
        },
        proposal: validation.proposal,
      };
    } catch (error) {
      const finishedAt = new Date();
      const status =
        error instanceof Error && error.message.includes("timed out") ? "timeout" : "failed";

      return {
        invocation: {
          id: invocationId,
          provider: "claude_cli",
          status,
          promptHash,
          promptRedacted: prompt,
          timeoutMs: this.timeoutMs,
          startedAt: startedAt.toISOString(),
          finishedAt: finishedAt.toISOString(),
          errorSummary: error instanceof Error ? error.message : String(error),
        },
      };
    }
  }
}

function buildStrategyProposalPrompt(input: StrategyProposalInput): string {
  return JSON.stringify({
    instruction:
      "Return JSON only. Propose one safe USD/JPY paper-trading candidate by modifying allowed StrategyDefinition parameters. Do not include code, shell commands, secrets, or live trading instructions.",
    baseline: input.baseline,
    recentPerformance: input.recentPerformance,
    rejectedCandidateSummaries: input.rejectedCandidateSummaries,
    explorationPolicy: input.explorationPolicy,
    outputSchema: {
      proposal_id: "string optional",
      rationale: "string",
      strategy: "StrategyDefinition",
    },
  });
}

function hashPrompt(prompt: string): string {
  return createHash("sha256").update(prompt).digest("hex");
}

function summarizeStderr(stderr: string): string | undefined {
  const trimmed = stderr.trim();
  return trimmed.length === 0 ? undefined : trimmed.slice(0, 2000);
}
