import type {
  CandleTimeframe,
  CanonicalCandle,
  GmoFxApiResponse,
  GmoFxKline,
  GmoFxKlineInterval,
  GmoFxPriceType,
  MarketSymbol,
} from "../types.js";
import { calculateSpreadPips } from "./spread.js";

const SOURCE_VERSION = "gmo-fx-public-rest-v1";

export function normalizeGmoKlinesToCandles(
  response: GmoFxApiResponse<GmoFxKline[]>,
  options: {
    symbol: MarketSymbol;
    priceType: GmoFxPriceType;
    interval: GmoFxKlineInterval;
  },
): CanonicalCandle[] {
  return response.data.map((kline) =>
    normalizeGmoKlineToCandle(kline, options),
  );
}

export function normalizeGmoKlineToCandle(
  kline: GmoFxKline,
  options: {
    symbol: MarketSymbol;
    priceType: GmoFxPriceType;
    interval: GmoFxKlineInterval;
  },
): CanonicalCandle {
  return {
    symbol: options.symbol,
    timeframe: toCanonicalTimeframe(options.interval),
    priceType: options.priceType.toLowerCase() as "bid" | "ask",
    openedAt: new Date(Number(kline.openTime)),
    open: Number(kline.open),
    high: Number(kline.high),
    low: Number(kline.low),
    close: Number(kline.close),
    source: "rest_klines",
    sourceVersion: SOURCE_VERSION,
  };
}

export function deriveMidCandlesFromBidAsk(
  bidCandles: CanonicalCandle[],
  askCandles: CanonicalCandle[],
): CanonicalCandle[] {
  const askByOpenedAt = new Map(
    askCandles.map((candle) => [candle.openedAt.getTime(), candle]),
  );

  return bidCandles.map((bid) => {
    const ask = askByOpenedAt.get(bid.openedAt.getTime());
    if (!ask) {
      throw new RangeError(
        `missing ASK candle for ${bid.openedAt.toISOString()}`,
      );
    }
    if (
      bid.symbol !== ask.symbol ||
      bid.timeframe !== ask.timeframe ||
      bid.priceType !== "bid" ||
      ask.priceType !== "ask"
    ) {
      throw new RangeError("BID/ASK candles must have matching identity");
    }

    return {
      symbol: bid.symbol,
      timeframe: bid.timeframe,
      priceType: "mid",
      openedAt: bid.openedAt,
      open: midpoint(bid.open, ask.open),
      high: midpoint(bid.high, ask.high),
      low: midpoint(bid.low, ask.low),
      close: midpoint(bid.close, ask.close),
      source: "derived",
      sourceVersion: "bid-ask-mid-v1",
      spreadPips: calculateSpreadPips(bid.close, ask.close),
    };
  });
}

function toCanonicalTimeframe(interval: GmoFxKlineInterval): CandleTimeframe {
  switch (interval) {
    case "1min":
      return "1m";
    case "5min":
      return "5m";
    case "15min":
      return "15m";
    default:
      throw new RangeError(`unsupported canonical candle interval: ${interval}`);
  }
}

function midpoint(left: number, right: number): number {
  return Math.round(((left + right) / 2 + Number.EPSILON) * 1000) / 1000;
}
