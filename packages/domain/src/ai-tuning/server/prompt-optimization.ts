import { z } from "zod";

import type {
  AiPromptOptimization,
  AiPromptOptimizationValidationResult,
  RejectReason,
} from "../types.js";

const aiPromptOptimizationSchema = z
  .object({
    optimized_system_prompt: z.string().min(50).max(12000),
    reasoning: z.string().min(1).max(4000),
    key_changes: z.array(z.string().min(1).max(500)).max(30),
    expected_focus: z.string().min(1).max(500).optional(),
  })
  .strict();

/**
 * Phrases that must never appear in an auto-promoted system prompt. They signal
 * the optimizer tried to relax the risk posture or make reckless guarantees.
 */
const FORBIDDEN_PHRASES = [
  "絶対に勝て",
  "絶対勝て",
  "全財産",
  "必ず儲か",
  "必ず勝て",
  "リスクゲートを緩",
  "Risk Gateを緩",
  "リスク管理を無視",
  "損切りを外",
  "損切りなし",
];

export type ValidatePromptOptimizationOptions = {
  /**
   * If provided, the optimized prompt must contain this exact substring. Used to
   * guarantee the safety guardrail survives the rewrite. When the guardrail is
   * missing the optimization is rejected and no version is promoted.
   */
  requiredGuardrail?: string;
};

export const validateAiPromptOptimization = (
  input: unknown,
  options: ValidatePromptOptimizationOptions = {},
): AiPromptOptimizationValidationResult => {
  const jsonResult = parseOptimizationJson(input);

  if (!jsonResult.ok) {
    return { status: "rejected", reasons: [jsonResult.reason] };
  }

  const parsed = aiPromptOptimizationSchema.safeParse(jsonResult.value);

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

  const optimization = parsed.data as AiPromptOptimization;
  const reasons: RejectReason[] = [];
  // The required guardrail itself enumerates these forbidden phrases as things
  // to avoid ("「絶対に勝てる」…を避け…"). Scanning it would always trip the check,
  // so strip the guardrail before scanning — we only want to catch phrases the
  // optimizer introduced in the body or its reasoning. Guardrail presence is
  // verified separately below against the full prompt.
  const promptWithoutGuardrail = options.requiredGuardrail
    ? optimization.optimized_system_prompt.split(options.requiredGuardrail).join("")
    : optimization.optimized_system_prompt;
  const haystack = `${promptWithoutGuardrail}\n${optimization.reasoning}`;

  for (const phrase of FORBIDDEN_PHRASES) {
    if (haystack.includes(phrase)) {
      reasons.push({
        code: "forbidden_capability",
        path: "$.optimized_system_prompt",
        message: `Optimized prompt contains a forbidden phrase: "${phrase}".`,
      });
    }
  }

  if (
    options.requiredGuardrail &&
    !optimization.optimized_system_prompt.includes(options.requiredGuardrail)
  ) {
    reasons.push({
      code: "risk_gate_relaxed",
      path: "$.optimized_system_prompt",
      message: "Optimized prompt dropped the required safety guardrail verbatim.",
    });
  }

  if (reasons.length > 0) {
    return { status: "rejected", reasons };
  }

  return { status: "accepted", optimization };
};

const parseOptimizationJson = (
  input: unknown,
): { ok: true; value: unknown } | { ok: false; reason: RejectReason } => {
  if (typeof input !== "string") {
    return { ok: true, value: input };
  }

  try {
    return { ok: true, value: JSON.parse(stripJsonFence(input)) };
  } catch (error) {
    return {
      ok: false,
      reason: {
        code: "invalid_json",
        path: "$",
        message: error instanceof Error ? error.message : "Prompt optimization is not valid JSON",
      },
    };
  }
};

function stripJsonFence(input: string): string {
  const trimmed = input.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);

  return fenced?.[1] ?? trimmed;
}
