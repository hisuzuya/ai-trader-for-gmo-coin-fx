import { describe, expect, it } from "vitest";
import {
  type CanonicalCandle,
  LiveCandleBuilder,
} from "../../../../src/market-data/index.js";

describe("LiveCandleBuilder", () => {
  it("emits closed 1m bid/ask/mid candles when the next minute starts", () => {
    const builder = new LiveCandleBuilder();

    expect(
      builder.addTick(tick("2026-05-24T08:51:10.000Z", 156.1, 156.103)),
    ).toHaveLength(0);
    expect(builder.addTick(tick("2026-05-24T08:51:40.000Z", 156.09, 156.11))).toHaveLength(
      0,
    );

    const closed = builder.addTick(tick("2026-05-24T08:52:00.000Z", 156.12, 156.123));

    expect(closed).toHaveLength(3);
    expect(find(closed, "bid", "1m")).toMatchObject({
      symbol: "USD_JPY",
      timeframe: "1m",
      priceType: "bid",
      openedAt: new Date("2026-05-24T08:51:00.000Z"),
      open: 156.1,
      high: 156.1,
      low: 156.09,
      close: 156.09,
      source: "websocket",
    });
    expect(find(closed, "ask", "1m")).toMatchObject({
      open: 156.103,
      high: 156.11,
      low: 156.103,
      close: 156.11,
      source: "websocket",
    });
    expect(find(closed, "mid", "1m")).toMatchObject({
      open: 156.102,
      high: 156.102,
      low: 156.1,
      close: 156.1,
      source: "derived",
      spreadPips: 2,
    });
  });

  it("derives closed 5m and 15m aggregates from contiguous 1m candles", () => {
    const builder = new LiveCandleBuilder();
    const emitted: CanonicalCandle[] = [];

    for (let minute = 0; minute <= 15; minute += 1) {
      emitted.push(
        ...builder.addTick(
          tick(
            `2026-05-24T08:${String(minute).padStart(2, "0")}:00.000Z`,
            156 + minute / 100,
            156.003 + minute / 100,
          ),
        ),
      );
    }

    const fiveMinuteMid = emitted.filter(
      (candle) => candle.timeframe === "5m" && candle.priceType === "mid",
    );
    const fifteenMinuteMid = emitted.filter(
      (candle) => candle.timeframe === "15m" && candle.priceType === "mid",
    );

    expect(fiveMinuteMid.map((candle) => candle.openedAt.toISOString())).toEqual([
      "2026-05-24T08:00:00.000Z",
      "2026-05-24T08:05:00.000Z",
      "2026-05-24T08:10:00.000Z",
    ]);
    expect(fifteenMinuteMid).toHaveLength(1);
    expect(fifteenMinuteMid[0]).toMatchObject({
      openedAt: new Date("2026-05-24T08:00:00.000Z"),
      open: 156.002,
      close: 156.142,
      source: "derived",
      sourceVersion: "aggregate-15m-from-1m-v1",
    });
  });
});

function tick(timestamp: string, bid: number, ask: number) {
  return {
    symbol: "USD_JPY" as const,
    bid,
    ask,
    timestamp: new Date(timestamp),
  };
}

function find(
  candles: CanonicalCandle[],
  priceType: CanonicalCandle["priceType"],
  timeframe: CanonicalCandle["timeframe"],
): CanonicalCandle {
  const candle = candles.find(
    (candidate) => candidate.priceType === priceType && candidate.timeframe === timeframe,
  );
  if (!candle) {
    throw new Error(`missing ${priceType} ${timeframe} candle`);
  }
  return candle;
}
