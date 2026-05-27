import type { StrategyDefinition } from "../strategies/index.js";

export type StrategyPerformanceSnapshot = {
  strategyName: string;
  accountId: string | null;
  netProfitJpy: number;
  tradeCount: number;
  maxDrawdownPct: number;
};

export type AdoptionGateMetrics = {
  candidate: StrategyPerformanceSnapshot;
  baseline: StrategyPerformanceSnapshot;
  minTradeCount: number;
  profitImprovementPct: number;
};

export function evaluateAdoptionGateSnapshot(input: {
  candidateStrategy: StrategyDefinition;
  baselineStrategy: StrategyDefinition;
  metrics: AdoptionGateMetrics;
}): string[] {
  const reasons: string[] = [];
  const { candidate, baseline, minTradeCount, profitImprovementPct } = input.metrics;

  if (input.candidateStrategy.meta.timeframe !== input.baselineStrategy.meta.timeframe) {
    reasons.push("candidate and baseline timeframe differ");
  }

  if (candidate.tradeCount < minTradeCount) {
    reasons.push(`candidate trade_count ${candidate.tradeCount} is below minimum ${minTradeCount}`);
  }

  if (profitImprovementPct < 5) {
    reasons.push(
      `candidate net profit improvement ${profitImprovementPct.toFixed(2)}% is below 5%`,
    );
  }

  if (candidate.maxDrawdownPct > baseline.maxDrawdownPct) {
    reasons.push(
      `candidate max drawdown ${candidate.maxDrawdownPct.toFixed(
        2,
      )}% exceeds baseline ${baseline.maxDrawdownPct.toFixed(2)}%`,
    );
  }

  if (candidate.maxDrawdownPct > 15) {
    reasons.push(`candidate max drawdown ${candidate.maxDrawdownPct.toFixed(2)}% exceeds 15%`);
  }

  reasons.push(...riskGateRelaxationReasons(input.candidateStrategy, input.baselineStrategy));

  return reasons;
}

function riskGateRelaxationReasons(
  candidate: StrategyDefinition,
  baseline: StrategyDefinition,
): string[] {
  const reasons: string[] = [];

  if (
    candidate.risk.max_open_positions_per_account > baseline.risk.max_open_positions_per_account
  ) {
    reasons.push("candidate relaxes max_open_positions_per_account");
  }

  if (candidate.risk.max_margin_usage_pct > baseline.risk.max_margin_usage_pct) {
    reasons.push("candidate relaxes max_margin_usage_pct");
  }

  if (candidate.risk.max_loss_per_trade_jpy > baseline.risk.max_loss_per_trade_jpy) {
    reasons.push("candidate relaxes max_loss_per_trade_jpy");
  }

  if (candidate.risk.max_daily_loss_jpy > baseline.risk.max_daily_loss_jpy) {
    reasons.push("candidate relaxes max_daily_loss_jpy");
  }

  if (
    candidate.risk.min_margin_maintenance_rate_for_entry <
    baseline.risk.min_margin_maintenance_rate_for_entry
  ) {
    reasons.push("candidate relaxes min_margin_maintenance_rate_for_entry");
  }

  if (candidate.gates.volatility.max_spread_pips > baseline.gates.volatility.max_spread_pips) {
    reasons.push("candidate relaxes max_spread_pips");
  }

  if (
    candidate.gates.volatility.max_atr_spike_ratio > baseline.gates.volatility.max_atr_spike_ratio
  ) {
    reasons.push("candidate relaxes max_atr_spike_ratio");
  }

  if (candidate.exit.allow_reversal_entry !== false) {
    reasons.push("candidate enables reversal entry");
  }

  return reasons;
}
