import { briefSeeds } from "./seat-targets.js";

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

/** Above this many agents in one room the launcher prints a size note. 4 is the default and 5 + a verifier the owner's
 * usual room; past 6, Claude rooms made 2.5 findings per seat against 3.2 at 4-5 seats (runs-table over 332 room
 * records, n=27 and 44; decision/room-size). */
export const SIZE_NOTE_ABOVE = 6;

/**
 * A size note, never a refusal (settled axis flat-seats-capped-per-model: the owner rejected a seat cap, so this changes
 * no launch command). Evidence, swarm-005940-77tu-room evidence/room-size over 332 room records: within one room an extra
 * seat adds a seat's cost and a seat's board output (26 rooms, 209 half-hours), recruits yield like launch seats
 * (37 rooms, sign test p=0.74), but landed results do not grow (paper Study 3: 15 seats landed no more of a 20-item pool
 * than 3, at 2.5-3.5x the cost per item), and the share of seats with no finding rises from 4% at 2-3 seats to 10% at
 * 9-12 and 18% at 13+ (runs-table idleSeats over 110 Claude rooms; task and era confound it). `briefItems` is the
 * brief's first numbered list (src/seat-targets.ts), so a brief that numbers its rules first counts the rules.
 */
export function launchSizeNote(o: { roomSeats: number; workers: number; briefItems: number }): string {
  if (o.roomSeats <= SIZE_NOTE_ABOVE) return "";
  const items = o.briefItems > 0 && o.workers > o.briefItems
    ? ` The brief lists ${o.briefItems} items for ${o.workers} workers: ${o.workers - o.briefItems} start on a second angle of an item another seat has.`
    : "";
  return `size note: ${o.roomSeats} agents in one room. In this hub's records an extra seat adds a seat's cost but not landed results: on a 20-item pool with hidden tests (paper Study 3) 15 seats landed no more than 3, at 2.5-3.5x the cost per item, and in Claude rooms above 8 seats 10-18% of seats made nothing. Recruits added later yielded as much as launch seats (37 rooms), so starting at 4-5 and letting the room recruit into named items costs nothing in output.${items} This is a note, not a cap: the run starts as asked.`;
}

/** result.json's `sizing`: the largest room the launcher starts, its workers, the brief's numbered items, and whether
 * the size note was printed. */
export interface LaunchSizing { room_seats: number; workers: number; brief_items: number; note: boolean }

/** What the launcher prints before any seat starts: the cost guide, then the size note when one room will hold more
 * than SIZE_NOTE_ABOVE agents. --flat puts every agent in one room, verifier included; --groups puts each group's
 * workers in a room of its own (the verifier sits in the leads room); a planned run's rooms are the planner's to size,
 * so it gets no sizing record. Seat targets off (--no-seat-targets) means no seat starts on a listed item. */
export function launchGuide(o: { total: number; timeoutMin: number; flat: boolean; groupWorkers?: number[]; task: string; seatTargets: boolean }, log: (line: string) => void): LaunchSizing | undefined {
  log(launchCostGuide(o.total, o.timeoutMin));
  if (!o.flat && !o.groupWorkers?.length) return undefined;
  const room_seats = o.flat ? o.total : Math.max(...o.groupWorkers!);
  const workers = o.flat ? o.total - 1 : room_seats;
  const brief_items = o.flat && o.seatTargets ? briefSeeds(o.task).length : 0;
  const note = launchSizeNote({ roomSeats: room_seats, workers, briefItems: brief_items });
  if (note) log(note);
  return { room_seats, workers, brief_items, note: !!note };
}
