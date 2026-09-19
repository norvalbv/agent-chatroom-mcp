/** Frozen before confirmatory seeds: output includes task-dependent code/text, so only direct thinking classifies. */
export type ThinkingRegime = 'calibrated' | 'long-thinking' | 'unknown';
export const THINKING_REGIME_THRESHOLD = 4000;
const known = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;

export function classifyThinkingRegime(thinking: unknown): ThinkingRegime {
  if (!known(thinking)) return 'unknown';
  return thinking < THINKING_REGIME_THRESHOLD ? 'calibrated' : 'long-thinking';
}

/** Every model entry must report thinking; partial sums cannot establish a complete short-regime count. */
export function modelThinkingTokens(modelUsage: unknown): number | null {
  if (!modelUsage || typeof modelUsage !== 'object' || Array.isArray(modelUsage)) return null;
  const values = Object.values(modelUsage).map((value: unknown) =>
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>).thinkingTokens : null);
  return values.length && values.every(known) ? values.reduce<number>((sum, value) => sum + (value as number), 0) : null;
}
