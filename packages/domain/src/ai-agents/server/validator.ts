import { z } from "zod";

import type { RejectReason } from "../../ai-tuning/types";
import { validateAiStrategyProposal } from "../../strategies/index";
import { strategyDefinitionSchema } from "../../strategies/server/schema";
import type { AgentRunOutput, AgentRunOutputValidationResult } from "../types";

const textArraySchema = z.array(z.string().min(1).max(500)).max(50);
const tagArraySchema = z.array(z.string().min(1).max(80)).max(50);

const observationSchema = z
  .object({
    kind: z.enum(["market", "candidate_performance", "risk", "operations"]),
    summary: z.string().min(1).max(2000),
    evidence: textArraySchema,
    tags: tagArraySchema,
  })
  .strict();

const strategyProposalSchema = z
  .object({
    rationale: z.string().min(1).max(2000),
    strategy: strategyDefinitionSchema,
    expectedEdge: z.string().min(1).max(1000),
    risks: textArraySchema,
    memoryRefs: textArraySchema,
  })
  .strict();

const candidateReviewSchema = z
  .object({
    strategyName: z.string().min(1).max(120),
    recommendation: z.enum(["continue", "retire", "promote"]),
    confidence: z.enum(["low", "medium", "high"]),
    reason: z.string().min(1).max(1000),
    evidence: textArraySchema,
  })
  .strict();

const memoryWriteSchema = z
  .object({
    type: z.enum([
      "market_observation",
      "strategy_hypothesis",
      "proposal_review",
      "rejection_learning",
    ]),
    content: z.string().min(1).max(4000),
    tags: tagArraySchema,
    sourceRefs: textArraySchema,
  })
  .strict();

const japaneseTextSchema = z
  .string()
  .min(1)
  .max(4000)
  .refine((value) => /[\u3040-\u30ff\u3400-\u9fff]/.test(value), {
    message: "Skill text must be written in Japanese.",
  });

const skillWriteIntentSchema = z
  .object({
    title: japaneseTextSchema.max(120),
    body: japaneseTextSchema,
    tags: tagArraySchema,
    sourceRefs: textArraySchema,
    reason: japaneseTextSchema.max(1000),
    desiredScope: z.enum(["private", "shared"]),
  })
  .strict();

const agentRunOutputSchema = z
  .object({
    observations: z.array(observationSchema).max(50),
    strategyProposals: z.array(strategyProposalSchema).max(5),
    candidateReviews: z.array(candidateReviewSchema).max(50),
    memoryWrites: z.array(memoryWriteSchema).max(50),
    skillWriteIntents: z.array(skillWriteIntentSchema).max(10).default([]),
  })
  .strict();

const FORBIDDEN_PATTERNS = [
  /\btypescript\b/i,
  /\bjavascript\b/i,
  /\bnode\b/i,
  /\bshell\b/i,
  /\bbash\b/i,
  /\bexec\b/i,
  /\bchild_process\b/i,
  /\beval\s*\(/i,
  /\bFunction\s*\(/,
  /\bfs\./,
  /\bdb\s*\./i,
  /\bSQL\b/,
  /\bcurl\b/i,
  /\bnpm\s+/i,
  /\bpnpm\s+/i,
];

export const validateAgentRunOutput = (input: unknown): AgentRunOutputValidationResult => {
  const jsonResult = parseAgentOutputJson(input);

  if (!jsonResult.ok) {
    return {
      status: "rejected",
      reasons: [jsonResult.reason],
    };
  }

  const parsed = agentRunOutputSchema.safeParse(jsonResult.value);

  if (!parsed.success) {
    return {
      status: "rejected",
      reasons: parsed.error.issues.map((issue) => ({
        code: "schema_validation_error",
        path: issue.path.length === 0 ? "$" : `$.${issue.path.join(".")}`,
        message: issue.message,
      })),
    };
  }

  const output = parsed.data as AgentRunOutput;
  const reasons = [
    ...findForbiddenCapabilities(output),
    ...output.strategyProposals.flatMap((proposal, index) => {
      const validation = validateAiStrategyProposal({
        rationale: proposal.rationale,
        strategy: proposal.strategy,
      });

      if (validation.status === "accepted") {
        return [];
      }

      return validation.reasons.map((reason) => ({
        ...reason,
        path: `$.strategyProposals.${index}${reason.path === "$" ? "" : `.${reason.path}`}`,
      }));
    }),
  ];

  if (reasons.length > 0) {
    return {
      status: "rejected",
      reasons,
    };
  }

  return {
    status: "accepted",
    output,
  };
};

const parseAgentOutputJson = (
  input: unknown,
):
  | { ok: true; value: unknown }
  | {
      ok: false;
      reason: RejectReason;
    } => {
  if (typeof input !== "string") {
    return { ok: true, value: input };
  }

  const stripped = stripJsonFence(input);
  let lastError: unknown;

  try {
    return { ok: true, value: JSON.parse(stripped) };
  } catch (error) {
    lastError = error;
  }

  // Salvage a JSON object embedded in surrounding prose. Some agents (especially the
  // analysis-heavy roles) prepend a natural-language preamble before the AgentRunOutput
  // object; slice from the first "{" to the last "}" and retry.
  const firstBrace = stripped.indexOf("{");
  const lastBrace = stripped.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    try {
      return { ok: true, value: JSON.parse(stripped.slice(firstBrace, lastBrace + 1)) };
    } catch (error) {
      lastError = error;
    }
  }

  return {
    ok: false,
    reason: {
      code: "invalid_json",
      path: "$",
      message: lastError instanceof Error ? lastError.message : "AI Agent output is not valid JSON",
    },
  };
};

function stripJsonFence(input: string): string {
  const trimmed = input.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);

  return fenced?.[1] ?? trimmed;
}

const findForbiddenCapabilities = (value: unknown): RejectReason[] => {
  const reasons: RejectReason[] = [];

  walkStrings(value, "$", (text, path) => {
    const matched = FORBIDDEN_PATTERNS.find((pattern) => pattern.test(text));

    if (matched) {
      reasons.push({
        code: "forbidden_capability",
        path,
        message: `AI Agent output contains forbidden capability text matching ${matched.source}`,
      });
    }
  });

  return reasons;
};

const walkStrings = (
  value: unknown,
  path: string,
  visit: (text: string, path: string) => void,
): void => {
  if (typeof value === "string") {
    visit(value, path);
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      walkStrings(item, `${path}[${index}]`, visit);
    });
    return;
  }

  if (typeof value === "object" && value !== null) {
    Object.entries(value).forEach(([key, item]) => {
      walkStrings(item, `${path}.${key}`, visit);
    });
  }
};
