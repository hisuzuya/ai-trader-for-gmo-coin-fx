"use client";

import {
  AreaSeries,
  ColorType,
  CrosshairMode,
  createChart,
  type IChartApi,
  type ISeriesApi,
  LineStyle,
  type UTCTimestamp,
} from "lightweight-charts";
import { useEffect, useRef } from "react";

export type PnlPoint = {
  time: UTCTimestamp;
  value: number;
};

type PnlChartProps = {
  data: PnlPoint[];
  positive: boolean;
};

export function PnlChart({ data, positive }: PnlChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Area"> | null>(null);

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
        scaleMargins: { top: 0.1, bottom: 0.08 },
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
      handleScroll: false,
      handleScale: false,
    });
    chartRef.current = chart;

    const series = chart.addSeries(AreaSeries, {
      lineColor: positive ? "#26a69a" : "#ef5350",
      topColor: positive ? "rgba(38, 166, 154, 0.32)" : "rgba(239, 83, 80, 0.32)",
      bottomColor: positive ? "rgba(38, 166, 154, 0.02)" : "rgba(239, 83, 80, 0.02)",
      lineWidth: 2,
      priceLineVisible: true,
      priceLineColor: positive ? "#26a69a" : "#ef5350",
      priceLineStyle: LineStyle.Dotted,
      priceLineWidth: 1,
      lastValueVisible: true,
      crosshairMarkerBackgroundColor: positive ? "#26a69a" : "#ef5350",
      crosshairMarkerBorderColor: "#0b0e11",
      crosshairMarkerRadius: 4,
      priceFormat: {
        type: "price",
        precision: 0,
        minMove: 1,
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
  }, [data, positive]);

  return <div ref={containerRef} className="tv-chart-container" />;
}
