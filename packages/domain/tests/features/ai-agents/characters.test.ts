import { describe, expect, it } from "vitest";

import { AGENT_CHARACTERS, CHARACTER_BY_ID, CHARACTER_IDS } from "../../../src/ai-agents/index.js";

describe("agent character cadence defaults", () => {
  it("defines exactly the six crew agents", () => {
    expect(CHARACTER_IDS).toEqual(["ceres", "yura", "noah", "iris", "ragna", "chloe"]);
    expect(AGENT_CHARACTERS).toHaveLength(6);
  });

  it("runs trader and news crew hourly by default", () => {
    expect(CHARACTER_BY_ID.yura.defaultRunIntervalSec).toBe(3_600);
    expect(CHARACTER_BY_ID.noah.defaultRunIntervalSec).toBe(3_600);
    expect(CHARACTER_BY_ID.ragna.defaultRunIntervalSec).toBe(3_600);
    expect(CHARACTER_BY_ID.chloe.defaultRunIntervalSec).toBe(3_600);
  });

  it("keeps the risk auditor manual/event-driven by default", () => {
    expect(CHARACTER_BY_ID.iris.defaultStatus).toBe("paused");
    expect(CHARACTER_BY_ID.iris.defaultRunIntervalSec).toBe(86_400);
  });

  it("runs the skill curator on a slower cadence", () => {
    expect(CHARACTER_BY_ID.ceres.defaultStatus).toBe("active");
    expect(CHARACTER_BY_ID.ceres.defaultRunIntervalSec).toBe(43_200);
  });
});
