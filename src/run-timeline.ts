/**
 * The time axis of a run, from the hub's own room log (data/<room>.jsonl): what each half hour produced and cost, how
 * large each seat's context was per model request, and where the log goes silent. run-metrics.ts gives one row per seat
 * for the whole run, which cannot show the two facts that explained swarm-094251-5y46: output fell 95% at 13:30 and
 * never came back while the room was held open three more hours, and every request re-read 0.45-0.9M tokens of
 * transcript (cache read was 65% of $296). Seats of the next room rebuilt both by hand from the log.
 * Usage is the seat process's own cumulative report; a counter that goes down is a respawned process, counted from zero.
 * The hub's live "room idle" rule is src/hub/idle.ts; quietFrom here is the after-the-fact reading of the same stall.
 */
import { coordinates } from "./hub/keys.js";
import { checksOf, verdictOf } from "./hub/checks.js";

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
  /** each result/<slug> entry and the first entry that checks it (src/hub/checks.ts: rerun/, audit/, review/, valid/,
   * critique/, check/, attack/, verify/, matched by key, by id or by naming it) written by someone other than the
   * result's author; no review: by and minutes absent */
  reviews: { key: string; at: string; author?: string; by?: string; minutes?: number; verdict?: "holds" | "fails" | "partial" }[];
  /** every entry, whatever the room called it (exp/Q4, result/x, decision/y), that another seat's check names: the count
   * that still means something in a room with no result/* keys (7 devkit logs read 0 / 0 in the pack's table) */
  checkedEntries: string[];
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
  const boardNow = new Map<string, { by: string }>();
  const checkedEntries = new Set<string>();
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
        // the hub's own resolver (src/hub/checks.ts), over the board as it stood when the check was written
        const checked = by && e.entry ? checksOf(key, by, String(e.entry.text ?? ""), boardNow).map((c) => c.of) : [];
        for (const k of checked) checkedEntries.add(k);
        const verdict = checked.length ? verdictOf(String(e.entry?.text ?? "")) : undefined;
        for (const r of reviews) if (r.by === undefined && by && by !== r.author && checked.includes(r.key)) Object.assign(r, { by, minutes: Math.round((ts - Date.parse(r.at)) / 6_000) / 10, ...(verdict ? { verdict } : {}) });
        if (e.entry && by) boardNow.set(key, { by }); else if (!e.entry) boardNow.delete(key);
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
    checkedEntries: [...checkedEntries],
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

/** One run, one row: what "further per hour and per dollar" can be read from (scripts/runs-table.ts). A result is a
 * result/* entry and reviewed means another seat reran, verified, reviewed or attacked it; a finding is any board entry
 * but claim/, draft/, inbox/ and hold/ (run-metrics' rule). Unknown cost stays undefined, never zero. */
export interface RunRow {
  room: string;
  /** the topic's first line */
  task: string;
  start?: string;
  hours: number;
  seats: number;
  costUsd?: number;
  results: number;
  reviewed: number;
  findings: number;
  firstProposalMin?: number;
  conclusionMin?: number;
  /** minutes from the start to the half hour output fell away for good (RunTimeline.quietFrom) */
  quietFromMin?: number;
  /** why the run ended, as its launcher told the hub (run_end event): concluded, timeout, operator_stop, seats_exited; absent: not recorded */
  endCause?: string;
  /** seats whose process ended, by cause (seat_exit events): usage_limit, sigterm, crash...; absent: none recorded */
  seatExits?: Record<string, number>;
  /** entries of any prefix that another seat's check names (RunTimeline.checkedEntries) */
  entriesChecked: number;
  /** how the room closed (evidence/ab-last-call-verifier-gate): electorate seats whose vote was not on the concluded version,
   * whether the verifier had agreed to it (null: no verifier seat), the last call's length; from conclusion.closing when the
   * log has it, else derived from join/leave/vote/amend events */
  close?: { version: number; notVotedOnFinal: number; electorate: number; verifierAgreed: boolean | null; lastCallSeconds?: number; source: "closing" | "events" };
  /** the reviewed results by what the first check declared (VERDICT: line); unstated: it declared none */
  verdicts: { holds: number; fails: number; partial: number; unstated: number };
  /** the owner's latest verdict on the room's conclusion (owner_verdict events): adopted, rejected, partial; absent: none given */
  ownerVerdict?: string;
  reviewedPerHour: number;
  usdPerReviewed?: number;
  usdPerFinding?: number;
}

const NOT_FINDING = { test: (key: string) => coordinates(key) || key.startsWith("draft/") };
const round2 = (x: number) => Math.round(x * 100) / 100;
/** Things that happen to a room after its seats stop: the owner archiving it from the dashboard (gwhf read 36.08 h for
 * 0.19 h of work), the sweep marking seats left, a hub restart, memory samples, idle signals, and a later room's seats
 * reading this log (outside_read: tky5 read 17.5 h because this round's seats opened its file 14 h after it ended).
 * They do not lengthen the run. A seat's usage still does: it is the seat working, though for a group lead it may be
 * work in its other room (1nwp-leads reads 3.62 h for 2.07 h to its conclusion); runTotals is the run's true span. */
const NOT_RUN_TIME = new Set(["archive", "leave", "hub_restart", "memory", "room_idle", "room_active", "room_waiting", "board_manifest", "outside_read", "overlap_notice", "run_end", "seat_exit", "owner_verdict"]);
/** Entries the launcher seeds (resource/* with --resources) are what the room was given, not what it found (35 of 214 in 0btz). */
const SEEDED_BY = new Set(["launcher"]);

/** RunRow.close: the conclusion's own closing record when it has one, else the same counts from the events. */
function closeOf(c: Record<string, any> | undefined, seats: Map<string, { name: string; role?: string; agent?: string; active: boolean }>, votesOf: Map<string, Record<string, { vote?: string; version?: number }>>): RunRow["close"] {
  if (!c) return undefined;
  const version = Number(c.version ?? 1);
  const electorate = [...seats].filter(([, p]) => p.active && p.agent !== "human" && p.role !== "chair");
  const hasVerifier = electorate.some(([, p]) => p.role === "verifier");
  if (c.closing) {
    const cl = c.closing;
    return { version, notVotedOnFinal: (cl.not_voted_on_final ?? []).length, electorate: electorate.length,
      verifierAgreed: cl.verifier ? !!cl.verifier.agreed : hasVerifier ? false : null,
      ...(typeof cl.last_call_seconds === "number" ? { lastCallSeconds: cl.last_call_seconds } : {}), source: "closing" };
  }
  const votes = votesOf.get(String(c.proposalId)) ?? {};
  const onFinal = (id: string) => (votes[id]?.version ?? 1) === version && !!votes[id]?.vote;
  const v = electorate.find(([, p]) => p.role === "verifier");
  return { version, notVotedOnFinal: electorate.filter(([id]) => !onFinal(id)).length, electorate: electorate.length,
    verifierAgreed: v ? votes[v[0]]?.vote === "agree" && onFinal(v[0]) : null, source: "events" };
}

export function runRow(events: readonly Ev[]): RunRow {
  const t = runTimeline(events);
  let task = "";
  let firstProposal: number | undefined;
  let conclusion: number | undefined;
  const keys = new Set<string>();
  let endCause: string | undefined;
  let ownerVerdict: string | undefined;
  const seatExits: Record<string, number> = {};
  // for the close (RunRow.close): seats present, the concluded proposal's standing votes, the conclusion record
  const seatsIn = new Map<string, { name: string; role?: string; agent?: string; active: boolean }>();
  const votesOf = new Map<string, Record<string, { vote?: string; version?: number }>>();
  let concluded: Record<string, any> | undefined;
  let first: number | undefined;
  let last: number | undefined;
  for (const e of events) {
    if (e.type === "room") task ||= String(e.opts?.topic ?? "").split("\n")[0].slice(0, 120);
    const ts = Date.parse(stampOf(e) ?? "");
    // the run is what seats did: a system line (the owner closing the room the next morning) does not lengthen it
    // ...nor does a wait that came back empty: polling, not work (0btz-leads: a chair polled every 15 s for an hour after it concluded)
    const system = (e.type === "message" && e.msg?.kind !== "chat") || NOT_RUN_TIME.has(e.type) || (e.type === "call_completion" && e.empty === true);
    if (!Number.isNaN(ts) && !system) { first = Math.min(first ?? ts, ts); last = Math.max(last ?? ts, ts); }
    if (e.type === "board" && e.entry && !NOT_FINDING.test(String(e.key)) && !SEEDED_BY.has(String(e.entry.by))) keys.add(String(e.key));
    if (e.type === "proposal" && e.proposal?.createdAt) firstProposal ??= Date.parse(e.proposal.createdAt);
    if (e.type === "run_end") endCause ??= String(e.cause);
    if (e.type === "owner_verdict") ownerVerdict = String(e.verdict);
    if (e.type === "seat_exit") seatExits[String(e.cause)] = (seatExits[String(e.cause)] ?? 0) + 1;
    if (e.type === "state" && e.conclusion?.decidedAt) conclusion ??= Date.parse(e.conclusion.decidedAt);
    if (!concluded) {
      if (e.type === "join" && e.p?.id) seatsIn.set(String(e.p.id), { name: String(e.p.name), role: e.p.role, agent: e.p.agent, active: true });
      if (e.type === "leave" && e.p?.id && seatsIn.has(String(e.p.id))) seatsIn.get(String(e.p.id))!.active = false;
      if (e.type === "proposal" && e.proposal?.id) votesOf.set(String(e.proposal.id), { ...(e.proposal.votes ?? {}) });
      if (e.type === "vote" && e.proposalId) votesOf.set(String(e.proposalId), { ...(votesOf.get(String(e.proposalId)) ?? {}), [String(e.pid)]: e.entry ?? {} });
      if (e.type === "amend" && e.proposalId) votesOf.set(String(e.proposalId), { ...(e.votes ?? {}) });
      if (e.type === "state" && e.state === "concluded" && e.conclusion) concluded = e.conclusion;
    }
  }
  const min = (ts: number | undefined) => (ts === undefined || first === undefined ? undefined : Math.round((ts - first) / 60_000));
  const hours = first === undefined || last === undefined ? 0 : round2((last - first) / 3_600_000);
  const priced = t.seats.filter((s) => s.requests > 0 || s.costUsd > 0);
  const costUsd = priced.length ? round2(priced.reduce((n, s) => n + s.costUsd, 0)) : undefined;
  const reviewed = t.reviews.filter((r) => r.minutes !== undefined).length;
  return {
    room: t.room,
    task,
    ...(first === undefined ? {} : { start: new Date(first).toISOString() }),
    hours,
    seats: t.seats.length,
    ...(costUsd === undefined ? {} : { costUsd }),
    results: t.reviews.length,
    reviewed,
    entriesChecked: t.checkedEntries.length,
    verdicts: (() => {
      const done = t.reviews.filter((r) => r.minutes !== undefined);
      const n = (v?: string) => done.filter((r) => r.verdict === v).length;
      return { holds: n("holds"), fails: n("fails"), partial: n("partial"), unstated: n(undefined) };
    })(),
    findings: keys.size,
    ...(firstProposal === undefined ? {} : { firstProposalMin: min(firstProposal) }),
    ...(conclusion === undefined ? {} : { conclusionMin: min(conclusion) }),
    ...(t.quietFrom ? { quietFromMin: min(Date.parse(t.quietFrom)) } : {}),
    ...(endCause ? { endCause } : {}),
    ...(ownerVerdict ? { ownerVerdict } : {}),
    ...(Object.keys(seatExits).length ? { seatExits } : {}),
    ...((() => { const c = closeOf(concluded, seatsIn, votesOf); return c ? { close: c } : {}; })()),
    reviewedPerHour: hours > 0 ? round2(reviewed / hours) : 0,
    ...(costUsd !== undefined && reviewed ? { usdPerReviewed: round2(costUsd / reviewed) } : {}),
    ...(costUsd !== undefined && keys.size ? { usdPerFinding: round2(costUsd / keys.size) } : {}),
  };
}

/** One run across its room logs (a grouped run has a leads room and a room per group). The hub writes a seat process's
 * cumulative usage to every room the seat sits in, so summing rooms pays a lead twice (0btz: $436.19 summed, $331.09
 * real; telemetry gap G1). Here each seat key's usage is merged across the logs, de-duplicated by its own timestamp,
 * and differenced once, with a counter that goes down read as a new process (respawn), as runTimeline does. */
export interface RunTotals {
  run: string; rooms: string[]; seats: number; costUsd?: number; hours: number; start?: string;
  /** per room with result/* entries: how many of them a seat checked from ANOTHER room of the run (crossRoomChecks) */
  crossChecked?: Record<string, { results: number; checkedFromOtherRooms: number; namedFromOtherRooms: number }>;
}

/**
 * Checks across the rooms of one run. Grouped runs put opposing groups in separate rooms, so a break group's rerun of a
 * build group's result sits in the break room: in swarm-100951-0btz the pack counted "build 5 of 14 reviewed (2 by
 * break)" by hand. The logs are merged in time order with a board per room; a check that resolves to nothing in its own
 * room (checksOf, the hub's resolver) is resolved against the other rooms as they stood at that moment.
 */
export function crossRoomChecks(logs: readonly (readonly Ev[])[]): Record<string, { results: number; checkedFromOtherRooms: number; namedFromOtherRooms: number }> {
  const events = logs.flatMap((log) => log.filter((e) => e.type === "board" && e.room).map((e) => ({ e, ts: Date.parse(stampOf(e) ?? "") })))
    .filter((x) => !Number.isNaN(x.ts)).sort((a, b) => a.ts - b.ts);
  const boards = new Map<string, Map<string, { by: string }>>();
  const results = new Map<string, Set<string>>();
  const checked = new Map<string, Set<string>>();
  const named = new Map<string, Set<string>>();
  const add = (m: Map<string, Set<string>>, room: string, key: string) => (m.get(room) ?? m.set(room, new Set()).get(room)!).add(key);
  for (const { e } of events) {
    const room = String(e.room), key = String(e.key ?? "");
    const mine = boards.get(room) ?? boards.set(room, new Map()).get(room)!;
    if (!e.entry) { mine.delete(key); continue; }
    const by = String(e.entry.by ?? "");
    if (key.startsWith("result/")) (results.get(room) ?? results.set(room, new Set()).get(room)!).add(key);
    const text = String(e.entry.text ?? "");
    // a note another room sent here under a checking name (inbox/<room>/attack-lone-pay-factor) is that room's check
    const note = /^inbox\/[^/]+\/((?:rerun|audit|review|valid|critique|check|attack)-.+)$/.exec(key)?.[1];
    const asCheck = note ? note.replace("-", "/") : key;
    if (by && !key.endsWith(".ack") && !checksOf(asCheck, by, text, mine).length) {
      for (const [other, b] of boards) {
        if (other === room) continue;
        for (const c of checksOf(asCheck, by, text, b)) if (c.of.startsWith("result/")) add(checked, other, c.of);
        // looser: any entry of this room's seats that names another room's result as a whole key, other than a digest or
        // an ack (in 0btz the break group answered build's results with result/* entries of its own, not reruns)
        if (!/digest|\.ack$/.test(key) && !/^digest/.test(by)) for (const [k, x] of b) if (k.startsWith("result/") && x.by !== by && text.includes(k)) add(named, other, k);
      }
    }
    mine.set(key, { by });
  }
  const count = (m: Map<string, Set<string>>, room: string, keys: Set<string>) => [...(m.get(room) ?? [])].filter((k) => keys.has(k)).length;
  return Object.fromEntries([...results].map(([room, keys]) => [room, { results: keys.size, checkedFromOtherRooms: count(checked, room, keys), namedFromOtherRooms: count(named, room, keys) }]));
}

export function runTotals(logs: readonly (readonly Ev[])[], run = ""): RunTotals {
  const rows = logs.map((events) => runRow(events));
  const seen = new Map<string, Map<string, Record<string, any>>>(); // seat key -> usage.at|ts -> usage
  for (const events of logs) for (const e of events) {
    if (e.type !== "usage" || !e.seat || !e.usage) continue;
    const key = String(e.usage.at ?? e.ts);
    (seen.get(e.seat) ?? seen.set(e.seat, new Map()).get(e.seat)!).set(key, e.usage);
  }
  let cost = 0;
  for (const byAt of seen.values()) {
    let prev: Record<string, any> = {};
    for (const [, u] of [...byAt].sort(([a], [b]) => a.localeCompare(b))) {
      const base = Number(u.requests ?? 0) >= Number(prev.requests ?? 0) ? prev : {};
      cost += Number(u.cost_usd ?? 0) - Number(base.cost_usd ?? 0);
      prev = u;
    }
  }
  const starts = rows.map((r) => r.start).filter((x): x is string => !!x).sort();
  const ends = rows.filter((r) => r.start).map((r) => Date.parse(r.start!) + r.hours * 3_600_000);
  return {
    run, rooms: rows.map((r) => r.room).sort(), seats: seen.size,
    ...(seen.size ? { costUsd: round2(cost) } : {}),
    hours: starts.length ? round2((Math.max(...ends) - Date.parse(starts[0])) / 3_600_000) : 0,
    ...(starts.length ? { start: starts[0] } : {}),
    ...((x) => (Object.keys(x).length ? { crossChecked: x } : {}))(logs.length > 1 ? crossRoomChecks(logs) : {}),
  };
}

/** The run a room belongs to, read from the launcher's naming (swarm-HHMMSS-xxxx-<room>): no room event records it yet (gap G12). */
export const runOf = (room: string) => /^(swarm-\d{6}-[a-z0-9]{4})/.exec(room)?.[1] ?? room;

export function renderRunTotals(runs: RunTotals[]): string {
  let text = "| run | rooms | seat processes | cost (each seat process once) | hours | results checked from another room (named there) |\n|---|---|---|---|---|---|\n";
  for (const r of [...runs].sort((a, b) => (a.start ?? "").localeCompare(b.start ?? ""))) {
    const cross = r.crossChecked ? Object.entries(r.crossChecked).map(([room, c]) => `${room} ${c.checkedFromOtherRooms} of ${c.results} (named ${c.namedFromOtherRooms})`).join(", ") : "-";
    text += `| ${r.run} | ${r.rooms.length} | ${r.seats} | ${r.costUsd === undefined ? "?" : `$${r.costUsd}`} | ${r.hours} | ${cross} |\n`;
  }
  return text;
}

/** Rows as a markdown table, oldest first. */
const closeText = (c: RunRow["close"]) => !c ? "-" : `${c.notVotedOnFinal} of ${c.electorate} unvoted${c.verifierAgreed === null ? "" : c.verifierAgreed ? ", verifier agreed" : ", verifier did not agree"}${c.lastCallSeconds !== undefined ? `, last call ${Math.round(c.lastCallSeconds)} s` : ""}`;
export function renderRunsTable(rows: RunRow[]): string {
  const v = (x: number | undefined, unit = "") => (x === undefined ? "?" : `${unit}${x}`);
  const dash = (x: number | undefined) => (x === undefined ? "-" : String(x));
  let text = "| room | task | hours | seats | cost | results / reviewed | reviewed per hour | $ per reviewed | findings | $ per finding | first proposal (min) | conclusion (min) | went quiet (min) | run ended | seat exits | entries checked | owner verdict | at the close |\n|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|\n";
  for (const r of [...rows].sort((a, b) => (a.start ?? "").localeCompare(b.start ?? ""))) {
    text += `| ${r.room} | ${r.task.replace(/\|/g, "/")} | ${r.hours} | ${r.seats} | ${v(r.costUsd, "$")} | ${r.results} / ${r.reviewed} | ${r.reviewedPerHour} | ${v(r.usdPerReviewed, "$")} | ${r.findings} | ${v(r.usdPerFinding, "$")} | ${dash(r.firstProposalMin)} | ${dash(r.conclusionMin)} | ${dash(r.quietFromMin)} | ${r.endCause ?? "-"} | ${r.seatExits ? Object.entries(r.seatExits).map(([k, n]) => `${k} ${n}`).join(", ") : "-"} | ${r.entriesChecked} | ${r.ownerVerdict ?? "-"} | ${closeText(r.close)} |\n`;
  }
  return text;
}
