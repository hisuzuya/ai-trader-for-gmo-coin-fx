import type { GmoFxSymbol, GmoFxTicker, NormalizedTicker, UsdJpySymbolRule } from "../types.js";

const USD_JPY_PIP_SIZE = 0.01;

export function parseUsdJpySymbolRule(symbol: GmoFxSymbol): UsdJpySymbolRule {
  return {
    symbol: symbol.symbol,
    tickSize: parsePositiveDecimal(symbol.tickSize, "tickSize"),
    minOpenOrderSize: parsePositiveDecimal(symbol.minOpenOrderSize, "minOpenOrderSize"),
    maxOrderSize: parsePositiveDecimal(symbol.maxOrderSize, "maxOrderSize"),
    sizeStep: parsePositiveDecimal(symbol.sizeStep, "sizeStep"),
    pipSize: USD_JPY_PIP_SIZE,
  };
}

export function normalizeTicker(ticker: GmoFxTicker, rule: UsdJpySymbolRule): NormalizedTicker {
  const bid = parsePositiveDecimal(ticker.bid, "bid");
  const ask = parsePositiveDecimal(ticker.ask, "ask");
  if (ask < bid) {
    throw new RangeError("ticker ask must be greater than or equal to bid");
  }

  return {
    symbol: ticker.symbol,
    bid,
    ask,
    mid: roundTo((bid + ask) / 2, decimalPlaces(rule.tickSize)),
    spreadPips: calculateSpreadPips(bid, ask, rule.pipSize),
    timestamp: new Date(ticker.timestamp),
    status: ticker.status,
  };
}

export function calculateSpreadPips(bid: number, ask: number, pipSize = USD_JPY_PIP_SIZE): number {
  if (ask < bid) {
    throw new RangeError("ask must be greater than or equal to bid");
  }
  return roundTo((ask - bid) / pipSize, 6);
}

function parsePositiveDecimal(value: string, name: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new RangeError(`${name} must be a positive decimal`);
  }
  return parsed;
}

function decimalPlaces(value: number): number {
  const text = value.toString();
  const decimal = text.split(".")[1];
  return decimal?.length ?? 0;
}

function roundTo(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}
