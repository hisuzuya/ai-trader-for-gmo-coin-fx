import { describe, expect, it, vi } from "vitest";

import type {
  CanonicalCandle,
  GetKlinesParams,
  GmoFxApiResponse,
  GmoFxKline,
  GmoFxPriceType,
} from "@/features/market-data";
import { GmoHistoricalImporter } from "@/worker/jobs/historical-importer";

describe("GmoHistoricalImporter", () => {
  it("imports GMO historical klines into the candle repository", async () => {
    const getKlines = vi.fn(async (params: GetKlinesParams) => klineResponse(params.priceType));
    const repository = new FakeCandleRepository();
    const importer = new GmoHistoricalImporter({
      client: { getKlines },
      repository,
    });

    const result = await importer.importDate({ date: "20260524" });

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
    expect(result).toEqual({ importedCandles: 57 });
    expect(repository.upsertMany).toHaveBeenCalledTimes(1);
    expect(repository.written).toHaveLength(57);
    expect(repository.written).toEqual(
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
});

class FakeCandleRepository {
  readonly written: CanonicalCandle[] = [];
  readonly upsertMany = vi.fn(async (candles: CanonicalCandle[]) => {
    this.written.push(...candles);
  });
}

function klineResponse(priceType: GmoFxPriceType): GmoFxApiResponse<GmoFxKline[]> {
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
