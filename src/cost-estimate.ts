/**
 * Rough pre-launch cost guide, printed by the launcher so whoever starts a run sees what seats x minutes means before
 * spending it. The rates are cost per seat per wall-clock minute of claude-opus-5-5 seats, measured over Study 3's
 * 18 counted pool runs (bench/results/pool-throughput; cost from the CLI's own usage, divided by seats and the run's
 * minutes): minimum 0.068, median 0.173, maximum 0.399 USD. Other models are not priced here. Rooms usually end before
 * the timeout, so a guide computed at the timeout is an upper bound for a run that finishes early.
 */
export const OPUS_USD_PER_SEAT_MINUTE = { low: 0.068, median: 0.173, high: 0.399 } as const;

export function launchCostGuide(seats: number, timeoutMin: number): string {
  const at = (rate: number) => `$${Math.round(seats * timeoutMin * rate)}`;
  const r = OPUS_USD_PER_SEAT_MINUTE;
  return `cost guide: ${seats} seat(s) x up to ${timeoutMin} min. claude-opus-5-5 seats cost $${r.low.toFixed(2)}-$${r.high.toFixed(2)} per seat-minute in the pool study (median $${r.median.toFixed(2)}), so about ${at(r.median)} (range ${at(r.low)}-${at(r.high)}) if every seat is Opus and stays to the timeout; other models are not priced here, and rooms usually finish earlier.`;
}
