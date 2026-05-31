import { z } from "zod";

import type { AiSkillCuration, AiSkillCurationValidationResult, RejectReason } from "../types.js";

const skillCurationSchema = z
  .object({
    decisions: z
      .array(
        z
          .object({
            action: z.enum(["promote", "retire"]),
            skill_id: z.string().min(1).max(200),
            reason: z.string().min(1).max(2000),
            confidence: z.enum(["low", "medium", "high"]),
          })
          .strict(),
      )
      .max(100),
    reasoning: z.string().min(1).max(4000),
  })
  .strict();

/**
 * Phrases that must never appear in a curator's justification. They signal the
 * curator is rationalising the promotion of a reckless skill (e.g. promoting a
 * "損切りなし" skill to the shared base). Mirrors the prompt optimizer's guard.
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

export type ValidateSkillCurationOptions = {
  /**
   * The exact set of candidate skill ids the host placed in the prompt. Every
   * decision must reference one of these — ids the model invents are rejected so
   * the deterministic applier never touches a skill it did not surface. When
   * omitted, the id-membership check is skipped (shape validation only).
   */
  allowedSkillIds?: readonly string[];
};

export const validateSkillCuration = (
  input: unknown,
  options: ValidateSkillCurationOptions = {},
): AiSkillCurationValidationResult => {
  const jsonResult = parseCurationJson(input);

  if (!jsonResult.ok) {
    return { status: "rejected", reasons: [jsonResult.reason] };
  }

  const parsed = skillCurationSchema.safeParse(jsonResult.value);

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

  const curation = parsed.data as AiSkillCuration;
  const reasons: RejectReason[] = [];
  const allowed = options.allowedSkillIds ? new Set(options.allowedSkillIds) : null;
  const seen = new Set<string>();

  curation.decisions.forEach((decision, index) => {
    const path = `$.decisions[${index}]`;

    if (allowed && !allowed.has(decision.skill_id)) {
      reasons.push({
        code: "unknown_skill_reference",
        path: `${path}.skill_id`,
        message: `Decision references a skill id that was not offered as a candidate: "${decision.skill_id}".`,
      });
    }

    if (seen.has(decision.skill_id)) {
      reasons.push({
        code: "duplicate_decision",
        path: `${path}.skill_id`,
        message: `Multiple decisions target the same skill id: "${decision.skill_id}".`,
      });
    }
    seen.add(decision.skill_id);

    for (const phrase of FORBIDDEN_PHRASES) {
      if (decision.reason.includes(phrase)) {
        reasons.push({
          code: "forbidden_capability",
          path: `${path}.reason`,
          message: `Curation reason contains a forbidden phrase: "${phrase}".`,
        });
      }
    }
  });

  for (const phrase of FORBIDDEN_PHRASES) {
    if (curation.reasoning.includes(phrase)) {
      reasons.push({
        code: "forbidden_capability",
        path: "$.reasoning",
        message: `Curation reasoning contains a forbidden phrase: "${phrase}".`,
      });
    }
  }

  if (reasons.length > 0) {
    return { status: "rejected", reasons };
  }

  return { status: "accepted", curation };
};

const parseCurationJson = (
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
        message: error instanceof Error ? error.message : "Skill curation is not valid JSON",
      },
    };
  }
};

function stripJsonFence(input: string): string {
  const trimmed = input.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);

  return fenced?.[1] ?? trimmed;
}
