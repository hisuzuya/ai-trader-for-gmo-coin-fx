import { describe, expect, it } from "vitest";
import { BASELINE_STRATEGIES } from "../../../../src/strategies/index.js";
import {
  createPaperAccountState,
  executePaperTradingStep,
  type PaperCandleSet,
  type PaperPositionState,
} from "../../../../src/paper-trading/index.js";

describe("executePaperTradingStep", () => {
  it("opens a fixed quantity long position at the next ask open", () => {
    const result = executePaperTradingStep({
      account: createPaperAccountState("account_1"),
      strategy: BASELINE_STRATEGIES["1m"],
      signal: "BUY",
      nextCandle: candleSet("2026-05-24T00:01:00.000Z", 156, 0.4),
      market: { status: "OPEN" },
    });

    expect(result.position).toMatchObject({
      side: "long",
      quantity: 1000,
      entryPrice: 156.002,
      stopLossPrice: 155.952,
      takeProfitPrice: 156.052,
    });
    expect(result.orders[0]).toMatchObject({
      action: "entry",
      side: "BUY",
      status: "filled",
      executionPrice: 156.002,
      executionReason: "entry_signal",
    });
  });

  it("rejects new entries when spread or market gate fails", () => {
    const result = executePaperTradingStep({
      account: createPaperAccountState("account_1"),
      strategy: BASELINE_STRATEGIES["1m"],
      signal: "SELL",
      nextCandle: candleSet("2026-05-24T00:01:00.000Z", 156, 0.6),
      market: { status: "CLOSE" },
    });

    expect(result.position).toBeUndefined();
    expect(result.risk.allowed).toBe(false);
    expect(result.risk.reasons).toEqual([
      "spread exceeds strategy max_spread_pips",
      "market is closed",
    ]);
    expect(result.orders[0]).toMatchObject({
      status: "rejected",
      executionReason: "risk_rejected",
    });
  });

  it("closes a long position using bid price and records spread-inclusive pnl", () => {
    const position = longPosition({ entryPrice: 156.002 });

    const result = executePaperTradingStep({
      account: createPaperAccountState("account_1"),
      position,
      strategy: BASELINE_STRATEGIES["1m"],
      signal: "CLOSE",
      nextCandle: candleSet("2026-05-24T00:02:00.000Z", 156.02, 0.4),
      market: { status: "OPEN" },
    });

    expect(result.position).toBeUndefined();
    expect(result.orders[0]).toMatchObject({
      action: "exit",
      side: "SELL",
      executionPrice: 156.018,
      executionReason: "manual_close_signal",
    });
    expect(result.trades[0]).toMatchObject({
      pnlJpy: 16,
      exitPrice: 156.018,
    });
    expect(result.account.balanceJpy).toBe(20_016);
  });

  it("uses conservative intrabar stop priority when TP and SL touch in the same 1m candle", () => {
    const position = longPosition({
      entryPrice: 156.002,
      stopLossPrice: 155.952,
      takeProfitPrice: 156.052,
    });

    const result = executePaperTradingStep({
      account: createPaperAccountState("account_1"),
      position,
      strategy: BASELINE_STRATEGIES["1m"],
      signal: "HOLD",
      nextCandle: candleSet("2026-05-24T00:02:00.000Z", 156.01, 0.4),
      intrabarCandles: [
        candleSet("2026-05-24T00:02:00.000Z", 156.01, 0.4, {
          high: 156.06,
          low: 155.95,
        }),
      ],
      market: { status: "OPEN" },
    });

    expect(result.position).toBeUndefined();
    expect(result.orders[0]).toMatchObject({
      executionPrice: 155.952,
      executionReason: "stop_loss_priority_same_candle",
    });
    expect(result.trades[0]?.pnlJpy).toBe(-50);
  });

  it("closes on opposite signal without opening a reversal position in the same step", () => {
    const result = executePaperTradingStep({
      account: createPaperAccountState("account_1"),
      position: longPosition({ entryPrice: 156.002 }),
      strategy: BASELINE_STRATEGIES["1m"],
      signal: "SELL",
      nextCandle: candleSet("2026-05-24T00:02:00.000Z", 156.01, 0.4),
      market: { status: "OPEN" },
    });

    expect(result.position).toBeUndefined();
    expect(result.orders).toHaveLength(1);
    expect(result.orders[0]?.executionReason).toBe("opposite_signal_exit");
  });
});

function candleSet(
  openedAt: string,
  open: number,
  spreadPips: number,
  overrides: Partial<Pick<PaperCandleSet["mid"], "high" | "low" | "close">> = {},
): PaperCandleSet {
  return {
    mid: {
      symbol: "USD_JPY",
      timeframe: "1m",
      priceType: "mid",
      openedAt: new Date(openedAt),
      open,
      high: overrides.high ?? open + 0.01,
      low: overrides.low ?? open - 0.01,
      close: overrides.close ?? open,
      source: "derived",
      sourceVersion: "test",
    },
    spreadPips,
    spreadSource: "default",
  };
}

function longPosition(overrides: Partial<PaperPositionState> = {}): PaperPositionState {
  return {
    id: "position_1",
    accountId: "account_1",
    symbol: "USD_JPY",
    side: "long",
    quantity: 1000,
    entryPrice: 156.002,
    openedAt: new Date("2026-05-24T00:01:00.000Z"),
    stopLossPrice: 155.952,
    takeProfitPrice: 156.052,
    trailingStopPips: 3,
    breakEvenTriggerPips: 2,
    bestPriceSinceOpen: 156.002,
    spreadPips: 0.4,
    spreadSource: "default",
    ...overrides,
  };
}
