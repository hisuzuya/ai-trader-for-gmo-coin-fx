import { describe, expect, it, vi } from "vitest";

import type { CanonicalCandle } from "@ai-trade/domain/market-data";

import { candles } from "../../../../src/schema/index.js";
import {
  CandleRepository,
  toCandleInsertRows,
} from "../../../../src/repositories/candle-repository.js";

describe("CandleRepository", () => {
  it("upserts canonical candles by candle identity", async () => {
    const onConflictDoUpdate = vi.fn().mockResolvedValue(undefined);
    const values = vi.fn(() => ({ onConflictDoUpdate }));
    const insert = vi.fn(() => ({ values }));
    const mockDatabase = {
      insert,
    } as unknown as ConstructorParameters<typeof CandleRepository>[0];
    const repository = new CandleRepository(mockDatabase);

    await repository.upsertMany([baseCandle]);

    expect(insert).toHaveBeenCalledWith(candles);
    expect(values).toHaveBeenCalledWith([
      {
        symbol: "USD_JPY",
        timeframe: "1m",
        priceType: "mid",
        openedAt: new Date("2026-05-24T00:00:00.000Z"),
        open: "156.101000",
        high: "156.200000",
        low: "156.090000",
        close: "156.190000",
        source: "derived",
        sourceVersion: "mid-from-bid-ask-v1",
      },
    ]);
    expect(onConflictDoUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        target: [
          candles.symbol,
          candles.timeframe,
          candles.priceType,
          candles.openedAt,
        ],
        set: expect.objectContaining({
          open: expect.any(Object),
          high: expect.any(Object),
          low: expect.any(Object),
          close: expect.any(Object),
          source: expect.any(Object),
          sourceVersion: expect.any(Object),
          updatedAt: expect.any(Object),
        }),
      }),
    );
  });

  it("does not issue a query for empty input", async () => {
    const insert = vi.fn();
    const mockDatabase = {
      insert,
    } as unknown as ConstructorParameters<typeof CandleRepository>[0];
    const repository = new CandleRepository(mockDatabase);

    await repository.upsertMany([]);

    expect(insert).not.toHaveBeenCalled();
  });

  it("converts number prices to numeric strings with the schema scale", () => {
    expect(toCandleInsertRows([baseCandle])[0]).toMatchObject({
      open: "156.101000",
      high: "156.200000",
      low: "156.090000",
      close: "156.190000",
    });
  });

  it("rejects non-finite numeric values before writing", () => {
    expect(() =>
      toCandleInsertRows([{ ...baseCandle, close: Number.POSITIVE_INFINITY }]),
    ).toThrow(RangeError);
  });

  it("rejects values outside numeric(18, 6) range before writing", () => {
    expect(() =>
      toCandleInsertRows([{ ...baseCandle, close: 1_000_000_000_000 }]),
    ).toThrow(RangeError);
  });
});

const baseCandle = {
  symbol: "USD_JPY",
  timeframe: "1m",
  priceType: "mid",
  openedAt: new Date("2026-05-24T00:00:00.000Z"),
  open: 156.101,
  high: 156.2,
  low: 156.09,
  close: 156.19,
  source: "derived",
  sourceVersion: "mid-from-bid-ask-v1",
} satisfies CanonicalCandle;
