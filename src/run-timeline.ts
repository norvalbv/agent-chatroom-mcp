/**
 * The time axis of a run, from the hub's own room log (data/<room>.jsonl): what each half hour produced and cost, how
 * large each seat's context was per model request, and where the log goes silent. run-metrics.ts gives one row per seat
 * for the whole run, which cannot show the two facts that explained swarm-094251-5y46: output fell 95% at 13:30 and
 * never came back while the room was held open three more hours, and every request re-read 0.45-0.9M tokens of
 * transcript (cache read was 65% of $296). Seats of the next room rebuilt both by hand from the log.
 * Usage is the seat process's own cumulative report; a counter that goes down is a respawned process, counted from zero.
 * The hub's live "room idle" rule is src/hub/idle.ts; quietFrom here is the after-the-fact reading of the same stall.
 */
type Ev = Record<string, any>;

export interface TimelineBucket {
  /** ISO start of the bucket */
  start: string;
  /** model requests, output tokens and cost reported by seats in this bucket */
  requests: number;
  outputTokens: number;
  costUsd: number;
  /** chat messages by agents (not system lines) */
  chat: number;
  boardWrites: number;
  /** work-ledger events: local tool calls on a new target */
  work: number;
  hubCalls: number;
  waits: number;
  /** waits that returned nothing to act on: each one is a paid model request that re-reads the seat's context */
  emptyWaits: number;
  recruits: number;
}

export interface SeatTimeline {
  name: string;
  requests: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number;
  /** input tokens per model request, cache reads and writes included: the transcript the seat re-read each time */
  meanContext: number;
  peakContext: number;
  /** times the per-request context fell below 60% of a previous one above 100k tokens */
  compactions: number;
  waits: number;
  emptyWaits: number;
}

export interface RunTimeline {
  room: string;
  bucketMinutes: number;
  buckets: TimelineBucket[];
  seats: SeatTimeline[];
  /** the longest stretch with no event of any kind in the log: a hub that was down shows up here */
  longestSilence?: { from: string; to: string; minutes: number };
  /** every stretch of five minutes or more with no event, in order */
  silences: { from: string; to: string; minutes: number }[];
  /** every note another room sent here (post_to_room: a board write of inbox/<from room>/<key>), in order, with the
   * minutes until this room acknowledged it (<key>.ack); a note rewritten before any ack was never acknowledged */
  notes: { key: string; from: string; at: string; by?: string; ackMinutes?: number }[];
  /** each result/<slug> entry and the first rerun/, verify/, review/ or attack/ entry on it (key <prefix>/<slug> or
   * <prefix>/<slug>-<anything>) written by someone other than the result's author; no review: by and minutes absent */
  reviews: { key: string; at: string; author?: string; by?: string; minutes?: number }[];
  /** the hub's own room-idle episodes (room_idle / room_active events, src/hub/idle.ts); an open one has no minutes */
  idle: { from: string; minutes?: number }[];
  /** each time the hub started again while this room was open (hub_restart events, src/hub.ts announceRestart): when, the
   * seconds the room went without a hub, and how the last hub stopped as far as it could say */
  restarts: { at: string; downSeconds: number; previous?: string }[];
  /** each successful request_agent call */
  recruitCalls: { at: string; by: string }[];
  /** start of the first bucket from which every later bucket's output stays under a fifth of the mean before it;
   * undefined when the run never went quiet or is shorter than four buckets */
  quietFrom?: string;
  /** cost reported from quietFrom to the end of the log */
  quietCostUsd?: number;
}

const QUIET_SHARE = 0.2;
const SILENCE_MIN = 5;
const REVIEW = /^(?:rerun|verify|review|attack)\/(.+)$/;
const stampOf = (e: Ev): string | undefined => e.ts ?? e.msg?.ts ?? e.entry?.updatedAt ?? e.entry?.ts ?? e.proposal?.createdAt ?? e.challenge?.ts ?? e.updatedAt ?? e.createdAt ?? (e.type === "join" ? e.p?.joinedAt : e.p?.leftAt);

/** The first bucket index from which output never recovers, or -1. Needs two buckets of work before it and two after. */
export function quietIndex(output: readonly number[]): number {
  for (let i = 2; i <= output.length - 2; i++) {
    const before = output.slice(0, i).reduce((a, b) => a + b, 0) / i;
    if (before > 0 && output.slice(i).every((o) => o < before * QUIET_SHARE)) return i;
  }
  return -1;
}

export function runTimeline(events: readonly Ev[], bucketMinutes = 30): RunTimeline {
  const span = bucketMinutes * 60_000;
  let room = "";
  let t0: number | undefined;
  let last: number | undefined;
  let silence: RunTimeline["longestSilence"];
  const silences: RunTimeline["silences"] = [];
  const notes: RunTimeline["notes"] = [];
  const recruitCalls: RunTimeline["recruitCalls"] = [];
  const openNote = new Map<string, RunTimeline["notes"][number]>();
  const reviews: RunTimeline["reviews"] = [];
  const idle: RunTimeline["idle"] = [];
  const restarts: RunTimeline["restarts"] = [];
  const buckets: TimelineBucket[] = [];
  const names = new Map<string, string>();
  const byKey = new Map<string, string>();
  const seats = new Map<string, SeatTimeline & { prev?: Ev; context: number; lastContext?: number }>();
  const seat = (id: string | undefined) => {
    const name = id ? names.get(id) : undefined;
    if (!id || !name) return undefined;
    let s = seats.get(id);
    if (!s) seats.set(id, (s = { name, requests: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0, meanContext: 0, peakContext: 0, compactions: 0, waits: 0, emptyWaits: 0, context: 0 }));
    return s;
  };
  const bucket = (ts: number) => {
    const i = Math.max(0, Math.floor((ts - t0!) / span));
    while (buckets.length <= i) buckets.push({ start: new Date(t0! + buckets.length * span).toISOString(), requests: 0, outputTokens: 0, costUsd: 0, chat: 0, boardWrites: 0, work: 0, hubCalls: 0, waits: 0, emptyWaits: 0, recruits: 0 });
    return buckets[i];
  };

  for (const e of events) {
    if (e.type === "room") room ||= e.room;
    if (e.type === "join" && e.p?.id) {
      names.set(e.p.id, e.p.name);
      if (e.p.seatKeyHash) byKey.set(e.p.seatKeyHash, e.p.id);
    }
    const stamp = stampOf(e);
    const ts = typeof stamp === "string" ? Date.parse(stamp) : NaN;
    if (Number.isNaN(ts)) continue;
    t0 ??= ts;
    if (last !== undefined && ts - last > 0) {
      const gap = { from: new Date(last).toISOString(), to: new Date(ts).toISOString(), minutes: Math.round((ts - last) / 6_000) / 10 };
      if (gap.minutes >= SILENCE_MIN) silences.push(gap);
      if (gap.minutes > (silence?.minutes ?? 0)) silence = gap;
    }
    if (last === undefined || ts > last) last = ts;
    const b = bucket(ts);
    switch (e.type) {
      case "usage": {
        const s = seat(byKey.get(e.seat));
        const u = e.usage;
        if (!s || !u) break;
        const n = (k: string) => Number(u[k] ?? 0);
        // a counter that went down is a new seat process (respawn): its numbers count from zero
        const prev = s.prev && n("requests") >= Number(s.prev.requests ?? 0) ? s.prev : {};
        const d = (k: string) => n(k) - Number(prev[k] ?? 0);
        s.prev = u;
        const requests = d("requests");
        const read = d("cache_read_input_tokens");
        const write = d("cache_creation_input_tokens");
        b.requests += requests;
        b.outputTokens += d("output_tokens");
        b.costUsd += d("cost_usd");
        s.requests += requests;
        s.outputTokens += d("output_tokens");
        s.cacheReadTokens += read;
        s.cacheWriteTokens += write;
        s.costUsd += d("cost_usd");
        if (requests <= 0) break;
        const context = (d("input_tokens") + read + write) / requests;
        s.context += context * requests;
        s.peakContext = Math.max(s.peakContext, context);
        if (s.lastContext !== undefined && s.lastContext > 100_000 && context < s.lastContext * 0.6) s.compactions++;
        s.lastContext = context;
        break;
      }
      case "call_completion": {
        b.hubCalls++;
        if (e.tool === "request_agent" && e.outcome === "success") {
          b.recruits++;
          recruitCalls.push({ at: new Date(ts).toISOString(), by: names.get(e.participant) ?? "?" });
        }
        if (e.tool !== "wait_for_messages") break;
        const s = seat(e.participant);
        b.waits++;
        if (s) s.waits++;
        if (e.empty === true) {
          b.emptyWaits++;
          if (s) s.emptyWaits++;
        }
        break;
      }
      case "message":
        if (e.msg?.kind === "chat" && e.msg.from?.id !== "system") b.chat++;
        break;
      case "board": {
        b.boardWrites++;
        const key = String(e.key ?? "");
        const by = e.entry?.by as string | undefined;
        if (key.startsWith("result/") && !reviews.some((r) => r.key === key)) reviews.push({ key, at: new Date(ts).toISOString(), ...(by ? { author: by } : {}) });
        const checked = REVIEW.exec(key)?.[1];
        if (checked) for (const r of reviews) {
          const slug = r.key.slice("result/".length);
          if (r.by === undefined && by && by !== r.author && (checked === slug || checked.startsWith(`${slug}-`))) Object.assign(r, { by, minutes: Math.round((ts - Date.parse(r.at)) / 6_000) / 10 });
        }
        if (!key.startsWith("inbox/") || !e.entry) break;
        if (key.endsWith(".ack")) {
          const sent = openNote.get(key.slice(0, -4));
          if (sent) sent.ackMinutes = Math.round((ts - Date.parse(sent.at)) / 6_000) / 10;
          openNote.delete(key.slice(0, -4));
          break;
        }
        const sent = { key, from: key.split("/")[1] ?? "", at: new Date(ts).toISOString(), ...(e.entry.by ? { by: e.entry.by as string } : {}) };
        notes.push(sent);
        openNote.set(key, sent);
        break;
      }
      case "work":
        b.work++;
        break;
      case "hub_restart":
        restarts.push({ at: new Date(ts).toISOString(), downSeconds: Number(e.down_s) || 0, ...(e.previous ? { previous: String(e.previous) } : {}) });
        break;
      case "room_idle":
        if (!idle.length || idle[idle.length - 1].minutes !== undefined) idle.push({ from: new Date(ts).toISOString() });
        break;
      case "room_active": {
        const open = idle[idle.length - 1];
        if (open && open.minutes === undefined) open.minutes = Math.round((ts - Date.parse(open.from)) / 6_000) / 10;
        break;
      }
    }
  }

  const q = quietIndex(buckets.map((b) => b.outputTokens));
  return {
    room,
    bucketMinutes,
    buckets,
    seats: [...seats.values()].map(({ prev: _prev, context, lastContext: _last, ...s }) => ({ ...s, meanContext: s.requests > 0 ? context / s.requests : 0 })),
    ...(silence ? { longestSilence: silence } : {}),
    silences,
    notes,
    reviews,
    idle,
    restarts,
    recruitCalls,
    ...(q >= 0 ? { quietFrom: buckets[q].start, quietCostUsd: Math.round(buckets.slice(q).reduce((a, b) => a + b.costUsd, 0) * 100) / 100 } : {}),
  };
}

const hhmm = (iso: string) => iso.slice(11, 16);
/** of a sorted list */
const median = (xs: number[]) => (xs[Math.floor((xs.length - 1) / 2)] + xs[Math.ceil((xs.length - 1) / 2)]) / 2;
const k = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : String(Math.round(n)));

/** The timeline as a report section (times are UTC). */
export function renderTimeline(t: RunTimeline): string {
  let text = `## Timeline\n\nFrom the hub's room log (${t.room}), in ${t.bucketMinutes}-minute steps, UTC. ` +
    (t.quietFrom ? `The room went quiet at ${hhmm(t.quietFrom)}: output from then on stayed under a fifth of what came before, and that stretch cost $${(t.quietCostUsd ?? 0).toFixed(2)}. ` : "Output never fell away for the rest of the run. ") +
    (t.longestSilence ? `The longest silence in the log: ${t.longestSilence.minutes} min from ${hhmm(t.longestSilence.from)} (no event of any kind; a stopped hub looks like this).` : "") +
    (t.silences.length > 1 ? ` All silences of ${SILENCE_MIN} min or more: ${t.silences.map((g) => `${hhmm(g.from)} (${g.minutes} min)`).join(", ")}.` : "") +
    "\n\nAn empty wait is a wait_for_messages that returned nothing to act on; the seat pays one model request for it.\n\n" +
    "| from | model requests | output tokens | cost | chat | board writes | tool calls | hub calls | waits (empty) | recruits |\n|---|---|---|---|---|---|---|---|---|---|\n";
  for (const b of t.buckets) text += `| ${hhmm(b.start)} | ${b.requests} | ${k(b.outputTokens)} | $${b.costUsd.toFixed(2)} | ${b.chat} | ${b.boardWrites} | ${b.work} | ${b.hubCalls} | ${b.waits} (${b.emptyWaits}) | ${b.recruits} |\n`;
  text += "\nContext is the input a seat sent per model request, cache reads and writes included: its transcript, re-read every time.\n\n" +
    "| seat | model requests | mean context | peak context | compactions | cache read | cache write | output | cost | waits (empty) |\n|---|---|---|---|---|---|---|---|---|---|\n";
  for (const s of t.seats) text += `| ${s.name} | ${s.requests} | ${k(s.meanContext)} | ${k(s.peakContext)} | ${s.compactions} | ${k(s.cacheReadTokens)} | ${k(s.cacheWriteTokens)} | ${k(s.outputTokens)} | $${s.costUsd.toFixed(2)} | ${s.waits} (${s.emptyWaits}) |\n`;
  if (t.notes.length) {
    const acked = t.notes.flatMap((x) => (x.ackMinutes === undefined ? [] : [x.ackMinutes])).sort((a, b) => a - b);
    text += `\n${t.notes.length} notes from other rooms, ${acked.length} acknowledged${acked.length ? ` (median ${median(acked)} min)` : ""}, ${t.notes.length - acked.length} never.\n\n` +
      "| at | note | from | acknowledged after |\n|---|---|---|---|\n" +
      t.notes.map((x) => `| ${hhmm(x.at)} | ${x.key} | ${x.by ?? x.from} | ${x.ackMinutes === undefined ? "never" : `${x.ackMinutes} min`} |\n`).join("");
  }
  if (t.reviews.length) {
    const done = t.reviews.flatMap((r) => (r.minutes === undefined ? [] : [r.minutes])).sort((a, b) => a - b);
    text += `\n${t.reviews.length} results, ${done.length} reviewed by another seat${done.length ? ` (median ${median(done)} min)` : ""}, ${t.reviews.length - done.length} never` +
      (t.reviews.length > done.length ? `: ${t.reviews.filter((r) => r.minutes === undefined).map((r) => r.key).join(", ")}` : "") + ".\n";
  }
  if (t.restarts.length) text += `\n${t.restarts.map((r) => `The hub restarted at ${hhmm(r.at)} after ${r.downSeconds} s${r.previous ? ` (${r.previous})` : ""}.`).join("\n")}\n`;
  if (t.idle.length) text += `\nThe hub said the room was idle at ${t.idle.map((x) => `${hhmm(x.from)} (${x.minutes === undefined ? "still idle at the end" : `${x.minutes} min`})`).join(", ")}.\n`;
  if (t.recruitCalls.length) text += `\nRecruits: ${t.recruitCalls.map((r) => `${hhmm(r.at)} ${r.by}`).join(", ")}.\n`;
  return `${text}\n`;
}
