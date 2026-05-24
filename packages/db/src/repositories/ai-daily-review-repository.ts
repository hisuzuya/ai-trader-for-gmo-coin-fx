import type { AiDailyReviewValidationResult } from "@ai-trade/domain/ai-tuning";

import { db } from "../client.js";
import { aiDailyReviews, aiInvocations } from "../schema/index.js";
import { type AiInvocationRecordInput, toAiInvocationInsertRow } from "./ai-tuning-repository.js";

type AiDailyReviewDatabase = Pick<typeof db, "insert" | "transaction">;

export type AiDailyReviewRecordInput = {
  id: string;
  invocationId?: string;
  reviewDate: string;
  validation: AiDailyReviewValidationResult;
};

export class AiDailyReviewRepository {
  constructor(private readonly database: AiDailyReviewDatabase = db) {}

  async recordInvocationAndReview(
    invocation: AiInvocationRecordInput,
    review: AiDailyReviewRecordInput,
  ): Promise<void> {
    await this.database.transaction(async (tx) => {
      await tx.insert(aiInvocations).values(toAiInvocationInsertRow(invocation));
      await tx.insert(aiDailyReviews).values(toAiDailyReviewInsertRow(review));
    });
  }

  async recordReview(input: AiDailyReviewRecordInput): Promise<void> {
    await this.database.insert(aiDailyReviews).values(toAiDailyReviewInsertRow(input));
  }
}

export function toAiDailyReviewInsertRow(input: AiDailyReviewRecordInput) {
  if (input.validation.status === "accepted") {
    return {
      id: input.id,
      invocationId: input.invocationId,
      reviewDate: input.reviewDate,
      status: "accepted" as const,
      summary: input.validation.review.summary,
      baselinePromotionCandidates: input.validation.review.baseline_promotion_candidates,
      candidateRetirementCandidates: input.validation.review.candidate_retirement_candidates,
      warnings: input.validation.review.warnings,
      nextActions: input.validation.review.next_actions,
      rejectReasons: undefined,
    };
  }

  return {
    id: input.id,
    invocationId: input.invocationId,
    reviewDate: input.reviewDate,
    status: "rejected" as const,
    summary: undefined,
    baselinePromotionCandidates: undefined,
    candidateRetirementCandidates: undefined,
    warnings: undefined,
    nextActions: undefined,
    rejectReasons: input.validation.reasons,
  };
}
