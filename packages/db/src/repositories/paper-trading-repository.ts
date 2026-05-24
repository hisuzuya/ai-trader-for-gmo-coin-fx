import type {
  PaperAccountState,
  PaperOrderEvent,
  PaperPositionState,
  PaperTradeEvent,
} from "@ai-trade/domain/paper-trading";

const NUMERIC_18_6_ABS_LIMIT = 1_000_000_000_000;

export function toPaperAccountInsertRow(input: {
  account: PaperAccountState;
  name: string;
  strategyRunId?: string;
}) {
  return {
    id: input.account.id,
    strategyRunId: input.strategyRunId,
    name: input.name,
    currency: input.account.currency,
    initialBalanceJpy: toNumericString(input.account.initialBalanceJpy, "initialBalanceJpy"),
    balanceJpy: toNumericString(input.account.balanceJpy, "balanceJpy"),
    leverage: input.account.leverage.toFixed(2),
    status: "active" as const,
  };
}

export function toPaperPositionInsertRow(input: {
  position: PaperPositionState;
  strategyRunId?: string;
}) {
  return {
    id: input.position.id,
    accountId: input.position.accountId,
    strategyRunId: input.strategyRunId,
    symbol: input.position.symbol,
    side: input.position.side,
    status: "open" as const,
    quantity: toNumericString(input.position.quantity, "quantity"),
    entryPrice: toNumericString(input.position.entryPrice, "entryPrice"),
    openedAt: input.position.openedAt,
    stopLossPrice: toNumericString(input.position.stopLossPrice, "stopLossPrice"),
    takeProfitPrice: toNumericString(input.position.takeProfitPrice, "takeProfitPrice"),
    trailingStopPrice: optionalNumericString(
      input.position.trailingStopPrice,
      "trailingStopPrice",
    ),
    breakEvenStopPrice: optionalNumericString(
      input.position.breakEvenStopPrice,
      "breakEvenStopPrice",
    ),
    bestPriceSinceOpen: toNumericString(input.position.bestPriceSinceOpen, "bestPriceSinceOpen"),
    spreadPips: toFixedString(input.position.spreadPips, 4, "spreadPips"),
    spreadSource: input.position.spreadSource,
  };
}

export function toPaperOrderInsertRow(input: {
  order: PaperOrderEvent;
  strategyRunId?: string;
}) {
  return {
    id: input.order.id,
    accountId: input.order.accountId,
    strategyRunId: input.strategyRunId,
    positionId: input.order.positionId,
    symbol: input.order.symbol,
    action: input.order.action,
    side: input.order.side,
    status: input.order.status,
    quantity: toNumericString(input.order.quantity, "quantity"),
    requestedAt: input.order.requestedAt,
    executedAt: input.order.executedAt,
    executionPrice: optionalNumericString(input.order.executionPrice, "executionPrice"),
    executionReason: input.order.executionReason,
    spreadPips: toFixedString(input.order.spreadPips, 4, "spreadPips"),
    spreadSource: input.order.spreadSource,
    rejectionReason: input.order.rejectionReason,
  };
}

export function toPaperTradeInsertRow(input: {
  trade: PaperTradeEvent;
  strategyRunId?: string;
  entryOrderId?: string;
  exitOrderId?: string;
}) {
  return {
    id: input.trade.id,
    accountId: input.trade.accountId,
    strategyRunId: input.strategyRunId,
    positionId: input.trade.positionId,
    entryOrderId: input.entryOrderId,
    exitOrderId: input.exitOrderId,
    symbol: input.trade.symbol,
    side: input.trade.side,
    quantity: toNumericString(input.trade.quantity, "quantity"),
    entryPrice: toNumericString(input.trade.entryPrice, "entryPrice"),
    exitPrice: toNumericString(input.trade.exitPrice, "exitPrice"),
    openedAt: input.trade.openedAt,
    closedAt: input.trade.closedAt,
    pnlJpy: toNumericString(input.trade.pnlJpy, "pnlJpy"),
    closeReason: input.trade.closeReason,
  };
}

function optionalNumericString(value: number | undefined, fieldName: string): string | undefined {
  return value === undefined ? undefined : toNumericString(value, fieldName);
}

function toNumericString(value: number, fieldName: string): string {
  return toFixedString(value, 6, fieldName);
}

function toFixedString(value: number, scale: number, fieldName: string): string {
  if (!Number.isFinite(value)) {
    throw new RangeError(`paper trading ${fieldName} must be a finite number`);
  }

  if (Math.abs(value) >= NUMERIC_18_6_ABS_LIMIT) {
    throw new RangeError(`paper trading ${fieldName} exceeds numeric(18, 6) range`);
  }

  return value.toFixed(scale);
}
