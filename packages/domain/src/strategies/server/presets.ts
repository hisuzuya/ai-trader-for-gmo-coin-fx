import type { IndicatorDefinitions } from "../types.js"

export const INDICATOR_PRESET: Required<IndicatorDefinitions> = {
  sma: { periods: [20, 50, 100] },
  ema: { periods: [9, 21, 55] },
  rsi: { period: 14 },
  bollingerBands: { period: 20, stdDev: 2 },
  atr: { period: 14, longPeriod: 50, maxSpikeRatio: 2.5 },
  adx: { period: 14, trendThreshold: 25, weakTrendThreshold: 18 },
  macd: { fastPeriod: 12, slowPeriod: 26, signalPeriod: 9 },
}

export const PARAMETER_RANGES = {
  sma: {
    periods: [20, 50, 100],
  },
  ema: {
    periods: [9, 21, 55],
  },
  rsi: {
    period: { min: 7, max: 21 },
    oversold: { min: 20, max: 40 },
    overbought: { min: 60, max: 80 },
  },
  bollingerBands: {
    period: { min: 10, max: 30 },
    stdDev: { min: 1.5, max: 2.5 },
  },
  atr: {
    period: { min: 7, max: 21 },
    longPeriod: { min: 30, max: 100 },
    maxSpikeRatio: { min: 1.5, max: 3.5 },
  },
  adx: {
    period: { min: 10, max: 21 },
    trendThreshold: { min: 18, max: 35 },
    weakTrendThreshold: { min: 12, max: 25 },
  },
  macd: {
    fastPeriod: { min: 8, max: 15 },
    slowPeriod: { min: 20, max: 35 },
    signalPeriod: { min: 5, max: 12 },
  },
} as const

export const INITIAL_RISK_LIMITS = {
  max_open_positions_per_account: 2,
  allow_pyramiding: false,
  max_same_direction_positions: 1,
  max_margin_usage_pct: 50,
  max_loss_per_trade_jpy: 1000,
  max_daily_loss_jpy: 2000,
  min_margin_maintenance_rate_for_entry: 300,
  warning_margin_maintenance_rate: 250,
  emergency_exit_margin_maintenance_rate: 150,
  fixed_quantity: 1000,
} as const
