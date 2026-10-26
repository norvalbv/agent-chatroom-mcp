/**
 * Columns of runs-table (src/run-timeline.ts runRow) read in their own pass over a room log, kept here because
 * run-timeline.ts is at its size ceiling: how seats ended (seat exits, idle reaps) and re-research (inputs/owner-4).
 */
import { reResearch, reResearchCell, type ReResearch } from "./re-research.js";

type Ev = Record<string, any>;

export interface RunColumns {
  /** seats whose process ended, by cause (seat_exit events): usage_limit, sigterm, crash...; absent: none recorded */
  seatExits?: Record<string, number>;
  /** idle reaps (owner ask 2): reap_check events by outcome (reaped, spared, chair_kept) when the log has them; in an older
   * log, sessions the reaper closed and took the seat with (session closed, reason "reaped", seat_kept false). A reap
   * also writes a session line, so the two are never added. Absent: none. 9f66's reaps were session lines only. */
  reaps?: Record<string, number>;
  /** re-research (src/telemetry/re-research.ts); absent when the room fetched no paper, repo or package */
  reResearch?: ReResearch;
}

export function runColumns(events: readonly Ev[]): RunColumns {
  const seatExits: Record<string, number> = {};
  const reapChecks: Record<string, number> = {};
  let sessionReaps = 0;
  const bump = (m: Record<string, number>, k: unknown) => { m[String(k)] = (m[String(k)] ?? 0) + 1; };
  for (const e of events) {
    if (e.type === "seat_exit") bump(seatExits, e.cause);
    else if (e.type === "reap_check") bump(reapChecks, e.outcome);
    else if (e.type === "session" && e.event === "closed" && /reaped/.test(String(e.reason ?? "")) && e.seat_kept !== true) sessionReaps++;
  }
  const r = reResearch(events);
  return {
    ...(Object.keys(seatExits).length ? { seatExits } : {}),
    ...(Object.keys(reapChecks).length ? { reaps: reapChecks } : sessionReaps ? { reaps: { reaped: sessionReaps } } : {}),
    ...(r.fetches || r.carriedSummaries ? { reResearch: r } : {}),
  };
}

const counts = (m: Record<string, number> | undefined) => (m ? Object.entries(m).map(([k, n]) => `${k} ${n}`).join(", ") : "-");

/** The reaps and re-research cells, runs-table's last two columns. */
export const lateCells = (r: RunColumns) => `${counts(r.reaps)} | ${reResearchCell(r.reResearch)}`;
