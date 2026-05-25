import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { promisify } from "node:util";

import type {
  AiDailyReviewResponse,
  AiStrategyProposalResponse,
  DailyReviewInput,
  StrategyProposalInput,
} from "@ai-trade/domain/ai-tuning";
import { validateAiDailyReview } from "@ai-trade/domain/ai-tuning";
import { validateAiStrategyProposal } from "@ai-trade/domain/strategies";

const execFileAsync = promisify(execFile);

export type AiRunnerProviderState = {
  name: "claude_cli";
  mode: "enabled" | "disabled";
  implementation: "claude_cli";
  enabled: boolean;
  ready: boolean;
  reason: string;
};

export type ClaudeCliInvocationInput = {
  prompt: string;
  timeoutMs?: number;
};

export type ClaudeCliInvocationResult =
  | {
      ok: true;
      provider: "claude_cli";
      stdout: string;
      stderrSummary?: string;
      startedAt: string;
      finishedAt: string;
      timeoutMs: number;
    }
  | {
      ok: false;
      provider: "claude_cli";
      error: string;
      startedAt: string;
      finishedAt: string;
      timeoutMs: number;
    };

export interface StrategyProposalProvider {
  health(): Promise<AiRunnerProviderState>;
  invoke(input: ClaudeCliInvocationInput): Promise<ClaudeCliInvocationResult>;
  generateStrategyProposal(input: StrategyProposalInput): Promise<AiStrategyProposalResponse>;
  generateDailyReview(input: DailyReviewInput): Promise<AiDailyReviewResponse>;
}

export type ClaudeCliProviderOptions = {
  enabled?: boolean;
  executable?: string;
  timeoutMs?: number;
  mcpEnabled?: boolean;
  mcpAgentResearchUrl?: string;
};

export class ClaudeCliProvider implements StrategyProposalProvider {
  private readonly enabled: boolean;
  private readonly executable: string;
  private readonly timeoutMs: number;
  private readonly mcpEnabled: boolean;
  private readonly mcpAgentResearchUrl: string;

  constructor(options: ClaudeCliProviderOptions = {}) {
    this.enabled = options.enabled ?? process.env.CLAUDE_CLI_ENABLED === "1";
    this.executable = options.executable ?? process.env.CLAUDE_CLI_PATH ?? "claude";
    this.timeoutMs = options.timeoutMs ?? 120_000;
    this.mcpEnabled = options.mcpEnabled ?? process.env.CLAUDE_MCP_ENABLED === "1";
    this.mcpAgentResearchUrl =
      options.mcpAgentResearchUrl ??
      process.env.MCP_AGENT_RESEARCH_INTERNAL_URL ??
      "http://localhost:8789";
  }

  async health(): Promise<AiRunnerProviderState> {
    return {
      name: "claude_cli",
      mode: this.enabled ? "enabled" : "disabled",
      implementation: "claude_cli",
      enabled: this.enabled,
      ready: this.enabled,
      reason: this.enabled
        ? "Claude CLI provider is enabled."
        : "Set CLAUDE_CLI_ENABLED=1 to enable strategy proposal generation.",
    };
  }

  async invoke(input: ClaudeCliInvocationInput): Promise<ClaudeCliInvocationResult> {
    const startedAt = new Date();
    const timeoutMs = input.timeoutMs ?? this.timeoutMs;

    if (!this.enabled) {
      return {
        ok: false,
        provider: "claude_cli",
        error: "Claude CLI provider is disabled.",
        startedAt: startedAt.toISOString(),
        finishedAt: new Date().toISOString(),
        timeoutMs,
      };
    }

    try {
      const { stdout, stderr } = await execFileAsync(
        this.executable,
        this.buildArgs(input.prompt),
        {
          timeout: timeoutMs,
          maxBuffer: 1024 * 1024,
        },
      );
      const emptyOutputError = toEmptyOutputError(stdout, stderr);

      if (emptyOutputError) {
        return {
          ok: false,
          provider: "claude_cli",
          error: emptyOutputError,
          startedAt: startedAt.toISOString(),
          finishedAt: new Date().toISOString(),
          timeoutMs,
        };
      }

      return {
        ok: true,
        provider: "claude_cli",
        stdout,
        stderrSummary: summarizeStderr(stderr),
        startedAt: startedAt.toISOString(),
        finishedAt: new Date().toISOString(),
        timeoutMs,
      };
    } catch (error) {
      return {
        ok: false,
        provider: "claude_cli",
        error: error instanceof Error ? error.message : String(error),
        startedAt: startedAt.toISOString(),
        finishedAt: new Date().toISOString(),
        timeoutMs,
      };
    }
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
      const { stdout, stderr } = await execFileAsync(this.executable, this.buildArgs(prompt), {
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

  async generateDailyReview(input: DailyReviewInput): Promise<AiDailyReviewResponse> {
    const startedAt = new Date();
    const prompt = buildDailyReviewPrompt(input);
    const promptHash = hashPrompt(prompt);
    const invocationId = randomUUID();
    const timeoutMs = Math.max(this.timeoutMs, 180_000);

    if (!this.enabled) {
      return {
        invocation: {
          id: invocationId,
          provider: "claude_cli",
          status: "failed",
          promptHash,
          promptRedacted: prompt,
          timeoutMs,
          startedAt: startedAt.toISOString(),
          finishedAt: new Date().toISOString(),
          errorSummary: "Claude CLI provider is disabled.",
        },
      };
    }

    try {
      const { stdout, stderr } = await execFileAsync(this.executable, this.buildArgs(prompt), {
        timeout: timeoutMs,
        maxBuffer: 1024 * 1024,
      });
      const validation = validateAiDailyReview(stdout);
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
            timeoutMs,
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
          parsedJson: validation.review,
          timeoutMs,
          startedAt: startedAt.toISOString(),
          finishedAt: finishedAt.toISOString(),
        },
        review: validation.review,
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
          timeoutMs,
          startedAt: startedAt.toISOString(),
          finishedAt: finishedAt.toISOString(),
          errorSummary: error instanceof Error ? error.message : String(error),
        },
      };
    }
  }

  private buildArgs(prompt: string): string[] {
    if (!this.mcpEnabled) {
      return ["-p", prompt];
    }

    const mcpConfig = {
      mcpServers: {
        agent_research: {
          type: "http",
          url: new URL("/mcp", ensureTrailingSlash(this.mcpAgentResearchUrl)).toString(),
        },
      },
    };
    const allowedTools = [
      "mcp__agent_research__read_bars",
      "mcp__agent_research__calc_indicator",
      "mcp__agent_research__get_candidate_performance",
      "mcp__agent_research__get_rejection_history",
      "mcp__agent_research__recall_memory",
      "mcp__agent_research__recall_skills",
      "mcp__agent_research__get_skill",
    ];

    return [
      "-p",
      "--strict-mcp-config",
      "--mcp-config",
      JSON.stringify(mcpConfig),
      "--allowedTools",
      allowedTools.join(","),
      "--",
      prompt,
    ];
  }
}

function buildStrategyProposalPrompt(input: StrategyProposalInput): string {
  return JSON.stringify({
    instruction:
      "Return JSON only. Propose one safe USD/JPY paper-trading candidate by modifying allowed StrategyDefinition parameters. Do not include code, shell commands, secrets, or live trading instructions. All natural-language text fields (rationale) MUST be written in 日本語 (Japanese).",
    baseline: input.baseline,
    recentPerformance: input.recentPerformance,
    rejectedCandidateSummaries: input.rejectedCandidateSummaries,
    explorationPolicy: input.explorationPolicy,
    outputSchema: {
      proposal_id: "string optional",
      rationale: "string (日本語で記述すること / write in Japanese)",
      strategy: "StrategyDefinition",
    },
  });
}

function buildDailyReviewPrompt(input: DailyReviewInput): string {
  return JSON.stringify({
    instruction:
      "Return JSON only. Produce a daily paper-trading operations review. Do not include shell commands, secrets, live trading instructions, or any recommendation that changes baseline automatically. All natural-language text values (summary, reason, message, next_actions) MUST be written in 日本語 (Japanese). Keep identifiers such as strategy names, status codes, and warning codes in their original form (ASCII).",
    input,
    outputSchema: {
      review_date: "YYYY-MM-DD",
      summary: "string (日本語で記述すること / write in Japanese)",
      baseline_promotion_candidates:
        "array of { strategyName, reason (日本語), confidence: low|medium|high }",
      candidate_retirement_candidates:
        "array of { strategyName, reason (日本語), confidence: low|medium|high }",
      warnings:
        "array of { severity: info|warning|critical, code (ASCII identifier), message (日本語) }",
      next_actions: "array of strings (日本語で記述すること / write in Japanese) for human review",
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

function toEmptyOutputError(stdout: string, stderr: string): string | null {
  if (stdout.trim().length > 0) {
    return null;
  }

  const stderrSummary = summarizeStderr(stderr);
  return stderrSummary
    ? `Claude CLI returned empty stdout. stderr: ${stderrSummary}`
    : "Claude CLI returned empty stdout.";
}

function ensureTrailingSlash(url: string): string {
  return url.endsWith("/") ? url : `${url}/`;
}
