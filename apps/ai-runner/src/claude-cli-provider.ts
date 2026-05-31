import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import {
  AGENT_RESEARCH_TOOL_NAMES,
  type AgentResearchToolName,
  type AgentToolCallLog,
} from "@ai-trade/domain/ai-agents";
import type {
  AiDailyReviewResponse,
  AiPromptOptimizationResponse,
  AiStrategyProposalResponse,
  DailyReviewInput,
  PromptOptimizationInput,
  StrategyProposalInput,
} from "@ai-trade/domain/ai-tuning";
import { validateAiDailyReview, validateAiPromptOptimization } from "@ai-trade/domain/ai-tuning";
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
      mcpToolCalls?: AgentToolCallLog[];
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
  generatePromptOptimization(
    input: PromptOptimizationInput,
  ): Promise<AiPromptOptimizationResponse>;
}

export type ClaudeCliProviderOptions = {
  enabled?: boolean;
  executable?: string;
  timeoutMs?: number;
  mcpEnabled?: boolean;
  mcpAgentResearchCommand?: string;
  mcpAgentResearchArgs?: string[];
};

export class ClaudeCliProvider implements StrategyProposalProvider {
  private readonly enabled: boolean;
  private readonly executable: string;
  private readonly timeoutMs: number;
  private readonly mcpEnabled: boolean;
  private readonly mcpAgentResearchCommand: string;
  private readonly mcpAgentResearchArgs: string[];

  constructor(options: ClaudeCliProviderOptions = {}) {
    this.enabled = options.enabled ?? process.env.CLAUDE_CLI_ENABLED === "1";
    this.executable = options.executable ?? process.env.CLAUDE_CLI_PATH ?? "claude";
    this.timeoutMs = options.timeoutMs ?? 120_000;
    this.mcpEnabled = options.mcpEnabled ?? process.env.CLAUDE_MCP_ENABLED === "1";
    this.mcpAgentResearchCommand =
      options.mcpAgentResearchCommand ??
      process.env.CLAUDE_MCP_AGENT_RESEARCH_COMMAND ??
      "/usr/local/bin/node";
    this.mcpAgentResearchArgs = options.mcpAgentResearchArgs ??
      parseMcpArgs(process.env.CLAUDE_MCP_AGENT_RESEARCH_ARGS) ?? [
        "/app/apps/mcp-agent-research/dist/mcp-stdio.cjs",
      ];
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
      const transcriptBaseline = captureClaudeTranscriptBaseline();
      const mcpActivityLogPath = join(tmpdir(), `ai-trade-mcp-activity-${randomUUID()}.jsonl`);
      const { stdout, stderr } = await execFileAsync(
        this.executable,
        this.buildArgs(input.prompt, mcpActivityLogPath),
        {
          env: {
            ...process.env,
            MCP_AGENT_RESEARCH_ACTIVITY_LOG: mcpActivityLogPath,
          },
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
        mcpToolCalls: [
          ...collectMcpActivityLog(mcpActivityLogPath),
          ...collectMcpToolCallsSince(transcriptBaseline),
        ],
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

  async generatePromptOptimization(
    input: PromptOptimizationInput,
  ): Promise<AiPromptOptimizationResponse> {
    const startedAt = new Date();
    const prompt = buildPromptOptimizationPrompt(input);
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
      // Prompt optimization is a pure reflection task: never expose research MCP
      // tools, so the optimizer cannot widen its own capabilities.
      const { stdout, stderr } = await execFileAsync(this.executable, ["-p", prompt], {
        timeout: timeoutMs,
        maxBuffer: 1024 * 1024,
      });
      const validation = validateAiPromptOptimization(stdout, {
        requiredGuardrail: input.requiredGuardrail,
      });
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
          parsedJson: validation.optimization,
          timeoutMs,
          startedAt: startedAt.toISOString(),
          finishedAt: finishedAt.toISOString(),
        },
        optimization: validation.optimization,
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

  private buildArgs(prompt: string, mcpActivityLogPath?: string): string[] {
    if (!this.mcpEnabled) {
      return ["-p", prompt];
    }

    const mcpEnv = {
      ...(process.env.DATABASE_URL ? { DATABASE_URL: process.env.DATABASE_URL } : {}),
      ...(process.env.NODE_ENV ? { NODE_ENV: process.env.NODE_ENV } : {}),
      ...(mcpActivityLogPath ? { MCP_AGENT_RESEARCH_ACTIVITY_LOG: mcpActivityLogPath } : {}),
    };

    const mcpConfig = {
      mcpServers: {
        agent_research: {
          type: "stdio",
          command: this.mcpAgentResearchCommand,
          args: this.mcpAgentResearchArgs,
          env: Object.keys(mcpEnv).length > 0 ? mcpEnv : undefined,
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

function parseMcpArgs(value: string | undefined): string[] | undefined {
  if (!value) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed) && parsed.every((item) => typeof item === "string")) {
      return parsed;
    }
  } catch {
    // Fall back to whitespace splitting for simple operational overrides.
  }
  return value.split(/\s+/).filter(Boolean);
}

type TranscriptBaseline = {
  projectsDir: string;
  byteOffsets: Map<string, number>;
};

function captureClaudeTranscriptBaseline(): TranscriptBaseline {
  const projectsDir = join(process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude"), "projects");

  return {
    projectsDir,
    byteOffsets: new Map(
      listJsonlFiles(projectsDir).map((path) => [path, safeStat(path)?.size ?? 0]),
    ),
  };
}

function collectMcpToolCallsSince(baseline: TranscriptBaseline): AgentToolCallLog[] {
  if (!existsSync(baseline.projectsDir)) {
    return [];
  }

  const toolUses = new Map<
    string,
    {
      name: AgentResearchToolName;
      rawName: string;
      args: unknown;
      result?: unknown;
    }
  >();

  for (const filePath of listJsonlFiles(baseline.projectsDir)) {
    for (const line of readJsonlLinesSince(filePath, baseline.byteOffsets.get(filePath) ?? 0)) {
      const content = getMessageContent(line);
      if (!Array.isArray(content)) {
        continue;
      }

      for (const block of content) {
        if (!isRecord(block)) {
          continue;
        }

        if (block.type === "tool_use" && typeof block.name === "string") {
          const toolName = toAgentResearchToolName(block.name);
          if (toolName) {
            const id = typeof block.id === "string" ? block.id : `${block.name}:${toolUses.size}`;
            toolUses.set(id, {
              name: toolName,
              rawName: block.name,
              args: "input" in block ? block.input : {},
            });
          }
        }

        if (block.type === "tool_result" && typeof block.tool_use_id === "string") {
          const toolUse = toolUses.get(block.tool_use_id);
          if (toolUse) {
            toolUse.result = summarizeToolResult("content" in block ? block.content : undefined);
          }
        }
      }
    }
  }

  return [...toolUses.entries()].map(([toolUseId, call]) => ({
    name: call.name,
    argsSummary: {
      source: "claude_mcp",
      toolName: call.rawName,
      toolUseId,
      input: call.args,
    },
    resultSummary: {
      source: "claude_mcp",
      toolUseId,
      result: call.result ?? { status: "not_observed" },
    },
  }));
}

function collectMcpActivityLog(filePath: string): AgentToolCallLog[] {
  if (!existsSync(filePath)) {
    return [];
  }

  try {
    return readJsonlFile(filePath).flatMap((entry): AgentToolCallLog[] => {
      if (!isRecord(entry) || entry.transport !== "stdio" || typeof entry.toolName !== "string") {
        return [];
      }

      const toolName = (AGENT_RESEARCH_TOOL_NAMES as readonly string[]).includes(entry.toolName)
        ? (entry.toolName as AgentResearchToolName)
        : undefined;
      if (!toolName) {
        return [];
      }

      return [
        {
          name: toolName,
          argsSummary: {
            source: "mcp_activity_log",
            transport: entry.transport,
            toolName: entry.toolName,
            input: isRecord(entry.input) ? entry.input : {},
            startedAt: typeof entry.startedAt === "string" ? entry.startedAt : undefined,
          },
          resultSummary: {
            source: "mcp_activity_log",
            transport: entry.transport,
            status: typeof entry.status === "string" ? entry.status : "unknown",
            result: "result" in entry ? summarizeToolResult(entry.result) : undefined,
            error: typeof entry.error === "string" ? entry.error : undefined,
            finishedAt: typeof entry.finishedAt === "string" ? entry.finishedAt : undefined,
          },
        },
      ];
    });
  } finally {
    rmSync(filePath, { force: true });
  }
}

function listJsonlFiles(root: string): string[] {
  const files: string[] = [];
  const entries = safeReadDir(root);

  for (const entry of entries) {
    const fullPath = join(root, entry);
    const stat = safeStat(fullPath);
    if (!stat) {
      continue;
    }

    if (stat.isDirectory()) {
      for (const child of safeReadDir(fullPath)) {
        const childPath = join(fullPath, child);
        const childStat = safeStat(childPath);
        if (childStat?.isFile() && childPath.endsWith(".jsonl")) {
          files.push(childPath);
        }
      }
    }
  }

  return files.sort();
}

function readJsonlLinesSince(filePath: string, byteOffset: number): unknown[] {
  return readFileSync(filePath)
    .subarray(byteOffset)
    .toString("utf8")
    .split(/\n/)
    .flatMap((line): unknown[] => {
      if (!line.trim()) {
        return [];
      }
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    });
}

function readJsonlFile(filePath: string): unknown[] {
  return readFileSync(filePath, "utf8")
    .split(/\n/)
    .flatMap((line): unknown[] => {
      if (!line.trim()) {
        return [];
      }
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    });
}

function getMessageContent(value: unknown): unknown {
  if (!isRecord(value)) {
    return undefined;
  }
  const message = value.message;
  if (isRecord(message)) {
    return message.content;
  }
  return value.content;
}

function toAgentResearchToolName(name: string): AgentResearchToolName | undefined {
  const prefix = "mcp__agent_research__";
  if (!name.startsWith(prefix)) {
    return undefined;
  }

  const toolName = name.slice(prefix.length);
  return (AGENT_RESEARCH_TOOL_NAMES as readonly string[]).includes(toolName)
    ? (toolName as AgentResearchToolName)
    : undefined;
}

function summarizeToolResult(value: unknown): unknown {
  if (typeof value === "string") {
    return truncate(value);
  }

  if (Array.isArray(value)) {
    return value.slice(0, 10).map(summarizeToolResult);
  }

  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .slice(0, 20)
        .map(([key, entry]) => [key, summarizeToolResult(entry)]),
    );
  }

  return value;
}

function truncate(value: string) {
  return value.length > 2_000 ? `${value.slice(0, 2_000)}...` : value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeReadDir(path: string): string[] {
  try {
    return readdirSync(path);
  } catch {
    return [];
  }
}

function safeStat(path: string) {
  try {
    return statSync(path);
  } catch {
    return undefined;
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

function buildPromptOptimizationPrompt(input: PromptOptimizationInput): string {
  return JSON.stringify({
    instruction: [
      "Return JSON only. You are a GEPA-style reflective prompt optimizer for a USD/JPY paper-trading research agent.",
      "Rewrite ONLY the agent's system prompt to improve its realized-PnL-centric scorecard, reflecting on the recent metrics, rejected proposals, and winning proposals provided.",
      "You MUST keep the agent's character/persona, tone, and language (日本語) intact — improve guidance and decision criteria, not the personality.",
      "The required guardrail block (provided verbatim below) MUST appear verbatim and unmodified at the end of optimized_system_prompt. Never weaken risk controls, never relax the Risk Gate, never add tool permissions, never enable live trading or order execution.",
      "Do NOT include shell commands, code, secrets, or capability-expansion instructions.",
      "All natural-language fields (reasoning, key_changes, expected_focus) MUST be written in 日本語.",
    ].join(" "),
    agent: {
      agentName: input.agentName,
      characterId: input.characterId,
      persona: input.persona,
      currentVersion: input.currentVersion,
    },
    currentSystemPrompt: input.currentSystemPrompt,
    requiredGuardrail: input.requiredGuardrail,
    scorecard: input.scorecard,
    recentRejections: input.recentRejections,
    recentWinningProposals: input.recentWinningProposals,
    outputSchema: {
      optimized_system_prompt:
        "string — full rewritten system prompt in 日本語, ending with the required guardrail verbatim",
      reasoning: "string (日本語で記述すること / write in Japanese)",
      key_changes: "array of short strings (日本語) describing each change",
      expected_focus: "string optional (日本語) — what behavior this should improve",
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
