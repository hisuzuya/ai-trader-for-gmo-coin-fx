import type { StrategyDefinition, StrategyTimeframe } from "../types.js"
import { INDICATOR_PRESET, INITIAL_RISK_LIMITS } from "./presets.js"

const commonRisk = {
  lot_sizing: {
    mode: "fixed",
    fixed_quantity: INITIAL_RISK_LIMITS.fixed_quantity,
  },
  max_open_positions_per_account: INITIAL_RISK_LIMITS.max_open_positions_per_account,
  allow_pyramiding: INITIAL_RISK_LIMITS.allow_pyramiding,
  max_same_direction_positions: INITIAL_RISK_LIMITS.max_same_direction_positions,
  max_margin_usage_pct: INITIAL_RISK_LIMITS.max_margin_usage_pct,
  max_loss_per_trade_jpy: INITIAL_RISK_LIMITS.max_loss_per_trade_jpy,
  max_daily_loss_jpy: INITIAL_RISK_LIMITS.max_daily_loss_jpy,
  min_margin_maintenance_rate_for_entry:
    INITIAL_RISK_LIMITS.min_margin_maintenance_rate_for_entry,
  warning_margin_maintenance_rate: INITIAL_RISK_LIMITS.warning_margin_maintenance_rate,
  emergency_exit_margin_maintenance_rate:
    INITIAL_RISK_LIMITS.emergency_exit_margin_maintenance_rate,
} satisfies StrategyDefinition["risk"]

const commonIndicators = INDICATOR_PRESET satisfies StrategyDefinition["indicators"]

const commonRegime = {
  detector: "adx_slope",
  sideways_when_adx_below: 18,
  trend_when_adx_above: 25,
} satisfies StrategyDefinition["regime"]

const hybridLong = {
  type: "any",
  conditions: [
    {
      type: "all",
      conditions: [
        { type: "regime_is", regime: "SIDEWAYS" },
        { type: "indicator_threshold", indicator: "rsi", operator: "<=", value: 30 },
        {
          type: "price_vs_indicator",
          price: "close",
          operator: "below",
          indicator: { kind: "indicator", indicator: "bollingerBands", output: "lower" },
        },
      ],
    },
    {
      type: "all",
      conditions: [
        { type: "regime_is", regime: "UP" },
        {
          type: "indicator_cross",
          left: { kind: "indicator", indicator: "ema", period: 9 },
          operator: "crosses_above",
          right: { kind: "indicator", indicator: "ema", period: 21 },
        },
        { type: "indicator_threshold", indicator: "adx", operator: ">=", value: 25 },
      ],
    },
  ],
} satisfies StrategyDefinition["entry"]["long"]

const hybridShort = {
  type: "any",
  conditions: [
    {
      type: "all",
      conditions: [
        { type: "regime_is", regime: "SIDEWAYS" },
        { type: "indicator_threshold", indicator: "rsi", operator: ">=", value: 70 },
        {
          type: "price_vs_indicator",
          price: "close",
          operator: "above",
          indicator: { kind: "indicator", indicator: "bollingerBands", output: "upper" },
        },
      ],
    },
    {
      type: "all",
      conditions: [
        { type: "regime_is", regime: "DOWN" },
        {
          type: "indicator_cross",
          left: { kind: "indicator", indicator: "ema", period: 9 },
          operator: "crosses_below",
          right: { kind: "indicator", indicator: "ema", period: 21 },
        },
        { type: "indicator_threshold", indicator: "adx", operator: ">=", value: 25 },
      ],
    },
  ],
} satisfies StrategyDefinition["entry"]["short"]

const exitByTimeframe: Record<StrategyTimeframe, StrategyDefinition["exit"]> = {
  "1m": {
    take_profit_pips: 5,
    stop_loss_pips: 5,
    trailing_stop_pips: 3,
    break_even_trigger_pips: 2,
    opposite_signal_exit: true,
    allow_reversal_entry: false,
  },
  "5m": {
    take_profit_pips: 10,
    stop_loss_pips: 10,
    trailing_stop_pips: 5,
    break_even_trigger_pips: 3,
    opposite_signal_exit: true,
    allow_reversal_entry: false,
  },
  "15m": {
    take_profit_pips: 20,
    stop_loss_pips: 15,
    trailing_stop_pips: 8,
    break_even_trigger_pips: 6,
    opposite_signal_exit: true,
    allow_reversal_entry: false,
  },
}

const maxSpreadByTimeframe: Record<StrategyTimeframe, number> = {
  "1m": 0.5,
  "5m": 0.8,
  "15m": 1,
}

const minCandleCountByTimeframe: Record<StrategyTimeframe, number> = {
  "1m": 150,
  "5m": 120,
  "15m": 100,
}

const modeByTimeframe: Record<StrategyTimeframe, StrategyDefinition["entry"]["mode"]> = {
  "1m": "hybrid",
  "5m": "hybrid",
  "15m": "trend_biased_hybrid",
}

const buildBaseline = (timeframe: StrategyTimeframe): StrategyDefinition => ({
  meta: {
    name: `baseline_${timeframe}`,
    description: `Initial ${timeframe} USD/JPY paper-trading baseline.`,
    symbol: "USD_JPY",
    timeframe,
    enabled: true,
  },
  indicators: commonIndicators,
  gates: {
    data: {
      min_candle_count: minCandleCountByTimeframe[timeframe],
      allow_missing_candles: false,
      max_latest_candle_age_seconds: timeframe === "1m" ? 90 : timeframe === "5m" ? 360 : 960,
    },
    market_time: {
      rollover_blackout_before_minutes: 10,
      rollover_blackout_after_minutes: 10,
      stop_new_entries_before_weekend_close_hours: 2,
    },
    volatility: {
      max_spread_pips: maxSpreadByTimeframe[timeframe],
      min_bollinger_band_width_pips: timeframe === "1m" ? 1.2 : timeframe === "5m" ? 1 : 0.8,
      max_atr_spike_ratio: 2.5,
    },
    regime: {
      hold_bars_after_transition: timeframe === "1m" ? 3 : 2,
      require_adx_for_breakout: true,
    },
    signal_quality: {
      require_candle_confirmation: timeframe !== "15m",
    },
  },
  regime: commonRegime,
  entry: {
    mode: modeByTimeframe[timeframe],
    long: hybridLong,
    short: hybridShort,
  },
  exit: exitByTimeframe[timeframe],
  risk: commonRisk,
})

export const BASELINE_STRATEGIES = {
  "1m": buildBaseline("1m"),
  "5m": buildBaseline("5m"),
  "15m": buildBaseline("15m"),
} as const satisfies Record<StrategyTimeframe, StrategyDefinition>

export const baselineStrategies = Object.values(BASELINE_STRATEGIES)
