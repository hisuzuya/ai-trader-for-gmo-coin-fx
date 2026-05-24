export const SUPPORTED_TIMEFRAMES = ["1m", "5m", "15m"] as const
export type StrategyTimeframe = (typeof SUPPORTED_TIMEFRAMES)[number]

export const SUPPORTED_SYMBOLS = ["USD_JPY"] as const
export type StrategySymbol = (typeof SUPPORTED_SYMBOLS)[number]

export const ALLOWED_INDICATORS = [
  "sma",
  "ema",
  "rsi",
  "bollingerBands",
  "atr",
  "adx",
  "macd",
] as const
export type IndicatorName = (typeof ALLOWED_INDICATORS)[number]

export type Regime = "SIDEWAYS" | "UP" | "DOWN" | "TRANSITION"
export type TradeSide = "long" | "short"

export type IndicatorDefinitions = {
  sma?: { periods: number[] }
  ema?: { periods: number[] }
  rsi?: { period: number }
  bollingerBands?: { period: number; stdDev: number }
  atr?: { period: number; longPeriod?: number; maxSpikeRatio?: number }
  adx?: { period: number; trendThreshold?: number; weakTrendThreshold?: number }
  macd?: {
    fastPeriod: number
    slowPeriod: number
    signalPeriod: number
  }
}

export type IndicatorRef = {
  kind: "indicator"
  indicator: IndicatorName
  output?: string
  period?: number
}

export type PriceRef = {
  kind: "price"
  source: "close" | "high" | "low" | "open"
}

export type Condition =
  | {
      type: "indicator_cross"
      left: IndicatorRef | PriceRef
      operator: "crosses_above" | "crosses_below"
      right: IndicatorRef | PriceRef
    }
  | {
      type: "indicator_threshold"
      indicator: "rsi" | "adx" | "atr"
      operator: ">" | ">=" | "<" | "<="
      value: number
    }
  | {
      type: "price_vs_indicator"
      price: "close" | "high" | "low" | "open"
      operator: "above" | "below" | "crosses_above" | "crosses_below"
      indicator: IndicatorRef
    }
  | {
      type: "regime_is"
      regime: Regime
    }
  | {
      type: "candle_confirmation"
      candles: 1 | 2 | 3
      direction: "bullish" | "bearish"
    }
  | {
      type: "all"
      conditions: Condition[]
    }
  | {
      type: "any"
      conditions: Condition[]
    }
  | {
      type: "not"
      condition: Condition
    }

export type StrategyGates = {
  data: {
    min_candle_count: number
    allow_missing_candles: false
    max_latest_candle_age_seconds: number
  }
  market_time: {
    rollover_blackout_before_minutes: number
    rollover_blackout_after_minutes: number
    stop_new_entries_before_weekend_close_hours: number
  }
  volatility: {
    max_spread_pips: number
    min_bollinger_band_width_pips: number
    max_atr_spike_ratio: number
  }
  regime: {
    hold_bars_after_transition: number
    require_adx_for_breakout: boolean
  }
  signal_quality: {
    require_candle_confirmation: boolean
  }
}

export type RegimeDefinition = {
  detector: "adx_slope"
  sideways_when_adx_below: number
  trend_when_adx_above: number
}

export type EntryDefinition = {
  mode: "hybrid" | "trend_biased_hybrid"
  long: Condition
  short: Condition
}

export type ExitDefinition = {
  take_profit_pips: number
  stop_loss_pips: number
  trailing_stop_pips: number
  break_even_trigger_pips: number
  opposite_signal_exit: boolean
  allow_reversal_entry: false
}

export type RiskDefinition = {
  lot_sizing: {
    mode: "fixed"
    fixed_quantity: 1000
  }
  max_open_positions_per_account: number
  allow_pyramiding: false
  max_same_direction_positions: 1
  max_margin_usage_pct: number
  max_loss_per_trade_jpy: number
  max_daily_loss_jpy: number
  min_margin_maintenance_rate_for_entry: number
  warning_margin_maintenance_rate: number
  emergency_exit_margin_maintenance_rate: number
}

export type StrategyDefinition = {
  meta: {
    name: string
    description: string
    symbol: StrategySymbol
    timeframe: StrategyTimeframe
    enabled: boolean
  }
  indicators: IndicatorDefinitions
  gates: StrategyGates
  regime: RegimeDefinition
  entry: EntryDefinition
  exit: ExitDefinition
  risk: RiskDefinition
}
