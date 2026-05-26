import { describe, expect, it } from "vitest";

import { extractSkills } from "./mcp-stdio-recall-skills.js";

describe("extractSkills", () => {
  it("returns direct array results from structuredContent.result", () => {
    const skills = [{ id: "skill-1" }];

    expect(
      extractSkills({
        structuredContent: {
          result: skills,
        },
      }),
    ).toEqual(skills);
  });

  it("returns wrapped skills arrays from structuredContent.result", () => {
    const skills = [{ id: "skill-2" }];

    expect(
      extractSkills({
        structuredContent: {
          result: {
            skills,
          },
        },
      }),
    ).toEqual(skills);
  });

  it("returns direct array results from text content", () => {
    const skills = [{ id: "skill-3" }];

    expect(
      extractSkills({
        content: [{ type: "text", text: JSON.stringify(skills) }],
      }),
    ).toEqual(skills);
  });
});
