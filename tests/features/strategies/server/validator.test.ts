import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type {
  AiStrategyProposal,
  RejectReasonCode,
} from "../../../../src/features/ai-tuning/types.js";
import {
  BASELINE_STRATEGIES,
  baselineStrategies,
} from "../../../../src/features/strategies/server/baselines.js";
import { strategyDefinitionSchema } from "../../../../src/features/strategies/server/schema.js";
import { validateAiStrategyProposal } from "../../../../src/features/strategies/server/validator.js";

const readFixture = (path: string) =>
  readFileSync(new URL(`../../../fixtures/${path}`, import.meta.url), "utf8");

const proposalFrom = (strategy = BASELINE_STRATEGIES["5m"]): AiStrategyProposal => ({
  proposal_id: "proposal-test",
  rationale: "Tune parameters inside the approved Strategy DSL.",
  strategy,
});

const expectRejectedWith = (proposal: unknown, code: RejectReasonCode) => {
  const result = validateAiStrategyProposal(proposal);

  expect(result.status).toBe("rejected");

  if (result.status === "rejected") {
    expect(result.reasons.map((reason) => reason.code)).toContain(code);
  }
};

describe("strategy definition schema", () => {
  it("parses every initial baseline strategy", () => {
    for (const strategy of baselineStrategies) {
      expect(() => strategyDefinitionSchema.parse(strategy)).not.toThrow();
    }
  });
});

describe("AI strategy proposal validation", () => {
  it("accepts the canonical valid AI proposal fixture", () => {
    const result = validateAiStrategyProposal(readFixture("ai/strategy-proposal-valid.json"));

    expect(result.status).toBe("accepted");
  });

  it("rejects the canonical invalid AI proposal fixture with reasons", () => {
    const result = validateAiStrategyProposal(readFixture("ai/strategy-proposal-invalid.json"));

    expect(result.status).toBe("rejected");

    if (result.status === "rejected") {
      expect(result.reasons.length).toBeGreaterThan(0);
    }
  });

  it("accepts a valid strategy proposal JSON", () => {
    const result = validateAiStrategyProposal(JSON.stringify(proposalFrom()));

    expect(result.status).toBe("accepted");

    if (result.status === "accepted") {
      expect(result.proposal.strategy.meta.symbol).toBe("USD_JPY");
      expect(result.proposal.strategy.meta.timeframe).toBe("5m");
    }
  });

  it("rejects invalid JSON with a reason", () => {
    expectRejectedWith("{not json", "invalid_json");
  });

  it("rejects unsupported timeframes", () => {
    expectRejectedWith(
      proposalFrom({
        ...BASELINE_STRATEGIES["5m"],
        meta: { ...BASELINE_STRATEGIES["5m"].meta, timeframe: "30m" as "5m" },
      }),
      "unsupported_timeframe",
    );
  });

  it("rejects unsupported symbols", () => {
    expectRejectedWith(
      proposalFrom({
        ...BASELINE_STRATEGIES["5m"],
        meta: { ...BASELINE_STRATEGIES["5m"].meta, symbol: "EUR_USD" as "USD_JPY" },
      }),
      "unsupported_symbol",
    );
  });

  it("rejects max open positions above two", () => {
    expectRejectedWith(
      proposalFrom({
        ...BASELINE_STRATEGIES["5m"],
        risk: {
          ...BASELINE_STRATEGIES["5m"].risk,
          max_open_positions_per_account: 3,
        },
      }),
      "max_open_positions_exceeded",
    );
  });

  it("rejects reversal entry in the initial implementation", () => {
    expectRejectedWith(
      proposalFrom({
        ...BASELINE_STRATEGIES["5m"],
        exit: {
          ...BASELINE_STRATEGIES["5m"].exit,
          allow_reversal_entry: true as false,
        },
      }),
      "reversal_entry_not_allowed",
    );
  });

  it("rejects unapproved indicators", () => {
    expectRejectedWith(
      proposalFrom({
        ...BASELINE_STRATEGIES["5m"],
        indicators: {
          ...BASELINE_STRATEGIES["5m"].indicators,
          ichimoku: { conversionPeriod: 9 },
        } as (typeof BASELINE_STRATEGIES)["5m"]["indicators"],
      }),
      "unsupported_indicator",
    );
  });

  it("rejects unapproved condition types", () => {
    expectRejectedWith(
      proposalFrom({
        ...BASELINE_STRATEGIES["5m"],
        entry: {
          ...BASELINE_STRATEGIES["5m"].entry,
          long: {
            type: "custom_typescript_condition",
            source: "return close > open",
          } as unknown as (typeof BASELINE_STRATEGIES)["5m"]["entry"]["long"],
        },
      }),
      "unsupported_condition",
    );
  });

  it("rejects parameter values outside approved ranges", () => {
    expectRejectedWith(
      proposalFrom({
        ...BASELINE_STRATEGIES["5m"],
        indicators: {
          ...BASELINE_STRATEGIES["5m"].indicators,
          rsi: { period: 30 },
        },
      }),
      "parameter_out_of_range",
    );
  });

  it("rejects RSI condition thresholds outside approved tuning ranges", () => {
    expectRejectedWith(
      proposalFrom({
        ...BASELINE_STRATEGIES["5m"],
        entry: {
          ...BASELINE_STRATEGIES["5m"].entry,
          long: {
            type: "indicator_threshold",
            indicator: "rsi",
            operator: "<=",
            value: 10,
          },
        },
      }),
      "parameter_out_of_range",
    );
  });

  it("rejects risk gate relaxation", () => {
    expectRejectedWith(
      proposalFrom({
        ...BASELINE_STRATEGIES["5m"],
        risk: {
          ...BASELINE_STRATEGIES["5m"].risk,
          max_daily_loss_jpy: 3000,
        },
      }),
      "risk_gate_relaxed",
    );
  });

  it("rejects forbidden TypeScript or shell capability requests", () => {
    expectRejectedWith(
      proposalFrom({
        ...BASELINE_STRATEGIES["5m"],
        meta: {
          ...BASELINE_STRATEGIES["5m"].meta,
          description: "Generate TypeScript and run shell commands before adopting this.",
        },
      }),
      "forbidden_capability",
    );
  });
});
