import { describe, expect, it, vi } from "vitest";
import { GmoFxPublicClient, MarketDataValidationError } from "../../../../src/market-data/index.js";
import klinesFixture from "../../../fixtures/gmo/klines-response.json" with { type: "json" };
import statusFixture from "../../../fixtures/gmo/status-response.json" with { type: "json" };
import symbolsFixture from "../../../fixtures/gmo/symbols-response.json" with { type: "json" };
import tickerFixture from "../../../fixtures/gmo/ticker-response.json" with { type: "json" };

describe("GmoFxPublicClient", () => {
  it("parses GMO public REST responses with endpoint query parameters", async () => {
    const fetchFn = vi.fn(async (input: string | URL) => {
      const url = new URL(input.toString());
      if (url.pathname.endsWith("/status")) return jsonResponse(statusFixture);
      if (url.pathname.endsWith("/ticker")) return jsonResponse(tickerFixture);
      if (url.pathname.endsWith("/symbols")) return jsonResponse(symbolsFixture);
      if (url.pathname.endsWith("/klines")) {
        expect(url.searchParams.get("symbol")).toBe("USD_JPY");
        expect(url.searchParams.get("priceType")).toBe("BID");
        expect(url.searchParams.get("interval")).toBe("1min");
        expect(url.searchParams.get("date")).toBe("20260524");
        return jsonResponse(klinesFixture);
      }
      throw new Error(`unexpected URL: ${url.toString()}`);
    });
    const client = new GmoFxPublicClient({
      baseUrl: "https://example.test/public/v1/",
      fetchFn,
    });

    await expect(client.getStatus()).resolves.toEqual(statusFixture);
    await expect(client.getTicker()).resolves.toEqual(tickerFixture);
    await expect(client.getSymbols()).resolves.toEqual(symbolsFixture);
    await expect(
      client.getKlines({
        symbol: "USD_JPY",
        priceType: "BID",
        interval: "1min",
        date: "20260524",
      }),
    ).resolves.toEqual(klinesFixture);
    expect(fetchFn).toHaveBeenCalledTimes(4);
  });

  it("rejects malformed responses before returning domain values", async () => {
    const client = new GmoFxPublicClient({
      baseUrl: "https://example.test/public/v1",
      fetchFn: async () =>
        jsonResponse({
          status: 0,
          data: [{ symbol: "USD_JPY", ask: "156.124" }],
        }),
    });

    await expect(client.getTicker()).rejects.toBeInstanceOf(MarketDataValidationError);
  });
});

function jsonResponse(body: unknown) {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    async json() {
      return body;
    },
  };
}
