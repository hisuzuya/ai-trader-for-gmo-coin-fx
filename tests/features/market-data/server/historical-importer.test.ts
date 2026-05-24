import { describe, expect, it, vi } from "vitest";
import {
  importGmoHistoricalCandles,
  type CandleWriter,
  type CanonicalCandle,
  type GetKlinesParams,
  type GmoFxApiResponse,
  type GmoFxKline,
  type GmoFxPriceType,
} from "../../../../src/features/market-data/index.js";

describe("importGmoHistoricalCandles", () => {
  it("fetches BID/ASK 1min KLines and plans 1m/5m/15m bid ask mid candles", async () => {
    const writer = new FakeCandleWriter();
    const getKlines = vi.fn(
      async (params: GetKlinesParams) => {
        expect(params.interval).toBe("1min");
        expect(params.date).toBe("20260524");
        return klineResponse(params.priceType);
      },
    );

    const result = await importGmoHistoricalCandles({
      client: { getKlines },
      writer,
      targetDate: "20260524",
    });

    expect(getKlines).toHaveBeenCalledTimes(2);
    expect(getKlines).toHaveBeenCalledWith({
      symbol: "USD_JPY",
      priceType: "BID",
      interval: "1min",
      date: "20260524",
    });
    expect(getKlines).toHaveBeenCalledWith({
      symbol: "USD_JPY",
      priceType: "ASK",
      interval: "1min",
      date: "20260524",
    });

    expect(result).toEqual({
      targetDate: "20260524",
      symbol: "USD_JPY",
      fetchedKlineCount: 30,
      plannedCandleCount: 57,
      counts: {
        fetched: { bid: 15, ask: 15 },
        plannedByTimeframe: { "1m": 45, "5m": 9, "15m": 3 },
        plannedByPriceType: { bid: 19, ask: 19, mid: 19 },
      },
    });
    expect(writer.written).toHaveLength(57);
    expect(writer.written).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          timeframe: "1m",
          priceType: "bid",
          source: "rest_klines",
        }),
        expect.objectContaining({
          timeframe: "1m",
          priceType: "ask",
          source: "rest_klines",
        }),
        expect.objectContaining({
          timeframe: "1m",
          priceType: "mid",
          source: "derived",
        }),
        expect.objectContaining({
          timeframe: "5m",
          priceType: "bid",
          source: "derived",
        }),
        expect.objectContaining({
          timeframe: "15m",
          priceType: "mid",
          source: "derived",
        }),
      ]),
    );
  });

  it("rejects non YYYYMMDD target dates before writing", async () => {
    const writer = new FakeCandleWriter();

    await expect(
      importGmoHistoricalCandles({
        client: { getKlines: vi.fn() },
        writer,
        targetDate: "2026-05-24",
      }),
    ).rejects.toBeInstanceOf(RangeError);
    expect(writer.written).toHaveLength(0);
  });
});

class FakeCandleWriter implements CandleWriter {
  readonly written: CanonicalCandle[] = [];

  async writeCandles(candles: CanonicalCandle[]): Promise<void> {
    this.written.push(...candles);
  }
}

function klineResponse(
  priceType: GmoFxPriceType,
): GmoFxApiResponse<GmoFxKline[]> {
  return {
    status: 0,
    data: Array.from({ length: 15 }, (_, index) => {
      const base = 156.1 + index * 0.01 + (priceType === "ASK" ? 0.003 : 0);
      return {
        openTime: String(Date.UTC(2026, 4, 24, 0, index)),
        open: base.toFixed(3),
        high: (base + 0.004).toFixed(3),
        low: (base - 0.004).toFixed(3),
        close: (base + 0.002).toFixed(3),
      };
    }),
    responsetime: "2026-05-24T08:51:51.000Z",
  };
}
