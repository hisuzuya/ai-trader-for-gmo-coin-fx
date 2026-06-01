import { describe, expect, it } from "vitest";

import { validateAgentRunOutput } from "../../../src/ai-agents/index.js";

const observation = { kind: "market" as const, summary: "obs", evidence: [], tags: [] };

const buildOutput = (observationCount: number) => ({
  observations: Array.from({ length: observationCount }, () => ({ ...observation })),
  strategyProposals: [],
  candidateReviews: [],
  memoryWrites: [],
});

describe("validateAgentRunOutput array caps", () => {
  it("accepts a minimal valid output", () => {
    const result = validateAgentRunOutput(buildOutput(1));

    expect(result.status).toBe("accepted");
  });

  it("accepts arrays up to the 50-item cap", () => {
    const result = validateAgentRunOutput(buildOutput(50));

    expect(result.status).toBe("accepted");
  });

  it("rejects arrays that exceed the 50-item cap", () => {
    const result = validateAgentRunOutput(buildOutput(51));

    expect(result.status).toBe("rejected");
    if (result.status === "rejected") {
      expect(result.reasons.some((reason) => reason.code === "schema_validation_error")).toBe(true);
    }
  });
});

describe("validateAgentRunOutput JSON salvage", () => {
  it("salvages a JSON object wrapped in natural-language prose", () => {
    const wrapped = `スナップショットを確認しました。\n${JSON.stringify(buildOutput(1))}\n以上が結果です。`;

    const result = validateAgentRunOutput(wrapped);

    expect(result.status).toBe("accepted");
  });

  it("rejects output that contains no JSON object", () => {
    const result = validateAgentRunOutput("スナップショットを確認しましたが、出力はありません。");

    expect(result.status).toBe("rejected");
    if (result.status === "rejected") {
      expect(result.reasons.some((reason) => reason.code === "invalid_json")).toBe(true);
    }
  });
});
