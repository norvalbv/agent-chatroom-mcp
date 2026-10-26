/**
 * Re-research in one room log (inputs/owner-4: "the agents must ensure they're not researching what has already been
 * researched ... please ensure it's covered in a form of telemetry"). Read by runs-table and run-metrics.
 * A fetch is a web work event (WebFetch, or a command reaching a URL) whose target names a paper, repo or package
 * (refsIn, src/telemetry/source-refs.ts); a page with no such id is not counted. Each counted fetch is at most one of:
 * - carried: the id was on the list the seat was told was already read (the `carried` event, recordCarried in
 *   src/telemetry/launch-reports.ts: one per room the launcher creates, one per recruit request; a break-out opened with
 *   join_room(parent=) gets neither, so its seats' lists read unknown);
 * - afterSummary: another seat had already put a sources/* entry for that id on this room's board;
 * - repeat: another seat had fetched it first (no summary yet);
 * - verifierRepeat: a verifier reading what a seat cited, the check it is there for, kept apart.
 * carriedSummaries counts sources/* entries whose own id (its key, else its first line) was on the writer's list.
 * Without a carried event for a seat, what it was told is unknown: carriedFetches is then counted over the seats whose
 * list is known, undefined when none is, never 0. A lower bound: a fetch through a mirror refsIn does not fold, or a
 * paper read by title search alone, is not seen (review/024099de).
 */
import { refsIn } from "./source-refs.js";

type Ev = Record<string, any>;

export interface ReResearch {
  /** every seat that made a counted fetch had a carried event */
  listKnown: boolean;
  /** distinct ids on the lists the room's seats were told (union) */
  carriedIds: number;
  fetches: number;
  carriedFetches?: number;
  repeatFetches: number;
  afterSummary: number;
  verifierRepeats: number;
  carriedSummaries?: number;
}

export function reResearch(events: readonly Ev[]): ReResearch {
  const names = new Map<string, { name: string; role?: string }>();
  // a launcher event with no seats covers every seat the launcher started (all but recruits)
  const told = new Map<string, Set<string>>();
  let launcherList: Set<string> | undefined;
  const summarisedBy = new Map<string, string>();
  const fetchedBy = new Map<string, Set<string>>();
  const fetchers = new Set<string>();
  let fetches = 0, carried = 0, repeat = 0, after = 0, verifier = 0, carriedSum = 0;
  let anyList = false;
  const byName = new Map<string, string>(); // name -> role
  const listOf = (seat: string): Set<string> | undefined => told.get(seat) ?? (launcherList && byName.get(seat) !== "recruit" ? launcherList : undefined);
  // seats and what they were told first: a seat is told at its start, while the launcher's event can land after a seat's first call
  for (const e of events) {
    if (e.type === "join" && e.p?.id) { names.set(String(e.p.id), { name: String(e.p.name), role: e.p.role }); byName.set(String(e.p.name), e.p.role); }
    else if (e.type === "carried") {
      anyList = true;
      const ids = new Set<string>((e.ids ?? []).map(String));
      if (Array.isArray(e.seats) && e.seats.length) for (const s of e.seats) told.set(String(s), ids);
      else launcherList = ids;
    }
  }
  for (const e of events) {
    if (e.type === "board" && e.entry && String(e.key ?? "").startsWith("sources/")) {
      const key = String(e.key), by = String(e.entry.by ?? "");
      if (by === "launcher") continue;
      const own = refsIn(key.slice("sources/".length)).length ? refsIn(key.slice("sources/".length)) : refsIn(String(e.entry.text ?? "").split("\n")[0]);
      const list = listOf(by);
      if (list && own.some((id) => list.has(id))) carriedSum++;
      for (const id of own) if (!summarisedBy.has(id)) summarisedBy.set(id, by);
    } else if (e.type === "work" && e.cls === "web") {
      const seat = names.get(String(e.pid));
      const who = seat?.name ?? String(e.pid);
      for (const id of refsIn(String(e.target ?? ""))) {
        fetches++;
        fetchers.add(who);
        const list = listOf(who);
        const earlier = fetchedBy.get(id);
        const summary = summarisedBy.get(id);
        if (list?.has(id)) carried++;
        else if (earlier && !earlier.has(who) && seat?.role === "verifier") verifier++;
        else if (summary && summary !== who && !earlier?.has(who)) after++;
        else if (earlier && !earlier.has(who)) repeat++;
        (earlier ?? fetchedBy.set(id, new Set()).get(id)!).add(who);
      }
    }
  }
  const all = new Set<string>([...(launcherList ?? []), ...[...told.values()].flatMap((s) => [...s])]);
  const known = [...fetchers].every((s) => !!listOf(s));
  return {
    listKnown: anyList && known,
    carriedIds: all.size,
    fetches,
    ...(anyList ? { carriedFetches: carried } : {}),
    repeatFetches: repeat,
    afterSummary: after,
    verifierRepeats: verifier,
    ...(anyList ? { carriedSummaries: carriedSum } : {}),
  };
}

/** One cell for runs-table: "carried 2 of 7, in-run 2 (+1 verifier)", or "list unknown, ..." without the event. */
export function reResearchCell(r: ReResearch | undefined): string {
  if (!r || !r.fetches && !r.carriedSummaries) return "-";
  const across = r.carriedFetches === undefined ? "list unknown" : `carried ${r.carriedFetches} of ${r.fetches}${r.listKnown ? "" : " (some lists unknown)"}${r.carriedSummaries ? `, ${r.carriedSummaries} re-summarised` : ""}`;
  return `${across}, in-run ${r.repeatFetches + r.afterSummary}${r.verifierRepeats ? ` (+${r.verifierRepeats} verifier)` : ""}`;
}

/** One sentence for run-metrics. */
export function reResearchSentence(r: ReResearch): string {
  if (!r.fetches && !r.carriedSummaries) return "";
  const told = r.carriedFetches === undefined
    ? "what the seats were told was already read is not in this log (no carried event), so re-research across runs is unknown"
    : `${r.carriedFetches} of them fetched an id the seat was told was already read${r.listKnown ? "" : " (some seats' lists unknown)"}, and ${r.carriedSummaries ?? 0} sources/* entries summarised such an id again`;
  return `Re-research: ${r.fetches} paper or repo fetches; ${told}; ${r.repeatFetches} repeated another seat's earlier fetch and ${r.afterSummary} came after another seat's sources/* summary was on the board${r.verifierRepeats ? `; ${r.verifierRepeats} were a verifier checking a cited source` : ""}.`;
}
