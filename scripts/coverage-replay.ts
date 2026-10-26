/**
 * Per item of a room's item/* ledger, from its `coverage` events (src/hub/coverage/coverage.ts): when it was first written,
 * minutes until a claim first covered it, minutes it spent with nobody on it (unowned or orphaned), who held it, and the
 * state it ended in. A room without item/* entries has no coverage events and prints nothing.
 *   npx tsx scripts/coverage-replay.ts <room.jsonl | data dir> [...]
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const OPEN = new Set(["unowned", "orphaned"]);
type CoverageEvent = { type: "coverage"; room: string; states?: Record<string, string>; owners?: Record<string, string[]>; ts: string };
export interface ItemReplay { room: string; key: string; first: string; min_to_owner: number | null; min_open: number; owners: string[]; end: string }

const minutes = (a: string, b: string) => Math.round(((Date.parse(b) - Date.parse(a)) / 60000) * 10) / 10;

/** Pure: the per-item rows of one room's events, in log order. `end` defaults to the last event's time. */
export function replayCoverage(events: Record<string, any>[], end?: string): ItemReplay[] {
  const cov = events.filter((e): e is CoverageEvent => e.type === "coverage" && !!e.states);
  if (!cov.length) return [];
  const last = end ?? cov[cov.length - 1].ts;
  const rows = new Map<string, ItemReplay & { openSince: string | null }>();
  for (const e of cov) {
    for (const [key, state] of Object.entries(e.states!)) {
      let r = rows.get(key);
      if (!r) rows.set(key, (r = { room: e.room, key, first: e.ts, min_to_owner: null, min_open: 0, owners: [], end: state, openSince: null }));
      if (state !== "unowned" && r.min_to_owner === null) r.min_to_owner = minutes(r.first, e.ts);
      if (OPEN.has(state) && r.openSince === null) r.openSince = e.ts;
      if (!OPEN.has(state) && r.openSince !== null) (r.min_open += minutes(r.openSince, e.ts)), (r.openSince = null);
      r.owners = [...new Set([...r.owners, ...(e.owners?.[key] ?? [])])];
      r.end = state;
    }
  }
  return [...rows.values()].map(({ openSince, ...r }) => ({ ...r, min_open: Math.round((r.min_open + (openSince ? minutes(openSince, last) : 0)) * 10) / 10 }));
}

function main() {
  const files = process.argv.slice(2).flatMap((p) => (statSync(p).isDirectory() ? readdirSync(p).filter((f) => f.endsWith(".jsonl")).map((f) => join(p, f)) : [p]));
  for (const file of files) {
    const events = readFileSync(file, "utf8").split("\n").filter(Boolean).flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } });
    const lastTs = events.map((e) => e.ts ?? e.at ?? e.createdAt).filter(Boolean).pop();
    for (const r of replayCoverage(events, lastTs)) console.log(JSON.stringify(r));
  }
}
if (process.argv[1]?.endsWith("coverage-replay.ts")) main();
