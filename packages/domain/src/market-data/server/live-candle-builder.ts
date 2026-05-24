import type {
  CandlePriceType,
  CanonicalCandle,
  MarketSymbol,
  NormalizedTicker,
} from "../types.js";
import { aggregateCandles } from "./candle-aggregator.js";
import { calculateSpreadPips } from "./spread.js";

const PRICE_TYPES: CandlePriceType[] = ["bid", "ask", "mid"];
const SOURCE_VERSION = "gmo-fx-websocket-candle-builder-v1";

export interface BidAskTick {
  symbol: MarketSymbol;
  bid: number;
  ask: number;
  timestamp: Date;
  mid?: number;
  spreadPips?: number;
}

export interface LiveCandleBuilderOptions {
  sourceVersion?: string;
}

export class LiveCandleBuilder {
  private activeCandles: Record<CandlePriceType, CanonicalCandle> | null = null;
  private recentClosedCandles: Record<CandlePriceType, CanonicalCandle[]> = {
    bid: [],
    ask: [],
    mid: [],
  };

  private readonly sourceVersion: string;

  constructor(options: LiveCandleBuilderOptions = {}) {
    this.sourceVersion = options.sourceVersion ?? SOURCE_VERSION;
  }

  addTick(tick: NormalizedTicker | BidAskTick): CanonicalCandle[] {
    const normalized = normalizeTick(tick);

    if (!this.activeCandles) {
      this.activeCandles = createOneMinuteCandles(normalized, this.sourceVersion);
      return [];
    }

    const activeOpenedAt = this.activeCandles.mid.openedAt.getTime();
    const tickOpenedAt = floorToUtcMinute(normalized.timestamp).getTime();

    if (tickOpenedAt < activeOpenedAt) {
      return [];
    }

    if (tickOpenedAt === activeOpenedAt) {
      updateCandles(this.activeCandles, normalized);
      return [];
    }

    const closed = PRICE_TYPES.map((priceType) => this.activeCandles?.[priceType]).filter(
      (candle): candle is CanonicalCandle => candle !== undefined,
    );
    this.activeCandles = createOneMinuteCandles(normalized, this.sourceVersion);

    for (const candle of closed) {
      const recent = this.recentClosedCandles[candle.priceType];
      recent.push(candle);
      if (recent.length > 15) {
        recent.shift();
      }
    }

    return [...closed, ...this.deriveClosedAggregates(closed)];
  }

  get currentCandleOpenedAt(): Date | null {
    return this.activeCandles?.mid.openedAt ?? null;
  }

  private deriveClosedAggregates(closed: CanonicalCandle[]): CanonicalCandle[] {
    return closed.flatMap((candle) => {
      const aggregates: CanonicalCandle[] = [];

      if (isBucketClose(candle.openedAt, 5)) {
        aggregates.push(...aggregateCandles(this.recentClosedCandles[candle.priceType], "5m"));
      }

      if (isBucketClose(candle.openedAt, 15)) {
        aggregates.push(...aggregateCandles(this.recentClosedCandles[candle.priceType], "15m"));
      }

      return aggregates.filter(
        (aggregate) =>
          aggregate.openedAt.getTime() ===
          bucketOpenedAt(candle.openedAt, timeframeMinutes(aggregate)),
      );
    });
  }
}

function normalizeTick(tick: NormalizedTicker | BidAskTick): Required<BidAskTick> {
  const bid = tick.bid;
  const ask = tick.ask;
  if (!Number.isFinite(bid) || !Number.isFinite(ask)) {
    throw new RangeError("tick bid and ask must be finite numbers");
  }
  if (ask < bid) {
    throw new RangeError("tick ask must be greater than or equal to bid");
  }

  return {
    symbol: tick.symbol,
    bid,
    ask,
    mid: tick.mid ?? midpoint(bid, ask),
    spreadPips: tick.spreadPips ?? calculateSpreadPips(bid, ask),
    timestamp: tick.timestamp,
  };
}

function createOneMinuteCandles(
  tick: Required<BidAskTick>,
  sourceVersion: string,
): Record<CandlePriceType, CanonicalCandle> {
  const openedAt = floorToUtcMinute(tick.timestamp);
  return {
    bid: createCandle(tick, "bid", openedAt, tick.bid, sourceVersion),
    ask: createCandle(tick, "ask", openedAt, tick.ask, sourceVersion),
    mid: {
      ...createCandle(tick, "mid", openedAt, tick.mid, sourceVersion),
      spreadPips: tick.spreadPips,
    },
  };
}

function createCandle(
  tick: Required<BidAskTick>,
  priceType: CandlePriceType,
  openedAt: Date,
  price: number,
  sourceVersion: string,
): CanonicalCandle {
  return {
    symbol: tick.symbol,
    timeframe: "1m",
    priceType,
    openedAt,
    open: price,
    high: price,
    low: price,
    close: price,
    source: priceType === "mid" ? "derived" : "websocket",
    sourceVersion: priceType === "mid" ? "bid-ask-mid-live-v1" : sourceVersion,
  };
}

function updateCandles(
  candles: Record<CandlePriceType, CanonicalCandle>,
  tick: Required<BidAskTick>,
): void {
  updateCandle(candles.bid, tick.bid);
  updateCandle(candles.ask, tick.ask);
  updateCandle(candles.mid, tick.mid);
  candles.mid.spreadPips = tick.spreadPips;
}

function updateCandle(candle: CanonicalCandle, price: number): void {
  candle.high = Math.max(candle.high, price);
  candle.low = Math.min(candle.low, price);
  candle.close = price;
}

function isBucketClose(openedAt: Date, minutes: 5 | 15): boolean {
  return (openedAt.getUTCMinutes() + 1) % minutes === 0;
}

function timeframeMinutes(candle: CanonicalCandle): 5 | 15 {
  if (candle.timeframe === "5m") {
    return 5;
  }
  if (candle.timeframe === "15m") {
    return 15;
  }
  throw new RangeError("expected aggregate candle");
}

function bucketOpenedAt(openedAt: Date, minutes: 5 | 15): number {
  const copy = new Date(openedAt);
  copy.setUTCSeconds(0, 0);
  copy.setUTCMinutes(Math.floor(copy.getUTCMinutes() / minutes) * minutes);
  return copy.getTime();
}

function floorToUtcMinute(date: Date): Date {
  const openedAt = new Date(date);
  openedAt.setUTCSeconds(0, 0);
  return openedAt;
}

function midpoint(bid: number, ask: number): number {
  const scaledBid = Math.round(bid * 1000);
  const scaledAsk = Math.round(ask * 1000);
  return Math.round((scaledBid + scaledAsk) / 2) / 1000;
}
