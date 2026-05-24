import type {
  GmoFxApiResponse,
  GmoFxKline,
  GmoFxStatus,
  GmoFxSymbol,
  GmoFxTicker,
  MarketSymbol,
} from "../types.js";

export class MarketDataValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MarketDataValidationError";
  }
}

type Validator<T> = (value: unknown, path: string) => T;

export function parseGmoStatusResponse(
  value: unknown,
): GmoFxApiResponse<GmoFxStatus> {
  return parseGmoApiResponse(value, parseGmoStatus);
}

export function parseGmoTickerResponse(
  value: unknown,
): GmoFxApiResponse<GmoFxTicker[]> {
  return parseGmoApiResponse(value, arrayOf(parseGmoTicker));
}

export function parseGmoSymbolsResponse(
  value: unknown,
): GmoFxApiResponse<GmoFxSymbol[]> {
  return parseGmoApiResponse(value, arrayOf(parseGmoSymbol));
}

export function parseGmoKlinesResponse(
  value: unknown,
): GmoFxApiResponse<GmoFxKline[]> {
  return parseGmoApiResponse(value, arrayOf(parseGmoKline));
}

function parseGmoApiResponse<T>(
  value: unknown,
  parseData: Validator<T>,
): GmoFxApiResponse<T> {
  const object = record(value, "response");
  const status = number(object.status, "response.status");
  const data = parseData(object.data, "response.data");
  const responsetime =
    object.responsetime === undefined
      ? undefined
      : string(object.responsetime, "response.responsetime");

  return {
    status,
    data,
    ...(responsetime === undefined ? {} : { responsetime }),
  };
}

function parseGmoStatus(value: unknown, path: string): GmoFxStatus {
  const object = record(value, path);
  return { status: string(object.status, `${path}.status`) };
}

function parseGmoTicker(value: unknown, path: string): GmoFxTicker {
  const object = record(value, path);
  return {
    symbol: marketSymbol(object.symbol, `${path}.symbol`),
    ask: decimalString(object.ask, `${path}.ask`),
    bid: decimalString(object.bid, `${path}.bid`),
    timestamp: isoDateString(object.timestamp, `${path}.timestamp`),
    status: string(object.status, `${path}.status`),
  };
}

function parseGmoSymbol(value: unknown, path: string): GmoFxSymbol {
  const object = record(value, path);
  return {
    symbol: marketSymbol(object.symbol, `${path}.symbol`),
    tickSize: decimalString(object.tickSize, `${path}.tickSize`),
    minOpenOrderSize: decimalString(
      object.minOpenOrderSize,
      `${path}.minOpenOrderSize`,
    ),
    maxOrderSize: decimalString(object.maxOrderSize, `${path}.maxOrderSize`),
    sizeStep: decimalString(object.sizeStep, `${path}.sizeStep`),
  };
}

function parseGmoKline(value: unknown, path: string): GmoFxKline {
  const object = record(value, path);
  return {
    openTime: unixMillisecondsString(object.openTime, `${path}.openTime`),
    open: decimalString(object.open, `${path}.open`),
    high: decimalString(object.high, `${path}.high`),
    low: decimalString(object.low, `${path}.low`),
    close: decimalString(object.close, `${path}.close`),
  };
}

function arrayOf<T>(parseItem: Validator<T>): Validator<T[]> {
  return (value, path) => {
    if (!Array.isArray(value)) {
      throw new MarketDataValidationError(`${path} must be an array`);
    }
    return value.map((item, index) => parseItem(item, `${path}[${index}]`));
  };
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new MarketDataValidationError(`${path} must be an object`);
  }
  return value as Record<string, unknown>;
}

function string(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new MarketDataValidationError(`${path} must be a non-empty string`);
  }
  return value;
}

function number(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new MarketDataValidationError(`${path} must be a finite number`);
  }
  return value;
}

function marketSymbol(value: unknown, path: string): MarketSymbol {
  const parsed = string(value, path);
  if (parsed !== "USD_JPY") {
    throw new MarketDataValidationError(`${path} must be USD_JPY`);
  }
  return parsed;
}

function decimalString(value: unknown, path: string): string {
  const parsed = string(value, path);
  if (!/^\d+(?:\.\d+)?$/.test(parsed)) {
    throw new MarketDataValidationError(`${path} must be a decimal string`);
  }
  return parsed;
}

function unixMillisecondsString(value: unknown, path: string): string {
  const parsed = string(value, path);
  if (!/^\d+$/.test(parsed) || !Number.isSafeInteger(Number(parsed))) {
    throw new MarketDataValidationError(
      `${path} must be a Unix timestamp in milliseconds`,
    );
  }
  return parsed;
}

function isoDateString(value: unknown, path: string): string {
  const parsed = string(value, path);
  if (Number.isNaN(Date.parse(parsed))) {
    throw new MarketDataValidationError(`${path} must be an ISO timestamp`);
  }
  return parsed;
}
