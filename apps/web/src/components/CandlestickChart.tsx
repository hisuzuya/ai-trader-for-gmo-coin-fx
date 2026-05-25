"use client";

import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  createChart,
  type IChartApi,
  type ISeriesApi,
  LineStyle,
  type UTCTimestamp,
} from "lightweight-charts";
import { useCallback, useEffect, useRef, useState } from "react";

export type CandlePoint = {
  time: UTCTimestamp;
  open: number;
  high: number;
  low: number;
  close: number;
};

type CandlestickChartProps = {
  data: CandlePoint[];
  query?: {
    symbol: string;
    timeframe: string;
    priceType: "bid" | "ask" | "mid";
  };
  initialLimit?: number;
};

type CandleApiResponse = {
  ok?: boolean;
  symbol?: string;
  timeframe?: string;
  priceType?: string;
  candles?: {
    openedAt: string;
    open: number;
    high: number;
    low: number;
    close: number;
  }[];
  error?: string;
};

const LOAD_MORE_LIMIT = 500;

export function CandlestickChart({
  data,
  query,
  initialLimit = data.length,
}: CandlestickChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const visibleLogicalRangeRef = useRef<{ from: number; to: number } | null>(null);
  const pendingPrependCountRef = useRef(0);
  const shouldFitContentRef = useRef(true);
  const seriesDataRef = useRef(data);
  const hasMoreRef = useRef(true);
  const loadingRef = useRef(false);
  const loadOlderRef = useRef<() => Promise<void>>(async () => {});
  const [seriesData, setSeriesData] = useState(data);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const normalized = mergeCandlePoints([], data);
    seriesDataRef.current = normalized;
    setSeriesData(normalized);
    const moreAvailable = normalized.length >= initialLimit;
    hasMoreRef.current = moreAvailable;
    shouldFitContentRef.current = true;
    pendingPrependCountRef.current = 0;
  }, [data, initialLimit]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const chart = createChart(container, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "#787b86",
        fontFamily: "'JetBrains Mono', 'SF Mono', 'Menlo', 'Consolas', monospace",
        fontSize: 11,
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: "#1f2330", style: LineStyle.Solid },
        horzLines: { color: "#1f2330", style: LineStyle.Solid },
      },
      rightPriceScale: {
        borderColor: "#2a2e39",
        scaleMargins: { top: 0.08, bottom: 0.08 },
      },
      timeScale: {
        borderColor: "#2a2e39",
        timeVisible: true,
        secondsVisible: false,
      },
      crosshair: {
        mode: CrosshairMode.Magnet,
        vertLine: {
          color: "#565a66",
          width: 1,
          style: LineStyle.Dashed,
          labelBackgroundColor: "#2962ff",
        },
        horzLine: {
          color: "#565a66",
          width: 1,
          style: LineStyle.Dashed,
          labelBackgroundColor: "#2962ff",
        },
      },
      handleScroll: true,
      handleScale: true,
    });
    chartRef.current = chart;

    const series = chart.addSeries(CandlestickSeries, {
      upColor: "#26a69a",
      downColor: "#ef5350",
      borderUpColor: "#26a69a",
      borderDownColor: "#ef5350",
      wickUpColor: "#26a69a",
      wickDownColor: "#ef5350",
      priceFormat: {
        type: "price",
        precision: 3,
        minMove: 0.001,
      },
    });
    seriesRef.current = series;
    series.setData(seriesDataRef.current);
    chart.timeScale().fitContent();

    const handleLogicalRangeChange = (range: { from: number; to: number } | null) => {
      visibleLogicalRangeRef.current = range;
      const currentLength = seriesDataRef.current.length;
      if (range && range.from < 20 && range.to < currentLength - 20) {
        void loadOlderRef.current();
      }
    };
    chart.timeScale().subscribeVisibleLogicalRangeChange(handleLogicalRangeChange);

    return () => {
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(handleLogicalRangeChange);
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, []);

  useEffect(() => {
    seriesDataRef.current = seriesData;
    seriesRef.current?.setData(seriesData);

    const chart = chartRef.current;
    if (!chart) return;

    const addedCount = pendingPrependCountRef.current;
    const previousRange = visibleLogicalRangeRef.current;

    if (addedCount > 0 && previousRange) {
      chart.timeScale().setVisibleLogicalRange({
        from: previousRange.from + addedCount,
        to: previousRange.to + addedCount,
      });
      pendingPrependCountRef.current = 0;
      return;
    }

    if (shouldFitContentRef.current) {
      chart.timeScale().fitContent();
      shouldFitContentRef.current = false;
    }
  }, [seriesData]);

  const loadOlder = useCallback(async () => {
    if (!query || loadingRef.current || !hasMoreRef.current) return;

    const currentData = seriesDataRef.current;
    const oldest = currentData[0];
    if (!oldest) return;

    loadingRef.current = true;
    setError(null);

    try {
      const before = new Date(oldest.time * 1000).toISOString();
      const response = await fetchCandles(query, LOAD_MORE_LIMIT, before);
      const incoming = toCandlePoints(response);
      const merged = mergeCandlePoints(incoming, currentData);
      const addedCount = merged.length - currentData.length;

      if (addedCount > 0) {
        pendingPrependCountRef.current += addedCount;
        setSeriesData(merged);
      }

      const moreAvailable = addedCount > 0 && incoming.length >= LOAD_MORE_LIMIT;
      hasMoreRef.current = moreAvailable;
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Candle lookup failed.");
    } finally {
      loadingRef.current = false;
    }
  }, [query]);

  useEffect(() => {
    loadOlderRef.current = loadOlder;
  }, [loadOlder]);

  return (
    <div className="tv-chart-frame">
      <div ref={containerRef} className="tv-chart-container tv-chart-container-tall" />
      {error ? <div className="tv-chart-load-error">{error}</div> : null}
    </div>
  );
}

async function fetchCandles(
  query: NonNullable<CandlestickChartProps["query"]>,
  limit: number,
  before?: string,
) {
  const url = new URL("/api/candles", window.location.origin);
  url.searchParams.set("symbol", query.symbol);
  url.searchParams.set("timeframe", query.timeframe);
  url.searchParams.set("priceType", query.priceType);
  url.searchParams.set("limit", String(limit));
  if (before) {
    url.searchParams.set("before", before);
  }

  const response = await fetch(url, { cache: "no-store" });
  const body = (await response.json()) as CandleApiResponse;

  if (!response.ok || body.ok === false) {
    throw new Error(body.error ?? "Candle lookup failed.");
  }

  return body;
}

function toCandlePoints(response: CandleApiResponse): CandlePoint[] {
  return mergeCandlePoints(
    [],
    (response.candles ?? [])
      .map((candle) => {
        const ms = new Date(candle.openedAt).getTime();
        if (
          Number.isNaN(ms) ||
          !Number.isFinite(candle.open) ||
          !Number.isFinite(candle.high) ||
          !Number.isFinite(candle.low) ||
          !Number.isFinite(candle.close)
        ) {
          return null;
        }

        return {
          time: Math.floor(ms / 1000) as UTCTimestamp,
          open: candle.open,
          high: candle.high,
          low: candle.low,
          close: candle.close,
        };
      })
      .filter((point): point is CandlePoint => point !== null),
  );
}

function mergeCandlePoints(...sets: CandlePoint[][]): CandlePoint[] {
  const byTime = new Map<number, CandlePoint>();

  for (const set of sets) {
    for (const point of set) {
      byTime.set(point.time, point);
    }
  }

  return [...byTime.values()].sort((a, b) => a.time - b.time);
}
