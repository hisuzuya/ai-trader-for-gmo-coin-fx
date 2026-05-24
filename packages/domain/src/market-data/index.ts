export { aggregateCandles } from "./server/candle-aggregator.js";

export {
  type GetKlinesParams,
  GmoFxPublicClient,
  type GmoFxPublicClientOptions,
} from "./server/gmo-fx-client.js";
export {
  type CandleWriter,
  type HistoricalImportResult,
  type ImportGmoHistoricalCandlesOptions,
  importGmoHistoricalCandles,
} from "./server/historical-importer.js";
export {
  deriveMidCandlesFromBidAsk,
  normalizeGmoKlinesToCandles,
  normalizeGmoKlineToCandle,
} from "./server/normalizer.js";
export {
  type BidAskTick,
  LiveCandleBuilder,
  type LiveCandleBuilderOptions,
} from "./server/live-candle-builder.js";
export {
  calculateSpreadPips,
  normalizeTicker,
  parseUsdJpySymbolRule,
} from "./server/spread.js";
export {
  MarketDataValidationError,
  parseGmoKlinesResponse,
  parseGmoStatusResponse,
  parseGmoSymbolsResponse,
  parseGmoTickerResponse,
  parseGmoWebSocketTickerMessage,
} from "./server/validation.js";
export type {
  CandlePriceType,
  CandleSource,
  CandleTimeframe,
  CanonicalCandle,
  GmoFxApiResponse,
  GmoFxKline,
  GmoFxKlineInterval,
  GmoFxPriceType,
  GmoFxStatus,
  GmoFxSymbol,
  GmoFxTicker,
  MarketSymbol,
  NormalizedTicker,
  UsdJpySymbolRule,
} from "./types.js";
