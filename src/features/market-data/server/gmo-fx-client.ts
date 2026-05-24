import type {
  GmoFxApiResponse,
  GmoFxKline,
  GmoFxKlineInterval,
  GmoFxPriceType,
  GmoFxStatus,
  GmoFxSymbol,
  GmoFxTicker,
  MarketSymbol,
} from "../types.js";
import {
  parseGmoKlinesResponse,
  parseGmoStatusResponse,
  parseGmoSymbolsResponse,
  parseGmoTickerResponse,
} from "./validation.js";

const DEFAULT_BASE_URL = "https://forex-api.coin.z.com/public/v1";

type FetchLike = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Pick<Response, "ok" | "status" | "statusText" | "json">>;

export interface GmoFxPublicClientOptions {
  baseUrl?: string;
  fetchFn?: FetchLike;
}

export interface GetKlinesParams {
  symbol: MarketSymbol;
  priceType: GmoFxPriceType;
  interval: GmoFxKlineInterval;
  date: string;
}

export class GmoFxPublicClient {
  private readonly baseUrl: string;
  private readonly fetchFn: FetchLike;

  constructor(options: GmoFxPublicClientOptions = {}) {
    this.baseUrl =
      options.baseUrl ??
      process.env.GMO_FX_PUBLIC_REST_BASE_URL ??
      DEFAULT_BASE_URL;
    this.fetchFn = options.fetchFn ?? fetch;
  }

  async getStatus(): Promise<GmoFxApiResponse<GmoFxStatus>> {
    return parseGmoStatusResponse(await this.getJson("/status"));
  }

  async getTicker(): Promise<GmoFxApiResponse<GmoFxTicker[]>> {
    return parseGmoTickerResponse(await this.getJson("/ticker"));
  }

  async getSymbols(): Promise<GmoFxApiResponse<GmoFxSymbol[]>> {
    return parseGmoSymbolsResponse(await this.getJson("/symbols"));
  }

  async getKlines(
    params: GetKlinesParams,
  ): Promise<GmoFxApiResponse<GmoFxKline[]>> {
    assertKlineDate(params.date);
    return parseGmoKlinesResponse(
      await this.getJson("/klines", {
        symbol: params.symbol,
        priceType: params.priceType,
        interval: params.interval,
        date: params.date,
      }),
    );
  }

  private async getJson(
    path: string,
    query?: Record<string, string>,
  ): Promise<unknown> {
    const url = new URL(`${trimTrailingSlash(this.baseUrl)}${path}`);
    for (const [key, value] of Object.entries(query ?? {})) {
      url.searchParams.set(key, value);
    }

    const response = await this.fetchFn(url, { method: "GET" });
    if (!response.ok) {
      throw new Error(
        `GMO FX public REST ${path} failed: ${response.status} ${response.statusText}`,
      );
    }

    return response.json();
  }
}

function assertKlineDate(date: string): void {
  if (!/^\d{8}$/.test(date)) {
    throw new RangeError("GMO FX klines date must be YYYYMMDD");
  }
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}
