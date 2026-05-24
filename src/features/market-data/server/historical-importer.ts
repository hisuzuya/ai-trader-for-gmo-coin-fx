import type {
  CandlePriceType,
  CandleTimeframe,
  CanonicalCandle,
  GmoFxApiResponse,
  GmoFxKline,
  MarketSymbol,
} from "../types.js";
import { aggregateCandles } from "./candle-aggregator.js";
import { GmoFxPublicClient } from "./gmo-fx-client.js";
import {
  deriveMidCandlesFromBidAsk,
  normalizeGmoKlinesToCandles,
} from "./normalizer.js";

type HistoricalImporterClient = Pick<GmoFxPublicClient, "getKlines">;

export interface CandleWriter {
  writeCandles(candles: CanonicalCandle[]): Promise<void>;
}

export interface ImportGmoHistoricalCandlesOptions {
  client?: HistoricalImporterClient;
  writer: CandleWriter;
  symbol?: MarketSymbol;
  targetDate: string;
}

export interface HistoricalImportResult {
  targetDate: string;
  symbol: MarketSymbol;
  fetchedKlineCount: number;
  plannedCandleCount: number;
  counts: {
    fetched: Record<"bid" | "ask", number>;
    plannedByTimeframe: Record<CandleTimeframe, number>;
    plannedByPriceType: Record<CandlePriceType, number>;
  };
}

export async function importGmoHistoricalCandles(
  options: ImportGmoHistoricalCandlesOptions,
): Promise<HistoricalImportResult> {
  const symbol = options.symbol ?? "USD_JPY";
  assertTargetDate(options.targetDate);
  const client = options.client ?? new GmoFxPublicClient();

  const [bidResponse, askResponse] = await Promise.all([
    fetchOneMinuteKlines(client, symbol, "BID", options.targetDate),
    fetchOneMinuteKlines(client, symbol, "ASK", options.targetDate),
  ]);

  const bidOneMinuteCandles = normalizeGmoKlinesToCandles(bidResponse, {
    symbol,
    priceType: "BID",
    interval: "1min",
  });
  const askOneMinuteCandles = normalizeGmoKlinesToCandles(askResponse, {
    symbol,
    priceType: "ASK",
    interval: "1min",
  });
  const midOneMinuteCandles = deriveMidCandlesFromBidAsk(
    bidOneMinuteCandles,
    askOneMinuteCandles,
  );

  const allCandles = [
    ...bidOneMinuteCandles,
    ...askOneMinuteCandles,
    ...midOneMinuteCandles,
    ...aggregateCandles(bidOneMinuteCandles, "5m"),
    ...aggregateCandles(askOneMinuteCandles, "5m"),
    ...aggregateCandles(midOneMinuteCandles, "5m"),
    ...aggregateCandles(bidOneMinuteCandles, "15m"),
    ...aggregateCandles(askOneMinuteCandles, "15m"),
    ...aggregateCandles(midOneMinuteCandles, "15m"),
  ];

  await options.writer.writeCandles(allCandles);

  return {
    targetDate: options.targetDate,
    symbol,
    fetchedKlineCount: bidResponse.data.length + askResponse.data.length,
    plannedCandleCount: allCandles.length,
    counts: {
      fetched: {
        bid: bidResponse.data.length,
        ask: askResponse.data.length,
      },
      plannedByTimeframe: countByTimeframe(allCandles),
      plannedByPriceType: countByPriceType(allCandles),
    },
  };
}

async function fetchOneMinuteKlines(
  client: HistoricalImporterClient,
  symbol: MarketSymbol,
  priceType: "BID" | "ASK",
  targetDate: string,
): Promise<GmoFxApiResponse<GmoFxKline[]>> {
  return client.getKlines({
    symbol,
    priceType,
    interval: "1min",
    date: targetDate,
  });
}

function countByTimeframe(
  candles: CanonicalCandle[],
): Record<CandleTimeframe, number> {
  return {
    "1m": candles.filter((candle) => candle.timeframe === "1m").length,
    "5m": candles.filter((candle) => candle.timeframe === "5m").length,
    "15m": candles.filter((candle) => candle.timeframe === "15m").length,
  };
}

function countByPriceType(
  candles: CanonicalCandle[],
): Record<CandlePriceType, number> {
  return {
    bid: candles.filter((candle) => candle.priceType === "bid").length,
    ask: candles.filter((candle) => candle.priceType === "ask").length,
    mid: candles.filter((candle) => candle.priceType === "mid").length,
  };
}

function assertTargetDate(targetDate: string): void {
  if (!/^\d{8}$/.test(targetDate)) {
    throw new RangeError("historical import targetDate must be YYYYMMDD");
  }
}
