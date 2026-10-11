/**
 * The hub's clock, and the times seats state. No hub reply carried the time, so seats guessed it: of 40 present-tense
 * time statements by agents in the room records since 2026-10-10, 18 were more than five minutes off the hub's own
 * timestamp of that message and 8 lay in the future (evidence-pack item 13; scripts/hub-clock-regression.ts). Models do
 * not track wall-clock time on their own (arXiv:2601.13206), and being handed it is not always enough (arXiv:2510.23853),
 * so the hub both says the time on every reply and checks the time a seat writes.
 */

/** The time as replies carry it: UTC to the minute, the precision seats write times in. */
export const hubTime = (at = Date.now()) => `${new Date(at).toISOString().slice(0, 16)}Z`;

/** A stated time counts as wrong beyond this many minutes: a seat reads the clock, then writes for a while. */
export const TIME_CLAIM_SLACK_MIN = 5;

// a time said to be now, or when the text itself was written or the work began: "as of 14:20 UTC", "Started 14:50 UTC".
// "at 17:00 UTC" and "until 02:02 UTC" are schedules, and a bare "14:34:34" is evidence quoted from a log: neither is a claim.
const NOW_CUE = /\b(?:now|as of|it is|it's|currently|time is|written|stamped|started)\s+(?:at\s+)?(?:about\s+|around\s+|~\s*)?(\d{1,2}):(\d{2})(?::\d{2})?\s*(?:UTC\b|Z\b)/gi;

/** Present-tense times in a text that are more than TIME_CLAIM_SLACK_MIN from `at`, each with how far off (minutes,
 * positive = in the future), measured the short way round midnight. */
export function timeClaims(text: string, at = Date.now()): { stated: string; delta_min: number }[] {
  const now = new Date(at);
  const nowMin = now.getUTCHours() * 60 + now.getUTCMinutes();
  const out: { stated: string; delta_min: number }[] = [];
  for (const m of text.matchAll(NOW_CUE)) {
    const h = Number(m[1]), min = Number(m[2]);
    if (h > 23 || min > 59) continue;
    const delta = ((h * 60 + min - nowMin + 720) % 1440 + 1440) % 1440 - 720;
    if (Math.abs(delta) > TIME_CLAIM_SLACK_MIN) out.push({ stated: `${String(h).padStart(2, "0")}:${m[2]}`, delta_min: delta });
  }
  return out;
}

/** What the writer is told about the first wrong time in what it just wrote. */
export function timeNote(claims: { stated: string; delta_min: number }[], at = Date.now()): string | undefined {
  const c = claims[0];
  if (!c) return undefined;
  return `You wrote ${c.stated} UTC as the time; the hub's clock reads ${hubTime(at).slice(11, 16)} UTC (${Math.abs(c.delta_min)} min ${c.delta_min > 0 ? "earlier" : "later"}). ` +
    "If that time is part of a claim or a record, correct it; hub_time on every reply is the clock to copy.";
}
