import { describe, expect, it } from "vitest";

import { validateAiDailyReview } from "../../../../src/ai-tuning/index.js";

describe("validateAiDailyReview", () => {
  it("accepts a structured Daily Review", () => {
    const result = validateAiDailyReview({
      review_date: "2026-05-24",
      summary: "Paper trading is stable.",
      baseline_promotion_candidates: [],
      candidate_retirement_candidates: [],
      warnings: [{ severity: "info", code: "NO_ACTION", message: "No action required." }],
      next_actions: ["Continue paper run."],
    });

    expect(result.status).toBe("accepted");
  });

  it("rejects invalid Daily Review JSON", () => {
    const result = validateAiDailyReview("{");

    expect(result).toMatchObject({
      status: "rejected",
      reasons: [{ code: "invalid_json" }],
    });
  });

  it("accepts a Daily Review inside a JSON code fence", () => {
    const result = validateAiDailyReview(`\`\`\`json
{
  "review_date": "2026-05-24",
  "summary": "Paper trading is stable.",
  "baseline_promotion_candidates": [],
  "candidate_retirement_candidates": [],
  "warnings": [],
  "next_actions": ["Continue paper run."]
}
\`\`\``);

    expect(result.status).toBe("accepted");
  });
});
