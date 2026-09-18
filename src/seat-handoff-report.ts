/**
 * R1 seat-side handoff sidecar: a machine-readable one-line report the harness can read
 * from the seat's own log stream (bench-bench routes seat stdout/stderr into the arm's
 * hub.log). The line is structural over SeatResult: it exists whenever the runSeat result
 * carries a handoff and is empty otherwise, so the baseline build simply prints nothing and
 * the observed delta is the marker line itself.
 *
 * SeatResult.handoffs carries claim AREAS handed off (e.g. "bench-long-brief"); this normalises
 * them to the actual board keys written (handoff/<area>), and passes through full handoff/ keys
 * unchanged, so the marker stays truthful whichever shape the seat reports.
 */
export function handoffMarkerLine(result: unknown): string {
  const r = result as { handoffs?: unknown; handoffReason?: unknown } | null | undefined;
  const keys = Array.isArray(r?.handoffs)
    ? r.handoffs
        .filter((k): k is string => typeof k === "string" && k.trim() !== "")
        .map((k) => (k.startsWith("handoff/") ? k : `handoff/${k}`))
    : [];
  if (keys.length === 0) return "";
  const reason = typeof r?.handoffReason === "string" ? r.handoffReason : "";
  return `[seat-handoff] keys=${keys.join(",")} reason=${reason}`;
}
