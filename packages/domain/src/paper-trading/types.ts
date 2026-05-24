import type { CanonicalCandle, MarketSymbol } from "../market-data/index.js";
import type { StrategyDefinition, StrategyTimeframe } from "../strategies/index.js";

export const PAPER_FIXED_QUANTITY = 1000;
export const PAPER_INITIAL_BALANCE_JPY = 20_000;
export const PAPER_LEVERAGE = 25;
export const USD_JPY_PIP_SIZE = 0.01;

export type PaperTradeSignal = "BUY" | "SELL" | "HOLD" | "CLOSE";
export type PaperPositionSide = "long" | "short";
export type PaperOrderAction = "entry" | "exit";
export type PaperOrderStatus = "filled" | "rejected";
export type PaperSpreadSource = "websocket_bid_ask" | "rest_snapshot" | "default";
export type PaperMarketStatus = "OPEN" | "CLOSE" | string;

export type PaperExecutionReason =
  | "entry_signal"
  | "opposite_signal_exit"
  | "manual_close_signal"
  | "stop_loss"
  | "take_profit"
  | "trailing_stop"
  | "break_even_stop"
  | "stop_loss_priority_same_candle"
  | "risk_rejected";

export interface PaperAccountState {
  id: string;
  balanceJpy: number;
  initialBalanceJpy: number;
  leverage: number;
  currency: "JPY";
  dailyRealizedPnlJpy: number;
}

export interface PaperPositionState {
  id: string;
  accountId: string;
  symbol: MarketSymbol;
  side: PaperPositionSide;
  quantity: 1000;
  entryPrice: number;
  openedAt: Date;
  stopLossPrice: number;
  takeProfitPrice: number;
  trailingStopPips: number;
  breakEvenTriggerPips: number;
  trailingStopPrice?: number;
  breakEvenStopPrice?: number;
  bestPriceSinceOpen: number;
  spreadPips: number;
  spreadSource: PaperSpreadSource;
}

export interface PaperCandleSet {
  mid: CanonicalCandle;
  bid?: CanonicalCandle;
  ask?: CanonicalCandle;
  spreadPips: number;
  spreadSource: PaperSpreadSource;
}

export interface PaperMarketContext {
  status?: PaperMarketStatus;
  timestamp?: Date;
  rolloverAt?: Date;
}

export interface PaperTradingStepInput {
  account: PaperAccountState;
  position?: PaperPositionState;
  strategy: StrategyDefinition;
  signal: PaperTradeSignal;
  nextCandle: PaperCandleSet;
  intrabarCandles?: PaperCandleSet[];
  market?: PaperMarketContext;
}

export interface PaperOrderEvent {
  id: string;
  accountId: string;
  positionId?: string;
  symbol: MarketSymbol;
  action: PaperOrderAction;
  side: "BUY" | "SELL";
  status: PaperOrderStatus;
  quantity: 1000;
  requestedAt: Date;
  executedAt?: Date;
  executionPrice?: number;
  executionReason: PaperExecutionReason;
  spreadPips: number;
  spreadSource: PaperSpreadSource;
  rejectionReason?: string;
}

export interface PaperTradeEvent {
  id: string;
  accountId: string;
  positionId: string;
  symbol: MarketSymbol;
  side: PaperPositionSide;
  quantity: 1000;
  entryPrice: number;
  exitPrice: number;
  openedAt: Date;
  closedAt: Date;
  pnlJpy: number;
  closeReason: PaperExecutionReason;
}

export interface PaperRiskCheckResult {
  allowed: boolean;
  reasons: string[];
  marginUsagePct?: number;
  marginMaintenanceRate?: number;
}

export interface PaperTradingStepResult {
  account: PaperAccountState;
  position?: PaperPositionState;
  orders: PaperOrderEvent[];
  trades: PaperTradeEvent[];
  risk: PaperRiskCheckResult;
}

export interface PaperTradingDefaults {
  initialBalanceJpy: typeof PAPER_INITIAL_BALANCE_JPY;
  leverage: typeof PAPER_LEVERAGE;
  fixedQuantity: typeof PAPER_FIXED_QUANTITY;
  timeframes: Record<
    StrategyTimeframe,
    {
      maxSpreadPips: number;
      takeProfitPips: number;
      stopLossPips: number;
      trailingStopPips: number;
      breakEvenTriggerPips: number;
    }
  >;
}
