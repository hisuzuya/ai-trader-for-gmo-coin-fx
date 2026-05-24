import { describe, expect, it } from "vitest";
import {
  aggregateCandles,
  type CanonicalCandle,
} from "../../../../src/features/market-data/index.js";
import sampleCandles from "../../../fixtures/candles/usd_jpy_1m_sample.json" with { type: "json" };

describe("aggregateCandles", () => {
  it("aggregates complete 1m candles into 5m candles", () => {
    const aggregated = aggregateCandles(toCandles(sampleCandles), "5m");

    expect(aggregated).toHaveLength(3);
    expect(aggregated[0]).toMatchObject({
      symbol: "USD_JPY",
      timeframe: "5m",
      priceType: "mid",
      openedAt: new Date("2026-05-24T00:00:00.000Z"),
      open: 156.101,
      high: 156.2,
      low: 156.09,
      close: 156.19,
      source: "derived",
    });
  });

  it("aggregates complete 1m candles into 15m candles", () => {
    const aggregated = aggregateCandles(toCandles(sampleCandles), "15m");

    expect(aggregated).toHaveLength(1);
    expect(aggregated[0]).toMatchObject({
      timeframe: "15m",
      openedAt: new Date("2026-05-24T00:00:00.000Z"),
      open: 156.101,
      high: 156.3,
      low: 156.09,
      close: 156.29,
    });
  });

  it("skips incomplete aggregation buckets", () => {
    const aggregated = aggregateCandles(toCandles(sampleCandles).slice(0, 7), "5m");

    expect(aggregated).toHaveLength(1);
    expect(aggregated[0]?.openedAt).toEqual(new Date("2026-05-24T00:00:00.000Z"));
  });
});

function toCandles(rows: typeof sampleCandles): CanonicalCandle[] {
  return rows.map((row) => ({
    ...row,
    openedAt: new Date(row.openedAt),
  })) as CanonicalCandle[];
}
