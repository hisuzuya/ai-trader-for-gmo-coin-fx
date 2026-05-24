import { z } from "zod";

import type { AiDailyReview, AiDailyReviewValidationResult, RejectReason } from "../types.js";

const recommendationSchema = z
  .object({
    strategyName: z.string().min(1).max(120),
    reason: z.string().min(1).max(1000),
    confidence: z.enum(["low", "medium", "high"]),
  })
  .strict();

const warningSchema = z
  .object({
    severity: z.enum(["info", "warning", "critical"]),
    code: z.string().min(1).max(80),
    message: z.string().min(1).max(1000),
  })
  .strict();

const aiDailyReviewSchema = z
  .object({
    review_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    summary: z.string().min(1).max(4000),
    baseline_promotion_candidates: z.array(recommendationSchema).max(10),
    candidate_retirement_candidates: z.array(recommendationSchema).max(20),
    warnings: z.array(warningSchema).max(20),
    next_actions: z.array(z.string().min(1).max(1000)).max(20),
  })
  .strict();

export const validateAiDailyReview = (input: unknown): AiDailyReviewValidationResult => {
  const jsonResult = parseReviewJson(input);

  if (!jsonResult.ok) {
    return {
      status: "rejected",
      reasons: [jsonResult.reason],
    };
  }

  const parsed = aiDailyReviewSchema.safeParse(jsonResult.value);

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

  return {
    status: "accepted",
    review: parsed.data as AiDailyReview,
  };
};

const parseReviewJson = (
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

  try {
    return { ok: true, value: JSON.parse(stripJsonFence(input)) };
  } catch (error) {
    return {
      ok: false,
      reason: {
        code: "invalid_json",
        path: "$",
        message: error instanceof Error ? error.message : "daily review is not valid JSON",
      },
    };
  }
};

function stripJsonFence(input: string): string {
  const trimmed = input.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);

  return fenced?.[1] ?? trimmed;
}
