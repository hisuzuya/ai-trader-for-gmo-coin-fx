import { CandleRepository } from "@ai-trade/db";

import { readOnlyDb } from "../../data-sources/read-only-db.js";
import { clampLimit } from "../common.js";

export async function readBars(input: {
  symbol: string;
  timeframe: string;
  count: number;
  priceType: "bid" | "ask" | "mid";
}) {
  const candles = await new CandleRepository(readOnlyDb).getRecent({
    symbol: input.symbol,
    timeframe: input.timeframe,
    priceType: input.priceType,
    limit: clampLimit(input.count),
  });

  return candles.map((candle) => ({
    openedAt: candle.openedAt.toISOString(),
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
  }));
}

export async function calcIndicator(input: {
  symbol: string;
  timeframe: string;
  indicator: "sma" | "ema" | "rsi";
  params: { period?: number };
  count: number;
}) {
  const period = Math.max(2, Math.min(100, Number(input.params.period ?? 14)));
  const bars = await readBars({
    symbol: input.symbol,
    timeframe: input.timeframe,
    priceType: "mid",
    count: Math.max(input.count + period, period * 3),
  });
  const closes = bars.map((bar) => bar.close).reverse();
  const values =
    input.indicator === "sma"
      ? simpleMovingAverage(closes, period)
      : input.indicator === "ema"
        ? exponentialMovingAverage(closes, period)
        : relativeStrengthIndex(closes, period);

  return values.slice(-clampLimit(input.count));
}

function simpleMovingAverage(values: number[], period: number) {
  return values.map((_, index) => {
    if (index + 1 < period) {
      return null;
    }

    const slice = values.slice(index + 1 - period, index + 1);
    return slice.reduce((sum, value) => sum + value, 0) / period;
  });
}

function exponentialMovingAverage(values: number[], period: number) {
  const smoothing = 2 / (period + 1);
  let previous = values[0] ?? 0;

  return values.map((value, index) => {
    previous = index === 0 ? value : value * smoothing + previous * (1 - smoothing);
    return previous;
  });
}

function relativeStrengthIndex(values: number[], period: number) {
  return values.map((_, index) => {
    if (index < period) {
      return null;
    }

    const slice = values.slice(index + 1 - period, index + 1);
    let gains = 0;
    let losses = 0;

    for (let i = 1; i < slice.length; i += 1) {
      const delta = slice[i] - slice[i - 1];
      gains += Math.max(delta, 0);
      losses += Math.max(-delta, 0);
    }

    if (losses === 0) {
      return 100;
    }

    const rs = gains / losses;
    return 100 - 100 / (1 + rs);
  });
}
