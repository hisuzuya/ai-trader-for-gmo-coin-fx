import { ZodIssue } from "zod"
import type {
  AiProposalValidationResult,
  AiStrategyProposal,
  RejectReason,
  RejectReasonCode,
} from "../../ai-tuning/types.js"
import type {
  Condition,
  IndicatorDefinitions,
  IndicatorName,
  IndicatorRef,
  StrategyDefinition,
} from "../types.js"
import { PARAMETER_RANGES } from "./presets.js"
import { aiStrategyProposalSchema, strategyDefinitionSchema } from "./schema.js"

const FORBIDDEN_PATTERNS = [
  /\btypescript\b/i,
  /\bjavascript\b/i,
  /\bnode\b/i,
  /\bshell\b/i,
  /\bbash\b/i,
  /\bexec\b/i,
  /\bchild_process\b/i,
  /\beval\s*\(/i,
  /\bFunction\s*\(/,
  /\bfs\./,
  /\bdb\s*\./i,
  /\bSQL\b/,
  /\bcurl\b/i,
  /\bnpm\s+/i,
  /\bpnpm\s+/i,
]

export const validateStrategyDefinition = (input: unknown): AiProposalValidationResult => {
  const parsed = strategyDefinitionSchema.safeParse(input)

  if (!parsed.success) {
    return {
      status: "rejected",
      reasons: parsed.error.issues.map(mapZodIssueToRejectReason),
    }
  }

  const strategy = parsed.data as StrategyDefinition
  const reasons = validateStrategyDomainRules(strategy)

  if (reasons.length > 0) {
    return {
      status: "rejected",
      reasons,
    }
  }

  return {
    status: "accepted",
    proposal: {
      rationale: "strategy definition validated directly",
      strategy,
    },
  }
}

export const validateAiStrategyProposal = (input: unknown): AiProposalValidationResult => {
  const jsonResult = parseProposalJson(input)

  if (!jsonResult.ok) {
    return {
      status: "rejected",
      reasons: [jsonResult.reason],
    }
  }

  const forbiddenReasons = findForbiddenCapabilities(jsonResult.value)
  const parsed = aiStrategyProposalSchema.safeParse(jsonResult.value)

  if (!parsed.success) {
    return {
      status: "rejected",
      reasons: [...forbiddenReasons, ...parsed.error.issues.map(mapZodIssueToRejectReason)],
    }
  }

  const proposal = parsed.data as AiStrategyProposal
  const domainReasons = validateStrategyDomainRules(proposal.strategy)
  const reasons = [...forbiddenReasons, ...domainReasons]

  if (reasons.length > 0) {
    return {
      status: "rejected",
      reasons,
    }
  }

  return {
    status: "accepted",
    proposal,
  }
}

const parseProposalJson = (
  input: unknown,
):
  | { ok: true; value: unknown }
  | {
      ok: false
      reason: RejectReason
    } => {
  if (typeof input !== "string") {
    return { ok: true, value: input }
  }

  try {
    return { ok: true, value: JSON.parse(input) }
  } catch (error) {
    return {
      ok: false,
      reason: {
        code: "invalid_json",
        path: "$",
        message: error instanceof Error ? error.message : "proposal is not valid JSON",
      },
    }
  }
}

const mapZodIssueToRejectReason = (issue: ZodIssue): RejectReason => {
  const path = toPath(issue.path)
  const code = classifyIssue(path, issue.message)

  return {
    code,
    path,
    message: issue.message,
  }
}

const classifyIssue = (path: string, message: string): RejectReasonCode => {
  if (path.includes(".meta.timeframe")) return "unsupported_timeframe"
  if (path.includes(".meta.symbol")) return "unsupported_symbol"
  if (path.includes(".risk.max_open_positions_per_account")) {
    return "max_open_positions_exceeded"
  }
  if (path.includes(".exit.allow_reversal_entry")) return "reversal_entry_not_allowed"
  if (path.includes(".risk.")) return "risk_gate_relaxed"
  if (path.includes(".indicators") && message.includes("Unrecognized key")) {
    return "unsupported_indicator"
  }
  if (path.includes(".indicators.") || path.includes(".regime.")) return "parameter_out_of_range"
  if (path.includes(".entry.") && message.includes("Invalid discriminator value")) {
    return "unsupported_condition"
  }
  if (path.includes(".entry.")) return "schema_validation_error"

  return "schema_validation_error"
}

const validateStrategyDomainRules = (strategy: StrategyDefinition): RejectReason[] => [
  ...validateConfiguredIndicatorReferences(strategy),
  ...validateConditionParameters(strategy),
]

const validateConfiguredIndicatorReferences = (strategy: StrategyDefinition): RejectReason[] => {
  const reasons: RejectReason[] = []

  for (const [path, condition] of [
    ["$.strategy.entry.long", strategy.entry.long],
    ["$.strategy.entry.short", strategy.entry.short],
  ] as const) {
    for (const reference of collectIndicatorRefs(condition)) {
      const reason = validateIndicatorReference(strategy.indicators, reference, path)

      if (reason) {
        reasons.push(reason)
      }
    }
  }

  return reasons
}

const validateConditionParameters = (strategy: StrategyDefinition): RejectReason[] => {
  const reasons: RejectReason[] = []

  for (const [path, condition] of [
    ["$.strategy.entry.long", strategy.entry.long],
    ["$.strategy.entry.short", strategy.entry.short],
  ] as const) {
    reasons.push(...collectConditionParameterRejects(condition, path))
  }

  return reasons
}

const collectConditionParameterRejects = (condition: Condition, path: string): RejectReason[] => {
  switch (condition.type) {
    case "indicator_threshold":
      return validateIndicatorThreshold(condition, path)
    case "all":
    case "any":
      return condition.conditions.flatMap((child, index) =>
        collectConditionParameterRejects(child, `${path}.conditions.${index}`),
      )
    case "not":
      return collectConditionParameterRejects(condition.condition, `${path}.condition`)
    case "candle_confirmation":
    case "indicator_cross":
    case "price_vs_indicator":
    case "regime_is":
      return []
  }
}

const validateIndicatorThreshold = (
  condition: Extract<Condition, { type: "indicator_threshold" }>,
  path: string,
): RejectReason[] => {
  if (condition.indicator !== "rsi") {
    return []
  }

  const range =
    condition.operator === "<" || condition.operator === "<="
      ? PARAMETER_RANGES.rsi.oversold
      : PARAMETER_RANGES.rsi.overbought

  if (condition.value >= range.min && condition.value <= range.max) {
    return []
  }

  return [
    {
      code: "parameter_out_of_range",
      path: `${path}.value`,
      message: `rsi threshold ${condition.value} must be within ${range.min}..${range.max}`,
    },
  ]
}

const validateIndicatorReference = (
  indicators: IndicatorDefinitions,
  reference: IndicatorRef,
  path: string,
): RejectReason | undefined => {
  const configured = indicators[reference.indicator]

  if (!configured) {
    return {
      code: "indicator_not_configured",
      path,
      message: `${reference.indicator} is referenced but not configured`,
    }
  }

  if (requiresPeriod(reference.indicator) && reference.period === undefined) {
    return {
      code: "parameter_out_of_range",
      path,
      message: `${reference.indicator} references must include a configured period`,
    }
  }

  if (
    reference.indicator === "sma" &&
    !configuredPeriodExists(indicators.sma?.periods, reference.period)
  ) {
    return periodReject(reference, path)
  }

  if (
    reference.indicator === "ema" &&
    !configuredPeriodExists(indicators.ema?.periods, reference.period)
  ) {
    return periodReject(reference, path)
  }

  return undefined
}

const configuredPeriodExists = (periods: number[] | undefined, period: number | undefined) =>
  period !== undefined && periods?.includes(period) === true

const periodReject = (reference: IndicatorRef, path: string): RejectReason => ({
  code: "parameter_out_of_range",
  path,
  message: `${reference.indicator} period ${reference.period ?? "undefined"} is not configured`,
})

const requiresPeriod = (indicator: IndicatorName) => indicator === "sma" || indicator === "ema"

const collectIndicatorRefs = (condition: Condition): IndicatorRef[] => {
  switch (condition.type) {
    case "indicator_cross":
      return [condition.left, condition.right].filter(isIndicatorRef)
    case "indicator_threshold":
      return [{ kind: "indicator", indicator: condition.indicator }]
    case "price_vs_indicator":
      return [condition.indicator]
    case "all":
    case "any":
      return condition.conditions.flatMap(collectIndicatorRefs)
    case "not":
      return collectIndicatorRefs(condition.condition)
    case "candle_confirmation":
    case "regime_is":
      return []
  }
}

const isIndicatorRef = (value: unknown): value is IndicatorRef =>
  typeof value === "object" &&
  value !== null &&
  "kind" in value &&
  value.kind === "indicator" &&
  "indicator" in value

const findForbiddenCapabilities = (value: unknown): RejectReason[] => {
  const reasons: RejectReason[] = []
  walkStrings(value, "$", (text, path) => {
    const matched = FORBIDDEN_PATTERNS.find((pattern) => pattern.test(text))

    if (matched) {
      reasons.push({
        code: "forbidden_capability",
        path,
        message: `proposal contains forbidden capability text matching ${matched.source}`,
      })
    }
  })

  return reasons
}

const walkStrings = (
  value: unknown,
  path: string,
  visit: (text: string, path: string) => void,
): void => {
  if (typeof value === "string") {
    visit(value, path)
    return
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) => walkStrings(item, `${path}[${index}]`, visit))
    return
  }

  if (typeof value === "object" && value !== null) {
    Object.entries(value).forEach(([key, item]) => walkStrings(item, `${path}.${key}`, visit))
  }
}

const toPath = (path: PropertyKey[]) =>
  path.length === 0 ? "$" : `$.${path.map(String).join(".")}`
