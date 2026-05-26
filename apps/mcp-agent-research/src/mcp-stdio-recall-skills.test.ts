import { describe, expect, it } from "vitest";

import { extractSkills } from "./mcp-stdio-recall-skills.js";

describe("extractSkills", () => {
  it("returns a skill array from structuredContent", () => {
    expect(
      extractSkills({
        structuredContent: {
          result: [{ id: "skill-1", scope: "private", title: "Trend summary" }],
        },
      }),
    ).toEqual([{ id: "skill-1", scope: "private", title: "Trend summary" }]);
  });

  it("preserves an empty skill array", () => {
    expect(
      extractSkills({
        content: [{ type: "text", text: "[]" }],
        structuredContent: { result: [] },
      }),
    ).toEqual([]);
  });
});
