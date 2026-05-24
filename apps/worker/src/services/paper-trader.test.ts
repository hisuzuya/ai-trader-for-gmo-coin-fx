import type { CanonicalCandle } from "@ai-trade/domain/market-data";
import type { PaperCandleSet } from "@ai-trade/domain/paper-trading";
import { BASELINE_STRATEGIES, baselineStrategies } from "@ai-trade/domain/strategies";
import { describe, expect, it, vi } from "vitest";

import {
  InMemoryPaperTradingRepository,
  type PaperCandleRepository,
  type PaperStrategyRunner,
  PaperTraderService,
} from "./paper-trader.js";

describe("PaperTraderService", () => {
  it("runs baseline strategies through the paper execution model", async () => {
    const candleRepository = new FakePaperCandleRepository((input) =>
      makeCandleSets(input.timeframe, input.limit),
    );
    const tradingRepository = new InMemoryPaperTradingRepository();
    const strategyRunner: PaperStrategyRunner = {
      evaluate: vi.fn().mockResolvedValue({
        action: "BUY",
        reason: "test buy signal",
      }),
    };
    const service = new PaperTraderService({
      candleRepository,
      tradingRepository,
      strategyRunner,
    });

    await service.start();
    const health = await service.health();

    expect(candleRepository.requests).toEqual([
      {
        symbol: "USD_JPY",
        timeframe: "1m",
        limit: BASELINE_STRATEGIES["1m"].gates.data.min_candle_count + 1,
      },
      {
        symbol: "USD_JPY",
        timeframe: "5m",
        limit: BASELINE_STRATEGIES["5m"].gates.data.min_candle_count + 1,
      },
      {
        symbol: "USD_JPY",
        timeframe: "15m",
        limit: BASELINE_STRATEGIES["15m"].gates.data.min_candle_count + 1,
      },
    ]);
    expect(strategyRunner.evaluate).toHaveBeenCalledTimes(3);
    expect(tradingRepository.steps).toHaveLength(3);
    expect(tradingRepository.steps.map((step) => step.strategy.meta.name)).toEqual([
      "baseline_1m",
      "baseline_5m",
      "baseline_15m",
    ]);
    expect(tradingRepository.steps.every((step) => step.result.orders.length === 1)).toBe(true);
    expect(tradingRepository.steps.every((step) => step.result.orders[0]?.side === "BUY")).toBe(
      true,
    );
    expect(health).toMatchObject({
      name: "paper-trader",
      state: "ready",
      details: {
        strategyCount: 3,
      },
    });
  });

  it("records waiting_for_data without evaluating when candle sets are insufficient", async () => {
    const candleRepository = new FakePaperCandleRepository((input) =>
      makeCandleSets(input.timeframe, input.limit - 1),
    );
    const tradingRepository = new InMemoryPaperTradingRepository();
    const strategyRunner: PaperStrategyRunner = {
      evaluate: vi.fn(),
    };
    const service = new PaperTraderService({
      candleRepository,
      tradingRepository,
      strategyRunner,
    });

    const statuses = await service.runOnce(new Date("2026-05-24T00:05:00.000Z"));

    expect(strategyRunner.evaluate).not.toHaveBeenCalled();
    expect(tradingRepository.steps).toHaveLength(0);
    expect(statuses).toHaveLength(3);
    expect(statuses.every((status) => status.state === "waiting_for_data")).toBe(true);
    expect(statuses[0]).toMatchObject({
      strategyName: "baseline_1m",
      evaluatedAt: "2026-05-24T00:05:00.000Z",
      candleCount: BASELINE_STRATEGIES["1m"].gates.data.min_candle_count,
      requiredCandleCount: BASELINE_STRATEGIES["1m"].gates.data.min_candle_count + 1,
      decision: null,
    });
  });

  it("closes an open paper position on an opposite signal", async () => {
    const candleRepository = new FakePaperCandleRepository((input) =>
      makeCandleSets(input.timeframe, input.limit, 156.03),
    );
    const tradingRepository = new InMemoryPaperTradingRepository();
    const strategy = BASELINE_STRATEGIES["1m"];
    const evaluate = vi
      .fn()
      .mockResolvedValueOnce({ action: "BUY", reason: "seed buy signal" })
      .mockResolvedValueOnce({ action: "SELL", reason: "opposite signal" });
    const service = new PaperTraderService({
      strategies: [strategy],
      candleRepository,
      tradingRepository,
      strategyRunner: {
        evaluate,
      },
    });

    await service.runOnce(new Date("2026-05-24T00:09:00.000Z"));
    const statuses = await service.runOnce(new Date("2026-05-24T00:10:00.000Z"));

    expect(statuses[0]).toMatchObject({
      state: "evaluated",
      orderCount: 1,
      tradeCount: 1,
    });
    expect(tradingRepository.steps.at(-1)?.result.position).toBeUndefined();
    expect(tradingRepository.steps.at(-1)?.result.trades[0]?.closeReason).toBe(
      "opposite_signal_exit",
    );
  });

  it("keeps per-strategy failure status and degrades service health", async () => {
    const candleRepository: PaperCandleRepository = {
      getRecentCandleSets: vi.fn().mockRejectedValue(new Error("candle read failed")),
    };
    const service = new PaperTraderService({
      strategies: [BASELINE_STRATEGIES["1m"]],
      candleRepository,
      tradingRepository: new InMemoryPaperTradingRepository(),
    });

    const statuses = await service.runOnce(new Date("2026-05-24T00:10:00.000Z"));
    const health = await service.health();

    expect(statuses).toEqual([
      expect.objectContaining({
        strategyName: "baseline_1m",
        state: "failed",
        reason: "candle read failed",
      }),
    ]);
    expect(health.state).toBe("degraded");
  });

  it("uses baseline strategies by default", async () => {
    const service = new PaperTraderService({
      candleRepository: new FakePaperCandleRepository((input) =>
        makeCandleSets(input.timeframe, input.limit - 1),
      ),
      tradingRepository: new InMemoryPaperTradingRepository(),
    });

    await service.runOnce();
    const health = await service.health();

    expect(health.details?.strategyCount).toBe(baselineStrategies.length);
  });

  it("schedules recurring paper evaluation after startup", async () => {
    vi.useFakeTimers();
    const candleRepository = new FakePaperCandleRepository((input) =>
      makeCandleSets(input.timeframe, input.limit),
    );
    const service = new PaperTraderService({
      intervalMs: 1_000,
      strategies: [BASELINE_STRATEGIES["1m"]],
      candleRepository,
      tradingRepository: new InMemoryPaperTradingRepository(),
    });

    await service.start();
    await vi.advanceTimersByTimeAsync(1_000);
    await service.stop();
    vi.useRealTimers();

    expect(candleRepository.requests).toHaveLength(2);
  });
});

type CandleRequest = Parameters<PaperCandleRepository["getRecentCandleSets"]>[0];

class FakePaperCandleRepository implements PaperCandleRepository {
  readonly requests: CandleRequest[] = [];

  constructor(private readonly resolver: (input: CandleRequest) => PaperCandleSet[]) {}

  async getRecentCandleSets(input: CandleRequest): Promise<PaperCandleSet[]> {
    this.requests.push(input);
    return this.resolver(input);
  }
}

function makeCandleSets(
  timeframe: CanonicalCandle["timeframe"],
  count: number,
  startPrice = 156,
): PaperCandleSet[] {
  return Array.from({ length: count }, (_, index) => {
    const mid = {
      symbol: "USD_JPY",
      timeframe,
      priceType: "mid",
      openedAt: new Date(Date.UTC(2026, 4, 24, 0, index)),
      open: startPrice + index / 1000,
      high: startPrice + index / 1000 + 0.01,
      low: startPrice + index / 1000 - 0.01,
      close: startPrice + index / 1000 + 0.005,
      source: "derived",
      sourceVersion: "test",
    } satisfies CanonicalCandle;
    return {
      mid,
      spreadPips: 0.3,
      spreadSource: "default",
    };
  });
}
