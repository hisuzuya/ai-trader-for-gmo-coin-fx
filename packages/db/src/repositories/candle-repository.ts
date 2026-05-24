import type { CanonicalCandle } from "@ai-trade/domain/market-data";
import { sql } from "drizzle-orm";

import { db } from "../client.js";
import { candles } from "../schema/index.js";

type CandleDatabase = Pick<typeof db, "insert">;
const NUMERIC_18_6_ABS_LIMIT = 1_000_000_000_000;

export class CandleRepository {
  constructor(private readonly database: CandleDatabase = db) {}

  async upsertMany(canonicalCandles: CanonicalCandle[]): Promise<void> {
    if (canonicalCandles.length === 0) {
      return;
    }

    await this.database
      .insert(candles)
      .values(toCandleInsertRows(canonicalCandles))
      .onConflictDoUpdate({
        target: [candles.symbol, candles.timeframe, candles.priceType, candles.openedAt],
        set: {
          open: sql`excluded.open`,
          high: sql`excluded.high`,
          low: sql`excluded.low`,
          close: sql`excluded.close`,
          source: sql`excluded.source`,
          sourceVersion: sql`excluded.source_version`,
          updatedAt: sql`now()`,
        },
      });
  }
}

export function toCandleInsertRows(canonicalCandles: CanonicalCandle[]) {
  return canonicalCandles.map((candle) => ({
    symbol: candle.symbol,
    timeframe: candle.timeframe,
    priceType: candle.priceType,
    openedAt: candle.openedAt,
    open: toNumericString(candle.open, "open"),
    high: toNumericString(candle.high, "high"),
    low: toNumericString(candle.low, "low"),
    close: toNumericString(candle.close, "close"),
    source: candle.source,
    sourceVersion: candle.sourceVersion,
  }));
}

function toNumericString(value: number, fieldName: string): string {
  if (!Number.isFinite(value)) {
    throw new RangeError(`candle ${fieldName} must be a finite number`);
  }

  if (Math.abs(value) >= NUMERIC_18_6_ABS_LIMIT) {
    throw new RangeError(`candle ${fieldName} exceeds numeric(18, 6) range`);
  }

  return value.toFixed(6);
}
