import { describe, expect, it } from "vitest";

import { extractSkills } from "./mcp-stdio-recall-skills.js";

describe("extractSkills", () => {
  it("returns direct array results from structuredContent.result", () => {
    const skills = [{ id: "skill-1", scope: "private", title: "Title 1", body: "Body 1" }];

    expect(
      extractSkills({
        structuredContent: {
          result: skills,
        },
      }),
    ).toEqual(skills);
  });

  it("returns wrapped skills arrays from structuredContent.result", () => {
    const skills = [{ id: "skill-2", scope: "shared", title: "Title 2", body: "Body 2" }];

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
    const skills = [{ id: "skill-3", scope: "private", title: "Title 3", body: "Body 3" }];

    expect(
      extractSkills({
        content: [{ type: "text", text: JSON.stringify(skills) }],
      }),
    ).toEqual(skills);
  });

  it("returns nested arrays from recursively wrapped result payloads", () => {
    const skills = [{ id: "skill-4", scope: "private", title: "Title", body: "Body", tags: [] }];

    expect(
      extractSkills({
        structuredContent: {
          result: {
            result: skills,
          },
        },
      }),
    ).toEqual(skills);
  });
});
