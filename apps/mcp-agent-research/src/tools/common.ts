export const MAX_LIMIT = 500;

export function clampLimit(limit: number) {
  return Math.max(1, Math.min(MAX_LIMIT, Math.trunc(limit)));
}
