import { describe, expect, it } from "vitest";

import { BASELINE_STRATEGIES } from "../../strategies/index.js";
import { validateAgentRunOutput } from "./validator.js";

describe("validateAgentRunOutput", () => {
  it("rejects forbidden capability text outside the strategy definition", () => {
    const result = validateAgentRunOutput({
      observations: [],
      strategyProposals: [
        {
          rationale: "スプレッド条件を保守的にする。",
          strategy: {
            ...BASELINE_STRATEGIES["5m"],
            meta: {
              ...BASELINE_STRATEGIES["5m"].meta,
              name: "candidate_forbidden_text",
            },
          },
          expectedEdge: "SQLで直接確認する。",
          risks: [],
          memoryRefs: [],
        },
      ],
      candidateReviews: [],
      memoryWrites: [],
    });

    expect(result.status).toBe("rejected");
    if (result.status === "rejected") {
      expect(result.reasons.some((reason) => reason.code === "forbidden_capability")).toBe(true);
    }
  });
});
