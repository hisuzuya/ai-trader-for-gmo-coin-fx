import type { CanonicalCandle } from "@ai-trade/domain/market-data";
import { describe, expect, it, vi } from "vitest";
import {
  CandleRepository,
  toCandleInsertRows,
} from "../../../../src/repositories/candle-repository.js";
import { candles } from "../../../../src/schema/index.js";

function buildSelectMock(rows: unknown[]) {
  const limit = vi.fn().mockResolvedValue(rows);
  const orderBy = vi.fn(() => ({ limit }));
  const where = vi.fn(() => ({ orderBy }));
  const from = vi.fn(() => ({ where }));
  const select = vi.fn(() => ({ from }));
  return { select, from, where, orderBy, limit };
}

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
        target: [candles.symbol, candles.timeframe, candles.priceType, candles.openedAt],
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
    expect(() => toCandleInsertRows([{ ...baseCandle, close: Number.POSITIVE_INFINITY }])).toThrow(
      RangeError,
    );
  });

  it("rejects values outside numeric(18, 6) range before writing", () => {
    expect(() => toCandleInsertRows([{ ...baseCandle, close: 1_000_000_000_000 }])).toThrow(
      RangeError,
    );
  });

  it("returns recent candles oldest-first with numeric prices", async () => {
    const newest = new Date("2026-05-24T00:02:00.000Z");
    const middle = new Date("2026-05-24T00:01:00.000Z");
    const oldest = new Date("2026-05-24T00:00:00.000Z");
    const rows = [
      { openedAt: newest, open: "156.20", high: "156.30", low: "156.18", close: "156.25" },
      { openedAt: middle, open: "156.18", high: "156.22", low: "156.15", close: "156.20" },
      { openedAt: oldest, open: "156.10", high: "156.20", low: "156.09", close: "156.19" },
    ];
    const { select, from, where, orderBy, limit } = buildSelectMock(rows);
    const mockDatabase = {
      select,
    } as unknown as ConstructorParameters<typeof CandleRepository>[0];
    const repository = new CandleRepository(mockDatabase);

    const result = await repository.getRecent({
      symbol: "USD_JPY",
      timeframe: "1m",
      priceType: "mid",
      limit: 200,
    });

    expect(select).toHaveBeenCalledTimes(1);
    expect(from).toHaveBeenCalledWith(candles);
    expect(where).toHaveBeenCalledTimes(1);
    expect(orderBy).toHaveBeenCalledTimes(1);
    expect(limit).toHaveBeenCalledWith(200);
    expect(result).toEqual([
      { openedAt: oldest, open: 156.1, high: 156.2, low: 156.09, close: 156.19 },
      { openedAt: middle, open: 156.18, high: 156.22, low: 156.15, close: 156.2 },
      { openedAt: newest, open: 156.2, high: 156.3, low: 156.18, close: 156.25 },
    ]);
  });

  it("returns an empty array without querying when limit is zero or negative", async () => {
    const { select } = buildSelectMock([]);
    const mockDatabase = {
      select,
    } as unknown as ConstructorParameters<typeof CandleRepository>[0];
    const repository = new CandleRepository(mockDatabase);

    const result = await repository.getRecent({
      symbol: "USD_JPY",
      timeframe: "1m",
      priceType: "mid",
      limit: 0,
    });

    expect(result).toEqual([]);
    expect(select).not.toHaveBeenCalled();
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
