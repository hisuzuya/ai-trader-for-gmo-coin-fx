import { describe, expect, it } from "vitest";
import tickerFixture from "../../../fixtures/gmo/ticker-response.json" with { type: "json" };
import symbolsFixture from "../../../fixtures/gmo/symbols-response.json" with { type: "json" };
import klinesFixture from "../../../fixtures/gmo/klines-response.json" with { type: "json" };
import {
  deriveMidCandlesFromBidAsk,
  normalizeGmoKlinesToCandles,
  normalizeTicker,
  parseGmoKlinesResponse,
  parseGmoSymbolsResponse,
  parseGmoTickerResponse,
  parseUsdJpySymbolRule,
} from "../../../../src/market-data/index.js";

describe("market-data normalizer", () => {
  it("parses USD_JPY symbol rules as numeric runtime config", () => {
    const symbol = first(parseGmoSymbolsResponse(symbolsFixture).data);
    const rule = parseUsdJpySymbolRule(symbol);

    expect(rule).toEqual({
      symbol: "USD_JPY",
      tickSize: 0.001,
      minOpenOrderSize: 100,
      maxOrderSize: 500000,
      sizeStep: 1,
      pipSize: 0.01,
    });
  });

  it("normalizes ticker bid/ask into mid and spread_pips", () => {
    const ticker = first(parseGmoTickerResponse(tickerFixture).data);
    const rule = parseUsdJpySymbolRule(
      first(parseGmoSymbolsResponse(symbolsFixture).data),
    );

    expect(normalizeTicker(ticker, rule)).toMatchObject({
      symbol: "USD_JPY",
      bid: 156.121,
      ask: 156.124,
      mid: 156.123,
      spreadPips: 0.3,
      status: "OPEN",
    });
  });

  it("normalizes BID and ASK KLine payloads into canonical 1m candles", () => {
    const bidResponse = parseGmoKlinesResponse(klinesFixture);
    const askResponse = parseGmoKlinesResponse({
      ...klinesFixture,
      data: klinesFixture.data.map((row) => ({
        ...row,
        open: add(row.open, 0.003),
        high: add(row.high, 0.003),
        low: add(row.low, 0.003),
        close: add(row.close, 0.003),
      })),
    });

    const bidCandles = normalizeGmoKlinesToCandles(bidResponse, {
      symbol: "USD_JPY",
      priceType: "BID",
      interval: "1min",
    });
    const askCandles = normalizeGmoKlinesToCandles(askResponse, {
      symbol: "USD_JPY",
      priceType: "ASK",
      interval: "1min",
    });
    const midCandles = deriveMidCandlesFromBidAsk(bidCandles, askCandles);

    expect(bidCandles[0]).toMatchObject({
      symbol: "USD_JPY",
      timeframe: "1m",
      priceType: "bid",
      openedAt: new Date("2026-05-24T00:00:00.000Z"),
      open: 156.1,
      high: 156.13,
      low: 156.09,
      close: 156.12,
      source: "rest_klines",
    });
    expect(askCandles[0]?.priceType).toBe("ask");
    expect(midCandles[0]).toMatchObject({
      priceType: "mid",
      open: 156.102,
      high: 156.132,
      low: 156.092,
      close: 156.122,
      source: "derived",
      spreadPips: 0.3,
    });
  });
});

function add(value: string, delta: number): string {
  return (Number(value) + delta).toFixed(3);
}

function first<T>(values: T[]): T {
  const value = values[0];
  if (!value) {
    throw new Error("fixture must contain at least one row");
  }
  return value;
}
