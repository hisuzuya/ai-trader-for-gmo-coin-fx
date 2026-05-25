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
import { useEffect, useRef } from "react";

export type MarketCandlePoint = {
  time: UTCTimestamp;
  open: number;
  high: number;
  low: number;
  close: number;
};

type MarketCandleChartProps = {
  data: MarketCandlePoint[];
  interval: string;
};

export function MarketCandleChart({ data, interval }: MarketCandleChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);

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
        scaleMargins: { top: 0.08, bottom: 0.12 },
      },
      timeScale: {
        borderColor: "#2a2e39",
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 6,
        barSpacing: getBarSpacing(interval),
      },
      crosshair: {
        mode: CrosshairMode.Normal,
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
      handleScroll: {
        mouseWheel: true,
        pressedMouseMove: true,
        horzTouchDrag: true,
        vertTouchDrag: false,
      },
      handleScale: {
        axisPressedMouseMove: true,
        mouseWheel: true,
        pinch: true,
      },
    });
    chartRef.current = chart;

    const series = chart.addSeries(CandlestickSeries, {
      upColor: "#26a69a",
      downColor: "#ef5350",
      wickUpColor: "#26a69a",
      wickDownColor: "#ef5350",
      borderVisible: false,
      priceLineVisible: true,
      priceLineColor: "#5b8aff",
      priceLineStyle: LineStyle.Dotted,
      priceFormat: {
        type: "price",
        precision: 3,
        minMove: 0.001,
      },
    });
    seriesRef.current = series;
    series.setData(data);
    chart.timeScale().fitContent();

    return () => {
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, [data, interval]);

  return <div ref={containerRef} className="tv-candle-container" />;
}

function getBarSpacing(interval: string) {
  const spacing: Record<string, number> = {
    "1min": 5,
    "5min": 8,
    "10min": 9,
    "15min": 10,
    "30min": 12,
    "1hour": 14,
  };

  return spacing[interval] ?? 8;
}
