"use client";

import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  createChart,
  type IChartApi,
  type ISeriesApi,
  LineStyle,
  type Time,
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
        tickMarkFormatter: (time: Time) => formatChartTime(time, interval),
      },
      localization: {
        timeFormatter: (time: Time) => formatChartDateTime(time),
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

function formatChartTime(time: Time, interval: string) {
  const date = timeToDate(time);
  if (!date) return String(time);

  const options: Intl.DateTimeFormatOptions =
    interval === "1hour"
      ? {
          timeZone: "Asia/Tokyo",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
        }
      : {
          timeZone: "Asia/Tokyo",
          hour: "2-digit",
          minute: "2-digit",
        };

  return new Intl.DateTimeFormat("ja-JP", options).format(date);
}

function formatChartDateTime(time: Time) {
  const date = timeToDate(time);
  if (!date) return String(time);

  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function timeToDate(time: Time) {
  if (typeof time === "number") {
    return new Date(time * 1000);
  }

  if (typeof time === "string") {
    const date = new Date(time);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  return new Date(Date.UTC(time.year, time.month - 1, time.day));
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
