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

export {
  GmoFxPublicClient,
  type GetKlinesParams,
  type GmoFxPublicClientOptions,
} from "./server/gmo-fx-client.js";
export { aggregateCandles } from "./server/candle-aggregator.js";
export {
  importGmoHistoricalCandles,
  type CandleWriter,
  type HistoricalImportResult,
  type ImportGmoHistoricalCandlesOptions,
} from "./server/historical-importer.js";
export {
  deriveMidCandlesFromBidAsk,
  normalizeGmoKlineToCandle,
  normalizeGmoKlinesToCandles,
} from "./server/normalizer.js";
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
