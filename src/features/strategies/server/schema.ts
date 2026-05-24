import { z } from "zod";
import { ALLOWED_INDICATORS, SUPPORTED_SYMBOLS, SUPPORTED_TIMEFRAMES } from "../types.js";
import { INITIAL_RISK_LIMITS, PARAMETER_RANGES } from "./presets.js";

const integer = () => z.number().int();
const positiveInteger = () => integer().positive();
const boundedNumber = (min: number, max: number) => z.number().min(min).max(max);

const periodListSchema = (allowed: readonly number[]) =>
  z
    .array(integer())
    .min(1)
    .max(allowed.length)
    .refine((periods) => periods.every((period) => allowed.includes(period)), {
      message: `periods must be one of: ${allowed.join(", ")}`,
    });

export const indicatorsSchema = z
  .object({
    sma: z
      .object({ periods: periodListSchema(PARAMETER_RANGES.sma.periods) })
      .strict()
      .optional(),
    ema: z
      .object({ periods: periodListSchema(PARAMETER_RANGES.ema.periods) })
      .strict()
      .optional(),
    rsi: z
      .object({ period: boundedNumber(7, 21) })
      .strict()
      .optional(),
    bollingerBands: z
      .object({
        period: boundedNumber(10, 30),
        stdDev: boundedNumber(1.5, 2.5),
      })
      .strict()
      .optional(),
    atr: z
      .object({
        period: boundedNumber(7, 21),
        longPeriod: boundedNumber(30, 100).optional(),
        maxSpikeRatio: boundedNumber(1.5, 3.5).optional(),
      })
      .strict()
      .optional(),
    adx: z
      .object({
        period: boundedNumber(10, 21),
        trendThreshold: boundedNumber(18, 35).optional(),
        weakTrendThreshold: boundedNumber(12, 25).optional(),
      })
      .strict()
      .optional(),
    macd: z
      .object({
        fastPeriod: boundedNumber(8, 15),
        slowPeriod: boundedNumber(20, 35),
        signalPeriod: boundedNumber(5, 12),
      })
      .strict()
      .refine((macd) => macd.fastPeriod < macd.slowPeriod, {
        message: "macd.fastPeriod must be lower than macd.slowPeriod",
        path: ["fastPeriod"],
      })
      .optional(),
  })
  .strict()
  .refine((indicators) => Object.keys(indicators).length > 0, {
    message: "at least one indicator is required",
  });

const indicatorRefSchema = z
  .object({
    kind: z.literal("indicator"),
    indicator: z.enum(ALLOWED_INDICATORS),
    output: z.string().min(1).max(32).optional(),
    period: positiveInteger().optional(),
  })
  .strict();

const priceRefSchema = z
  .object({
    kind: z.literal("price"),
    source: z.enum(["close", "high", "low", "open"]),
  })
  .strict();

export const conditionSchema: z.ZodTypeAny = z.lazy(() =>
  z.discriminatedUnion("type", [
    z
      .object({
        type: z.literal("indicator_cross"),
        left: z.union([indicatorRefSchema, priceRefSchema]),
        operator: z.enum(["crosses_above", "crosses_below"]),
        right: z.union([indicatorRefSchema, priceRefSchema]),
      })
      .strict(),
    z
      .object({
        type: z.literal("indicator_threshold"),
        indicator: z.enum(["rsi", "adx", "atr"]),
        operator: z.enum([">", ">=", "<", "<="]),
        value: z.number(),
      })
      .strict(),
    z
      .object({
        type: z.literal("price_vs_indicator"),
        price: z.enum(["close", "high", "low", "open"]),
        operator: z.enum(["above", "below", "crosses_above", "crosses_below"]),
        indicator: indicatorRefSchema,
      })
      .strict(),
    z
      .object({
        type: z.literal("regime_is"),
        regime: z.enum(["SIDEWAYS", "UP", "DOWN", "TRANSITION"]),
      })
      .strict(),
    z
      .object({
        type: z.literal("candle_confirmation"),
        candles: z.union([z.literal(1), z.literal(2), z.literal(3)]),
        direction: z.enum(["bullish", "bearish"]),
      })
      .strict(),
    z
      .object({
        type: z.literal("all"),
        conditions: z.array(conditionSchema).min(1).max(8),
      })
      .strict(),
    z
      .object({
        type: z.literal("any"),
        conditions: z.array(conditionSchema).min(1).max(8),
      })
      .strict(),
    z
      .object({
        type: z.literal("not"),
        condition: conditionSchema,
      })
      .strict(),
  ]),
);

export const strategyGatesSchema = z
  .object({
    data: z
      .object({
        min_candle_count: positiveInteger(),
        allow_missing_candles: z.literal(false),
        max_latest_candle_age_seconds: positiveInteger(),
      })
      .strict(),
    market_time: z
      .object({
        rollover_blackout_before_minutes: z.number().min(0).max(60),
        rollover_blackout_after_minutes: z.number().min(0).max(60),
        stop_new_entries_before_weekend_close_hours: z.number().min(0).max(24),
      })
      .strict(),
    volatility: z
      .object({
        max_spread_pips: z.number().positive().max(5),
        min_bollinger_band_width_pips: z.number().min(0),
        max_atr_spike_ratio: boundedNumber(
          PARAMETER_RANGES.atr.maxSpikeRatio.min,
          PARAMETER_RANGES.atr.maxSpikeRatio.max,
        ),
      })
      .strict(),
    regime: z
      .object({
        hold_bars_after_transition: z.number().int().min(0).max(20),
        require_adx_for_breakout: z.boolean(),
      })
      .strict(),
    signal_quality: z
      .object({
        require_candle_confirmation: z.boolean(),
      })
      .strict(),
  })
  .strict();

export const riskDefinitionSchema = z
  .object({
    lot_sizing: z
      .object({
        mode: z.literal("fixed"),
        fixed_quantity: z.literal(INITIAL_RISK_LIMITS.fixed_quantity),
      })
      .strict(),
    max_open_positions_per_account: z.number().int().min(1).max(2),
    allow_pyramiding: z.literal(false),
    max_same_direction_positions: z.literal(1),
    max_margin_usage_pct: z.number().positive().max(50),
    max_loss_per_trade_jpy: z.number().positive().max(1000),
    max_daily_loss_jpy: z.number().positive().max(2000),
    min_margin_maintenance_rate_for_entry: z.number().min(300),
    warning_margin_maintenance_rate: z.number().min(250),
    emergency_exit_margin_maintenance_rate: z.number().min(150),
  })
  .strict();

export const strategyDefinitionSchema = z
  .object({
    meta: z
      .object({
        name: z.string().min(1).max(80),
        description: z.string().min(1).max(500),
        symbol: z.enum(SUPPORTED_SYMBOLS),
        timeframe: z.enum(SUPPORTED_TIMEFRAMES),
        enabled: z.boolean(),
      })
      .strict(),
    indicators: indicatorsSchema,
    gates: strategyGatesSchema,
    regime: z
      .object({
        detector: z.literal("adx_slope"),
        sideways_when_adx_below: boundedNumber(12, 25),
        trend_when_adx_above: boundedNumber(18, 35),
      })
      .strict()
      .refine((regime) => regime.sideways_when_adx_below < regime.trend_when_adx_above, {
        message: "sideways threshold must be lower than trend threshold",
        path: ["sideways_when_adx_below"],
      }),
    entry: z
      .object({
        mode: z.enum(["hybrid", "trend_biased_hybrid"]),
        long: conditionSchema,
        short: conditionSchema,
      })
      .strict(),
    exit: z
      .object({
        take_profit_pips: z.number().positive().max(100),
        stop_loss_pips: z.number().positive().max(100),
        trailing_stop_pips: z.number().positive().max(50),
        break_even_trigger_pips: z.number().positive().max(50),
        opposite_signal_exit: z.boolean(),
        allow_reversal_entry: z.literal(false),
      })
      .strict(),
    risk: riskDefinitionSchema,
  })
  .strict();

export const aiStrategyProposalSchema = z
  .object({
    proposal_id: z.string().min(1).max(120).optional(),
    rationale: z.string().min(1).max(2000),
    strategy: strategyDefinitionSchema,
  })
  .strict();
