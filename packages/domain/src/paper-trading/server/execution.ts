import type { CanonicalCandle } from "../../market-data/index.js";
import type {
  PaperAccountState,
  PaperCandleSet,
  PaperExecutionReason,
  PaperOrderEvent,
  PaperPositionSide,
  PaperPositionState,
  PaperRiskCheckResult,
  PaperTradeEvent,
  PaperTradingDefaults,
  PaperTradingStepInput,
  PaperTradingStepResult,
  PaperTradeSignal,
} from "../types.js";
import {
  PAPER_FIXED_QUANTITY,
  PAPER_INITIAL_BALANCE_JPY,
  PAPER_LEVERAGE,
  USD_JPY_PIP_SIZE,
} from "../types.js";

export const PAPER_TRADING_DEFAULTS: PaperTradingDefaults = {
  initialBalanceJpy: PAPER_INITIAL_BALANCE_JPY,
  leverage: PAPER_LEVERAGE,
  fixedQuantity: PAPER_FIXED_QUANTITY,
  timeframes: {
    "1m": {
      maxSpreadPips: 0.5,
      takeProfitPips: 5,
      stopLossPips: 5,
      trailingStopPips: 3,
      breakEvenTriggerPips: 2,
    },
    "5m": {
      maxSpreadPips: 0.8,
      takeProfitPips: 10,
      stopLossPips: 10,
      trailingStopPips: 5,
      breakEvenTriggerPips: 3,
    },
    "15m": {
      maxSpreadPips: 1,
      takeProfitPips: 20,
      stopLossPips: 15,
      trailingStopPips: 8,
      breakEvenTriggerPips: 6,
    },
  },
};

export function createPaperAccountState(
  id: string,
  overrides: Partial<Omit<PaperAccountState, "id">> = {},
): PaperAccountState {
  return {
    id,
    balanceJpy: PAPER_INITIAL_BALANCE_JPY,
    initialBalanceJpy: PAPER_INITIAL_BALANCE_JPY,
    leverage: PAPER_LEVERAGE,
    currency: "JPY",
    dailyRealizedPnlJpy: 0,
    ...overrides,
  };
}

export function executePaperTradingStep(input: PaperTradingStepInput): PaperTradingStepResult {
  const orders: PaperOrderEvent[] = [];
  const trades: PaperTradeEvent[] = [];
  let account = { ...input.account };
  let position = input.position ? { ...input.position } : undefined;
  const hadPositionAtStart = Boolean(position);
  let risk: PaperRiskCheckResult = { allowed: true, reasons: [] };

  if (position) {
    const exit = findConservativeIntrabarExit(
      position,
      input.intrabarCandles ?? [input.nextCandle],
    );
    if (exit) {
      const closed = closePosition({
        account,
        position,
        candleSet: exit.candleSet,
        reason: exit.reason,
        price: exit.price,
      });
      account = closed.account;
      orders.push(closed.order);
      trades.push(closed.trade);
      position = undefined;
    } else {
      position = updateTrailingState(position, input.intrabarCandles ?? [input.nextCandle]);
    }
  }

  if (position && isCloseSignal(input.signal, position.side)) {
    const closed = closePosition({
      account,
      position,
      candleSet: input.nextCandle,
      reason: input.signal === "CLOSE" ? "manual_close_signal" : "opposite_signal_exit",
    });
    account = closed.account;
    orders.push(closed.order);
    trades.push(closed.trade);
    position = undefined;
  }

  if (!position && !hadPositionAtStart && isEntrySignal(input.signal)) {
    risk = evaluatePaperEntryRisk(input);
    if (risk.allowed) {
      const opened = openPosition(input, input.signal);
      position = opened.position;
      orders.push(opened.order);
    } else {
      orders.push(rejectedEntryOrder(input, input.signal, risk.reasons.join("; ")));
    }
  }

  return { account, position, orders, trades, risk };
}

export function evaluatePaperEntryRisk(input: PaperTradingStepInput): PaperRiskCheckResult {
  const reasons: string[] = [];
  const { bid, ask } = bidAskCandles(input.nextCandle);
  const entryPrice = input.signal === "SELL" ? bid.open : ask.open;
  const requiredMargin = (entryPrice * PAPER_FIXED_QUANTITY) / input.account.leverage;
  const marginUsagePct = (requiredMargin / input.account.balanceJpy) * 100;
  const marginMaintenanceRate = (input.account.balanceJpy / requiredMargin) * 100;
  const risk = input.strategy.risk;

  if (input.position) {
    reasons.push("max_open_positions_per_account exceeded");
  }
  if (risk.lot_sizing.fixed_quantity !== PAPER_FIXED_QUANTITY) {
    reasons.push("paper trading requires fixed quantity 1000");
  }
  if (input.nextCandle.spreadPips > input.strategy.gates.volatility.max_spread_pips) {
    reasons.push("spread exceeds strategy max_spread_pips");
  }
  if (input.market?.status && input.market.status !== "OPEN") {
    reasons.push("market is closed");
  }
  if (isInRolloverBlackout(input)) {
    reasons.push("rollover blackout is active");
  }
  if (marginUsagePct > risk.max_margin_usage_pct) {
    reasons.push("margin usage exceeds max_margin_usage_pct");
  }
  if (marginMaintenanceRate < risk.min_margin_maintenance_rate_for_entry) {
    reasons.push("margin maintenance rate is below entry minimum");
  }
  if (input.account.dailyRealizedPnlJpy <= -risk.max_daily_loss_jpy) {
    reasons.push("daily loss limit reached");
  }
  const maxLossJpy = input.strategy.exit.stop_loss_pips * USD_JPY_PIP_SIZE * PAPER_FIXED_QUANTITY;
  if (maxLossJpy > risk.max_loss_per_trade_jpy) {
    reasons.push("configured stop loss exceeds max_loss_per_trade_jpy");
  }

  return {
    allowed: reasons.length === 0,
    reasons,
    marginUsagePct,
    marginMaintenanceRate,
  };
}

export function bidAskCandles(candleSet: PaperCandleSet): {
  bid: CanonicalCandle;
  ask: CanonicalCandle;
} {
  const halfSpread = (candleSet.spreadPips * USD_JPY_PIP_SIZE) / 2;

  return {
    bid: candleSet.bid ?? shiftCandle(candleSet.mid, -halfSpread, "bid"),
    ask: candleSet.ask ?? shiftCandle(candleSet.mid, halfSpread, "ask"),
  };
}

function openPosition(input: PaperTradingStepInput, signal: "BUY" | "SELL") {
  const { bid, ask } = bidAskCandles(input.nextCandle);
  const side: PaperPositionSide = signal === "BUY" ? "long" : "short";
  const entryPrice = roundPrice(signal === "BUY" ? ask.open : bid.open);
  const stopDistance = input.strategy.exit.stop_loss_pips * USD_JPY_PIP_SIZE;
  const takeProfitDistance = input.strategy.exit.take_profit_pips * USD_JPY_PIP_SIZE;
  const position: PaperPositionState = {
    id: deterministicId("paper_position", input.account.id, input.nextCandle.mid.openedAt, signal),
    accountId: input.account.id,
    symbol: input.strategy.meta.symbol,
    side,
    quantity: PAPER_FIXED_QUANTITY,
    entryPrice,
    openedAt: input.nextCandle.mid.openedAt,
    stopLossPrice: roundPrice(
      side === "long" ? entryPrice - stopDistance : entryPrice + stopDistance,
    ),
    takeProfitPrice: roundPrice(
      side === "long" ? entryPrice + takeProfitDistance : entryPrice - takeProfitDistance,
    ),
    trailingStopPips: input.strategy.exit.trailing_stop_pips,
    breakEvenTriggerPips: input.strategy.exit.break_even_trigger_pips,
    bestPriceSinceOpen: entryPrice,
    spreadPips: input.nextCandle.spreadPips,
    spreadSource: input.nextCandle.spreadSource,
  };
  const order: PaperOrderEvent = {
    id: deterministicId("paper_order", position.id, "entry"),
    accountId: input.account.id,
    positionId: position.id,
    symbol: input.strategy.meta.symbol,
    action: "entry",
    side: signal,
    status: "filled",
    quantity: PAPER_FIXED_QUANTITY,
    requestedAt: input.nextCandle.mid.openedAt,
    executedAt: input.nextCandle.mid.openedAt,
    executionPrice: entryPrice,
    executionReason: "entry_signal",
    spreadPips: input.nextCandle.spreadPips,
    spreadSource: input.nextCandle.spreadSource,
  };

  return { position, order };
}

function closePosition(input: {
  account: PaperAccountState;
  position: PaperPositionState;
  candleSet: PaperCandleSet;
  reason: PaperExecutionReason;
  price?: number;
}) {
  const exitPrice = input.price ?? closePriceAtOpen(input.position, input.candleSet);
  const pnlJpy = calculatePaperPnlJpy(input.position, exitPrice);
  const account = {
    ...input.account,
    balanceJpy: input.account.balanceJpy + pnlJpy,
    dailyRealizedPnlJpy: input.account.dailyRealizedPnlJpy + pnlJpy,
  };
  const order: PaperOrderEvent = {
    id: deterministicId(
      "paper_order",
      input.position.id,
      "exit",
      input.reason,
      input.candleSet.mid.openedAt,
    ),
    accountId: input.position.accountId,
    positionId: input.position.id,
    symbol: input.position.symbol,
    action: "exit",
    side: input.position.side === "long" ? "SELL" : "BUY",
    status: "filled",
    quantity: PAPER_FIXED_QUANTITY,
    requestedAt: input.candleSet.mid.openedAt,
    executedAt: input.candleSet.mid.openedAt,
    executionPrice: exitPrice,
    executionReason: input.reason,
    spreadPips: input.candleSet.spreadPips,
    spreadSource: input.candleSet.spreadSource,
  };
  const trade: PaperTradeEvent = {
    id: deterministicId("paper_trade", input.position.id, input.candleSet.mid.openedAt),
    accountId: input.position.accountId,
    positionId: input.position.id,
    symbol: input.position.symbol,
    side: input.position.side,
    quantity: PAPER_FIXED_QUANTITY,
    entryPrice: input.position.entryPrice,
    exitPrice,
    openedAt: input.position.openedAt,
    closedAt: input.candleSet.mid.openedAt,
    pnlJpy,
    closeReason: input.reason,
  };

  return { account, order, trade };
}

function findConservativeIntrabarExit(
  position: PaperPositionState,
  candles: PaperCandleSet[],
): { candleSet: PaperCandleSet; price: number; reason: PaperExecutionReason } | undefined {
  let current = { ...position };

  for (const candleSet of candles) {
    const { bid, ask } = bidAskCandles(candleSet);
    const stopPrice = effectiveStopPrice(current);

    if (current.side === "long") {
      const stopTouched = bid.low <= stopPrice;
      const takeProfitTouched = bid.high >= current.takeProfitPrice;
      if (stopTouched) {
        return {
          candleSet,
          price: stopPrice,
          reason: takeProfitTouched ? "stop_loss_priority_same_candle" : stopReason(current),
        };
      }
      if (takeProfitTouched) {
        return { candleSet, price: current.takeProfitPrice, reason: "take_profit" };
      }
    } else {
      const stopTouched = ask.high >= stopPrice;
      const takeProfitTouched = ask.low <= current.takeProfitPrice;
      if (stopTouched) {
        return {
          candleSet,
          price: stopPrice,
          reason: takeProfitTouched ? "stop_loss_priority_same_candle" : stopReason(current),
        };
      }
      if (takeProfitTouched) {
        return { candleSet, price: current.takeProfitPrice, reason: "take_profit" };
      }
    }

    current = updateTrailingState(current, [candleSet]);
  }

  return undefined;
}

function updateTrailingState(
  position: PaperPositionState,
  candles: PaperCandleSet[],
): PaperPositionState {
  let updated = { ...position };

  for (const candleSet of candles) {
    const { bid, ask } = bidAskCandles(candleSet);
    if (updated.side === "long") {
      const bestPriceSinceOpen = Math.max(updated.bestPriceSinceOpen, bid.high);
      const favorablePips = (bestPriceSinceOpen - updated.entryPrice) / USD_JPY_PIP_SIZE;
      updated = {
        ...updated,
        bestPriceSinceOpen,
        trailingStopPrice:
          bestPriceSinceOpen - updated.entryPrice >= USD_JPY_PIP_SIZE
            ? roundPrice(bestPriceSinceOpen - updated.trailingStopPips * USD_JPY_PIP_SIZE)
            : updated.trailingStopPrice,
        breakEvenStopPrice:
          favorablePips >= updated.breakEvenTriggerPips
            ? updated.entryPrice
            : updated.breakEvenStopPrice,
      };
    } else {
      const bestPriceSinceOpen = Math.min(updated.bestPriceSinceOpen, ask.low);
      const favorablePips = (updated.entryPrice - bestPriceSinceOpen) / USD_JPY_PIP_SIZE;
      updated = {
        ...updated,
        bestPriceSinceOpen,
        trailingStopPrice:
          updated.entryPrice - bestPriceSinceOpen >= USD_JPY_PIP_SIZE
            ? roundPrice(bestPriceSinceOpen + updated.trailingStopPips * USD_JPY_PIP_SIZE)
            : updated.trailingStopPrice,
        breakEvenStopPrice:
          favorablePips >= updated.breakEvenTriggerPips
            ? updated.entryPrice
            : updated.breakEvenStopPrice,
      };
    }
  }

  return updated;
}

function effectiveStopPrice(position: PaperPositionState): number {
  const candidates = [
    position.stopLossPrice,
    position.trailingStopPrice,
    position.breakEvenStopPrice,
  ].filter((price): price is number => typeof price === "number");

  return position.side === "long" ? Math.max(...candidates) : Math.min(...candidates);
}

function stopReason(position: PaperPositionState): PaperExecutionReason {
  const stopPrice = effectiveStopPrice(position);
  if (position.breakEvenStopPrice === stopPrice) {
    return "break_even_stop";
  }
  if (position.trailingStopPrice === stopPrice) {
    return "trailing_stop";
  }
  return "stop_loss";
}

function closePriceAtOpen(position: PaperPositionState, candleSet: PaperCandleSet): number {
  const { bid, ask } = bidAskCandles(candleSet);
  return roundPrice(position.side === "long" ? bid.open : ask.open);
}

export function calculatePaperPnlJpy(position: PaperPositionState, exitPrice: number): number {
  const priceDelta =
    position.side === "long" ? exitPrice - position.entryPrice : position.entryPrice - exitPrice;
  return Math.round(priceDelta * position.quantity);
}

function rejectedEntryOrder(
  input: PaperTradingStepInput,
  signal: "BUY" | "SELL",
  rejectionReason: string,
): PaperOrderEvent {
  return {
    id: deterministicId(
      "paper_order",
      input.account.id,
      input.nextCandle.mid.openedAt,
      "rejected",
      signal,
    ),
    accountId: input.account.id,
    symbol: input.strategy.meta.symbol,
    action: "entry",
    side: signal,
    status: "rejected",
    quantity: PAPER_FIXED_QUANTITY,
    requestedAt: input.nextCandle.mid.openedAt,
    executionReason: "risk_rejected",
    spreadPips: input.nextCandle.spreadPips,
    spreadSource: input.nextCandle.spreadSource,
    rejectionReason,
  };
}

function shiftCandle(
  candle: CanonicalCandle,
  offset: number,
  priceType: "bid" | "ask",
): CanonicalCandle {
  return {
    ...candle,
    priceType,
    open: roundPrice(candle.open + offset),
    high: roundPrice(candle.high + offset),
    low: roundPrice(candle.low + offset),
    close: roundPrice(candle.close + offset),
    source: "derived",
  };
}

function isEntrySignal(signal: PaperTradeSignal): signal is "BUY" | "SELL" {
  return signal === "BUY" || signal === "SELL";
}

function isCloseSignal(signal: PaperTradeSignal, side: PaperPositionSide): boolean {
  return (
    signal === "CLOSE" ||
    (signal === "BUY" && side === "short") ||
    (signal === "SELL" && side === "long")
  );
}

function isInRolloverBlackout(input: PaperTradingStepInput): boolean {
  if (!input.market?.timestamp || !input.market.rolloverAt) {
    return false;
  }

  const beforeMs = input.strategy.gates.market_time.rollover_blackout_before_minutes * 60_000;
  const afterMs = input.strategy.gates.market_time.rollover_blackout_after_minutes * 60_000;
  const delta = input.market.timestamp.getTime() - input.market.rolloverAt.getTime();

  return delta >= -beforeMs && delta <= afterMs;
}

function deterministicId(prefix: string, ...parts: unknown[]): string {
  const normalizedParts = parts.map((part) =>
    String(part).replaceAll(/[^a-zA-Z0-9]+/g, "_"),
  );
  return `${prefix}_${normalizedParts.join("_")}`;
}

function roundPrice(value: number): number {
  return Number(value.toFixed(6));
}
