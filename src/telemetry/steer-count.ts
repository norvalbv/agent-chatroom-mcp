/**
 * How often a room needed steering, from its log alone: chat from a human or a chair-role seat, and inbox/* notes a
 * human or chair wrote into the room (an .ack is not one). A note rewritten under the same key, or one that calls itself a
 * correction (or supersedes or withdraws an earlier one), counts as a correction rather than a note: in
 * swarm-130459-mrw4 the chair carried rulings to six rooms and corrected several, and every seat re-read each version.
 * A steer is evidence the room did not see something itself; fewer steers for the same brief is the proactivity measure.
 *   npx tsx scripts/steer-count.ts <data/room.jsonl>... [--json] [--minutes N]
 */
type Ev = Record<string, any>;

export interface SteerRow {
  room: string;
  steers: number;
  human_messages: number;
  chair_messages: number;
  /** steering messages that @-named a seat, rather than speaking to the room */
  addressed: number;
  notes: number;
  corrections: number;
  /** minutes from the room's first event to its first steer */
  first_steer_min?: number;
  /** working seats (agents other than a chair) that joined: each one reads every steer */
  seats: number;
}

const CORRECTION = /correction|supersed|withdrawn|retract/i;
const tsOf = (e: Ev): number => Date.parse(String(e.ts ?? e.msg?.ts ?? e.entry?.updatedAt ?? e.p?.joinedAt ?? ""));

/** withinMin: count only the room's first N minutes, so a short probe is compared with the same window of a long run. */
export function steerCount(logs: readonly (readonly Ev[])[], withinMin = Infinity): SteerRow[] {
  // a chair or human named in any of the logs is one in all of them (the chair carries notes from its own room)
  const steerer = new Set<string>(), seatsBy = new Map<string, Set<string>>();
  for (const events of logs) for (const e of events) if (e.type === "join" && e.p?.name) {
    if (e.p.agent === "human" || e.p.role === "chair") steerer.add(e.p.name);
    else (seatsBy.get(e.room) ?? seatsBy.set(e.room, new Set()).get(e.room)!).add(e.p.name);
  }
  return logs.map((events) => {
    const room = String(events.find((e) => e.room)?.room ?? events.find((e) => e.msg?.room)?.msg.room ?? "?");
    const row: SteerRow = { room, steers: 0, human_messages: 0, chair_messages: 0, addressed: 0, notes: 0, corrections: 0, seats: seatsBy.get(room)?.size ?? 0 };
    let start = Infinity, first = Infinity;
    const noteKeys = new Set<string>();
    for (const e of events) {
      const t = tsOf(e);
      if (!Number.isNaN(t)) start = Math.min(start, t);
      if (!Number.isNaN(t) && t - start > withinMin * 60_000) continue;
      let steer = false;
      if (e.type === "message" && e.msg?.kind === "chat" && steerer.has(e.msg.from?.name)) {
        steer = true;
        if (e.msg.from.agent === "human") row.human_messages++; else row.chair_messages++;
        if (/(^|\s)@[\w.-]+/.test(String(e.msg.content ?? ""))) row.addressed++;
      } else if (e.type === "board" && typeof e.key === "string" && e.key.startsWith("inbox/") && !e.key.endsWith(".ack") && steerer.has(e.entry?.by)) {
        steer = true;
        // mrw4's chair sent most corrections as new notes ("referee-r10c-correction", "a correction to my note ...")
        const fixes = CORRECTION.test(e.key) || CORRECTION.test(String(e.entry?.text ?? "").slice(0, 300));
        if (noteKeys.has(e.key) || fixes) row.corrections++; else row.notes++;
        noteKeys.add(e.key);
      }
      if (steer) { row.steers++; if (!Number.isNaN(t)) first = Math.min(first, t); }
    }
    if (first < Infinity && start < Infinity) row.first_steer_min = Math.round((first - start) / 60_000);
    return row;
  });
}

export function renderSteers(rows: readonly SteerRow[]): string {
  let text = "Steers: chat from a human or chair, and inbox notes they wrote into the room (a rewrite of one is a correction).\n\n| room | steers | human | chair | @-addressed | notes | corrections | first steer (min) | seats reading |\n|---|---|---|---|---|---|---|---|---|\n";
  for (const r of rows) text += `| ${r.room} | ${r.steers} | ${r.human_messages} | ${r.chair_messages} | ${r.addressed} | ${r.notes} | ${r.corrections} | ${r.first_steer_min ?? "-"} | ${r.seats} |\n`;
  const all = rows.reduce((n, r) => n + r.steers, 0), reads = rows.reduce((n, r) => n + r.steers * r.seats, 0);
  return `${text}\n${all} steers in ${rows.length} room${rows.length === 1 ? "" : "s"}, ${reads} seat-reads of them.`;
}
