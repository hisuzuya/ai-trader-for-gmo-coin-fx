import { describe, expect, it } from "vitest";

import { validateSkillCuration } from "../../../../src/ai-tuning/index.js";

const ALLOWED_IDS = ["skill-a", "skill-b", "skill-c"];

function validCuration(overrides: Record<string, unknown> = {}) {
  return {
    decisions: [
      {
        action: "promote",
        skill_id: "skill-a",
        reason: "複数エージェントで再利用された実績があり、共有資産として有用。",
        confidence: "high",
      },
      {
        action: "retire",
        skill_id: "skill-b",
        reason: "前提が変わり、現在のレジームでは矛盾するため archive 推奨。",
        confidence: "medium",
      },
    ],
    reasoning: "重複と陳腐化を整理し、共有スキルの健全性を保つ。",
    ...overrides,
  };
}

describe("validateSkillCuration", () => {
  it("accepts a well-formed curation referencing known candidate ids", () => {
    const result = validateSkillCuration(validCuration(), { allowedSkillIds: ALLOWED_IDS });

    expect(result.status).toBe("accepted");
  });

  it("parses a fenced JSON string payload", () => {
    const fenced = `\`\`\`json\n${JSON.stringify(validCuration())}\n\`\`\``;
    const result = validateSkillCuration(fenced, { allowedSkillIds: ALLOWED_IDS });

    expect(result.status).toBe("accepted");
  });

  it("rejects a decision that references a skill id outside the candidate set", () => {
    const result = validateSkillCuration(
      validCuration({
        decisions: [
          {
            action: "promote",
            skill_id: "skill-invented",
            reason: "本文を見ずに勝手に作った id。",
            confidence: "low",
          },
        ],
      }),
      { allowedSkillIds: ALLOWED_IDS },
    );

    expect(result.status).toBe("rejected");
    if (result.status === "rejected") {
      expect(result.reasons.some((reason) => reason.code === "unknown_skill_reference")).toBe(true);
    }
  });

  it("rejects duplicate decisions targeting the same skill id", () => {
    const result = validateSkillCuration(
      validCuration({
        decisions: [
          {
            action: "promote",
            skill_id: "skill-a",
            reason: "昇格したい。",
            confidence: "high",
          },
          {
            action: "retire",
            skill_id: "skill-a",
            reason: "やっぱり退役したい。",
            confidence: "low",
          },
        ],
      }),
      { allowedSkillIds: ALLOWED_IDS },
    );

    expect(result.status).toBe("rejected");
    if (result.status === "rejected") {
      expect(result.reasons.some((reason) => reason.code === "duplicate_decision")).toBe(true);
    }
  });

  it("rejects forbidden phrases in a decision reason", () => {
    const result = validateSkillCuration(
      validCuration({
        decisions: [
          {
            action: "promote",
            skill_id: "skill-c",
            reason: "損切りなしでも勝てるので共有すべき。",
            confidence: "high",
          },
        ],
      }),
      { allowedSkillIds: ALLOWED_IDS },
    );

    expect(result.status).toBe("rejected");
    if (result.status === "rejected") {
      expect(result.reasons.some((reason) => reason.code === "forbidden_capability")).toBe(true);
    }
  });

  it("rejects an unsupported action via schema validation", () => {
    const result = validateSkillCuration(
      validCuration({
        decisions: [
          {
            action: "merge",
            skill_id: "skill-a",
            reason: "まだ未対応のアクション。",
            confidence: "low",
          },
        ],
      }),
      { allowedSkillIds: ALLOWED_IDS },
    );

    expect(result.status).toBe("rejected");
    if (result.status === "rejected") {
      expect(result.reasons.some((reason) => reason.code === "schema_validation_error")).toBe(true);
    }
  });

  it("rejects invalid JSON strings", () => {
    const result = validateSkillCuration("not json at all", { allowedSkillIds: ALLOWED_IDS });

    expect(result.status).toBe("rejected");
    if (result.status === "rejected") {
      expect(result.reasons[0]?.code).toBe("invalid_json");
    }
  });
});
