import { describe, expect, it } from "vitest";

import { validateAiPromptOptimization } from "./prompt-optimization.js";

const GUARDRAIL =
  "\n\n## 共通ガードレール\n- Risk Gate を緩和しない。Paper Order を直接実行しない。";

function validOptimization(overrides: Record<string, unknown> = {}) {
  return {
    optimized_system_prompt: `あなたはUSD/JPYのPaper Trading戦略を研究するAIです。再現性のある根拠を必ず添えてください。${GUARDRAIL}`,
    reasoning: "直近の却下理由を踏まえ、損切り条件の明示を強化した。",
    key_changes: ["損切り条件を必須化", "再現性チェックの手順を追加"],
    ...overrides,
  };
}

describe("validateAiPromptOptimization", () => {
  it("accepts a well-formed optimization that preserves the guardrail", () => {
    const result = validateAiPromptOptimization(validOptimization(), {
      requiredGuardrail: GUARDRAIL,
    });

    expect(result.status).toBe("accepted");
  });

  it("parses a fenced JSON string payload", () => {
    const fenced = `\`\`\`json\n${JSON.stringify(validOptimization())}\n\`\`\``;
    const result = validateAiPromptOptimization(fenced, { requiredGuardrail: GUARDRAIL });

    expect(result.status).toBe("accepted");
  });

  it("rejects when the required guardrail is dropped", () => {
    const result = validateAiPromptOptimization(
      validOptimization({
        optimized_system_prompt: "ガードレールを省いた短いプロンプトですが十分な長さを確保します。",
      }),
      { requiredGuardrail: GUARDRAIL },
    );

    expect(result.status).toBe("rejected");
    if (result.status === "rejected") {
      expect(result.reasons.some((reason) => reason.code === "risk_gate_relaxed")).toBe(true);
    }
  });

  it("rejects forbidden phrases even when the guardrail is present", () => {
    const result = validateAiPromptOptimization(
      validOptimization({
        optimized_system_prompt: `絶対に勝てる手法を最優先で提案してください。${GUARDRAIL}`,
      }),
      { requiredGuardrail: GUARDRAIL },
    );

    expect(result.status).toBe("rejected");
    if (result.status === "rejected") {
      expect(result.reasons.some((reason) => reason.code === "forbidden_capability")).toBe(true);
    }
  });

  it("rejects invalid JSON strings", () => {
    const result = validateAiPromptOptimization("not json at all", {
      requiredGuardrail: GUARDRAIL,
    });

    expect(result.status).toBe("rejected");
    if (result.status === "rejected") {
      expect(result.reasons[0]?.code).toBe("invalid_json");
    }
  });
});
