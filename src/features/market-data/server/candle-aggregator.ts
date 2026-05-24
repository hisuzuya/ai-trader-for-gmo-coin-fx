import type { CandleTimeframe, CanonicalCandle } from "../types.js";

const TARGET_MINUTES = {
  "5m": 5,
  "15m": 15,
} as const satisfies Record<Exclude<CandleTimeframe, "1m">, number>;

export function aggregateCandles(
  oneMinuteCandles: CanonicalCandle[],
  targetTimeframe: "5m" | "15m",
): CanonicalCandle[] {
  const targetMinutes = TARGET_MINUTES[targetTimeframe];
  const sorted = [...oneMinuteCandles].sort(
    (left, right) => left.openedAt.getTime() - right.openedAt.getTime(),
  );
  const buckets = new Map<number, CanonicalCandle[]>();

  for (const candle of sorted) {
    if (candle.timeframe !== "1m") {
      throw new RangeError("aggregateCandles only accepts 1m input candles");
    }
    const bucketOpenedAt = floorToUtcMinutes(candle.openedAt, targetMinutes);
    const bucket = buckets.get(bucketOpenedAt) ?? [];
    bucket.push(candle);
    buckets.set(bucketOpenedAt, bucket);
  }

  return [...buckets.entries()]
    .sort(([left], [right]) => left - right)
    .flatMap(([openedAt, bucket]) =>
      bucket.length === targetMinutes
        ? [aggregateBucket(bucket, targetTimeframe, new Date(openedAt))]
        : [],
    );
}

function aggregateBucket(
  bucket: CanonicalCandle[],
  targetTimeframe: "5m" | "15m",
  openedAt: Date,
): CanonicalCandle {
  const [first] = bucket;
  const last = bucket.at(-1);
  if (!first || !last) {
    throw new RangeError("cannot aggregate an empty candle bucket");
  }

  const expectedStepMs = 60_000;
  for (let index = 1; index < bucket.length; index += 1) {
    const previous = bucket[index - 1];
    const current = bucket[index];
    if (!previous || !current) {
      throw new RangeError("bucket contains an empty candle slot");
    }
    if (current.openedAt.getTime() - previous.openedAt.getTime() !== expectedStepMs) {
      throw new RangeError("1m candles must be contiguous");
    }
    if (current.symbol !== first.symbol || current.priceType !== first.priceType) {
      throw new RangeError("cannot aggregate mixed candle identities");
    }
  }

  return {
    symbol: first.symbol,
    timeframe: targetTimeframe,
    priceType: first.priceType,
    openedAt,
    open: first.open,
    high: Math.max(...bucket.map((candle) => candle.high)),
    low: Math.min(...bucket.map((candle) => candle.low)),
    close: last.close,
    source: "derived",
    sourceVersion: `aggregate-${targetTimeframe}-from-1m-v1`,
  };
}

function floorToUtcMinutes(date: Date, minutes: number): number {
  const copy = new Date(date);
  copy.setUTCSeconds(0, 0);
  copy.setUTCMinutes(Math.floor(copy.getUTCMinutes() / minutes) * minutes);
  return copy.getTime();
}
