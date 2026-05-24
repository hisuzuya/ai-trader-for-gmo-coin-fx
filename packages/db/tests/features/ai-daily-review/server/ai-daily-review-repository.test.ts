import { describe, expect, it } from "vitest";

import {
  type AiDailyReviewRecordInput,
  toAiDailyReviewInsertRow,
} from "../../../../src/repositories/ai-daily-review-repository.js";

describe("AI daily review repository helpers", () => {
  it("maps accepted reviews to a persisted row", () => {
    const row = toAiDailyReviewInsertRow(acceptedReview());

    expect(row).toMatchObject({
      id: "review-1",
      invocationId: "invocation-1",
      reviewDate: "2026-05-24",
      status: "accepted",
      summary: "Paper trading is stable.",
      baselinePromotionCandidates: [],
      candidateRetirementCandidates: [],
      warnings: [{ severity: "info", code: "NO_ACTION", message: "No action required." }],
      nextActions: ["Continue paper run."],
    });
  });

  it("maps rejected reviews with reject reasons", () => {
    const row = toAiDailyReviewInsertRow({
      id: "review-2",
      invocationId: "invocation-2",
      reviewDate: "2026-05-24",
      validation: {
        status: "rejected",
        reasons: [{ code: "invalid_json", path: "$", message: "Unexpected token" }],
      },
    });

    expect(row).toMatchObject({
      id: "review-2",
      status: "rejected",
      summary: undefined,
      rejectReasons: [{ code: "invalid_json", path: "$", message: "Unexpected token" }],
    });
  });
});

function acceptedReview(): AiDailyReviewRecordInput {
  return {
    id: "review-1",
    invocationId: "invocation-1",
    reviewDate: "2026-05-24",
    validation: {
      status: "accepted",
      review: {
        review_date: "2026-05-24",
        summary: "Paper trading is stable.",
        baseline_promotion_candidates: [],
        candidate_retirement_candidates: [],
        warnings: [{ severity: "info", code: "NO_ACTION", message: "No action required." }],
        next_actions: ["Continue paper run."],
      },
    },
  };
}
