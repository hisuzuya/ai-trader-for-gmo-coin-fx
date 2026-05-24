export type MarketSymbol = "USD_JPY";

export type GmoFxPriceType = "BID" | "ASK";
export type CandlePriceType = "bid" | "ask" | "mid";
export type CandleTimeframe = "1m" | "5m" | "15m";
export type CandleSource = "websocket" | "rest_klines" | "derived";

export type GmoFxKlineInterval = "1min" | "5min" | "10min" | "15min" | "30min" | "1hour";

export interface GmoFxStatus {
  status: string;
}

export interface GmoFxTicker {
  symbol: MarketSymbol;
  ask: string;
  bid: string;
  timestamp: string;
  status: "OPEN" | "CLOSE" | string;
}

export interface GmoFxSymbol {
  symbol: MarketSymbol;
  tickSize: string;
  minOpenOrderSize: string;
  maxOrderSize: string;
  sizeStep: string;
}

export interface GmoFxKline {
  openTime: string;
  open: string;
  high: string;
  low: string;
  close: string;
}

export interface GmoFxApiResponse<T> {
  status: number;
  data: T;
  responsetime?: string;
}

export interface UsdJpySymbolRule {
  symbol: MarketSymbol;
  tickSize: number;
  minOpenOrderSize: number;
  maxOrderSize: number;
  sizeStep: number;
  pipSize: number;
}

export interface NormalizedTicker {
  symbol: MarketSymbol;
  bid: number;
  ask: number;
  mid: number;
  spreadPips: number;
  timestamp: Date;
  status: string;
}

export interface CanonicalCandle {
  symbol: MarketSymbol;
  timeframe: CandleTimeframe;
  priceType: CandlePriceType;
  openedAt: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  source: CandleSource;
  sourceVersion: string;
  spreadPips?: number;
}
