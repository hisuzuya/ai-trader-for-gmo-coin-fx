export const RUN_INTERVAL_OPTIONS = [
  { value: 300, label: "5 min (300 sec)" },
  { value: 600, label: "10 min (600 sec)" },
  { value: 900, label: "15 min (900 sec)" },
  { value: 1800, label: "30 min (1800 sec)" },
  { value: 3600, label: "1 hour (3600 sec)" },
  { value: 14400, label: "4 hours (14400 sec)" },
] as const;

export const MODEL_OPTIONS = [{ value: "claude-sonnet-4-5", label: "Claude Sonnet 4.5" }] as const;

export function hasRunIntervalOption(value: number) {
  return RUN_INTERVAL_OPTIONS.some((option) => option.value === value);
}

export function hasModelOption(value: string) {
  return MODEL_OPTIONS.some((option) => option.value === value);
}
