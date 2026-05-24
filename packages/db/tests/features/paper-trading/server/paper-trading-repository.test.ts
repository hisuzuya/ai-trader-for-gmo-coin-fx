import type {
  PaperOrderEvent,
  PaperPositionState,
  PaperTradeEvent,
} from "@ai-trade/domain/paper-trading";
import { createPaperAccountState } from "@ai-trade/domain/paper-trading";
import { describe, expect, it } from "vitest";
import {
  toPaperAccountInsertRow,
  toPaperOrderInsertRow,
  toPaperPositionInsertRow,
  toPaperTradeInsertRow,
} from "../../../../src/repositories/paper-trading-repository.js";

describe("paper trading repository row helpers", () => {
  it("converts paper account state to numeric DB strings", () => {
    expect(
      toPaperAccountInsertRow({
        account: createPaperAccountState("account_1", { balanceJpy: 20_016 }),
        name: "baseline_1m",
      }),
    ).toMatchObject({
      id: "account_1",
      name: "baseline_1m",
      currency: "JPY",
      initialBalanceJpy: "20000.000000",
      balanceJpy: "20016.000000",
      leverage: "25.00",
      status: "active",
    });
  });

  it("converts position, order, and trade events without touching the database", () => {
    expect(toPaperPositionInsertRow({ position: basePosition })).toMatchObject({
      id: "position_1",
      accountId: "account_1",
      side: "long",
      quantity: "1000.000000",
      entryPrice: "156.002000",
      stopLossPrice: "155.952000",
      takeProfitPrice: "156.052000",
      spreadPips: "0.4000",
      status: "open",
    });

    expect(toPaperOrderInsertRow({ order: baseOrder })).toMatchObject({
      id: "order_1",
      action: "exit",
      side: "SELL",
      quantity: "1000.000000",
      executionPrice: "156.018000",
      spreadPips: "0.4000",
    });

    expect(toPaperTradeInsertRow({ trade: baseTrade, exitOrderId: "order_1" })).toMatchObject({
      id: "trade_1",
      exitOrderId: "order_1",
      pnlJpy: "16.000000",
      closeReason: "manual_close_signal",
    });
  });

  it("rejects non-finite numeric values before writing", () => {
    expect(() =>
      toPaperPositionInsertRow({
        position: { ...basePosition, entryPrice: Number.NaN },
      }),
    ).toThrow(RangeError);
  });
});

const basePosition = {
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
} satisfies PaperPositionState;

const baseOrder = {
  id: "order_1",
  accountId: "account_1",
  positionId: "position_1",
  symbol: "USD_JPY",
  action: "exit",
  side: "SELL",
  status: "filled",
  quantity: 1000,
  requestedAt: new Date("2026-05-24T00:02:00.000Z"),
  executedAt: new Date("2026-05-24T00:02:00.000Z"),
  executionPrice: 156.018,
  executionReason: "manual_close_signal",
  spreadPips: 0.4,
  spreadSource: "default",
} satisfies PaperOrderEvent;

const baseTrade = {
  id: "trade_1",
  accountId: "account_1",
  positionId: "position_1",
  symbol: "USD_JPY",
  side: "long",
  quantity: 1000,
  entryPrice: 156.002,
  exitPrice: 156.018,
  openedAt: new Date("2026-05-24T00:01:00.000Z"),
  closedAt: new Date("2026-05-24T00:02:00.000Z"),
  pnlJpy: 16,
  closeReason: "manual_close_signal",
} satisfies PaperTradeEvent;
