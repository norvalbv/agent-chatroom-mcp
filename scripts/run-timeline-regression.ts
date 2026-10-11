/**
 * The run metrics had no time axis and no context size, so the two facts that explain swarm-094251-5y46 (output fell
 * 95% at 13:30 and never came back; each request re-read 0.45-0.9M tokens) were rebuilt by hand from the room log by
 * several seats of the next room. This pins run-timeline: both, computed from the hub's own log.
 * Run: npx tsx scripts/run-timeline-regression.ts
 */
import assert from 'node:assert/strict';

const mod = await import('../src/run-timeline.js').catch(() => null);
assert.ok(mod, 'src/run-timeline.ts exists');
const { runTimeline, renderTimeline } = mod;

const T0 = Date.parse('2026-10-10T09:00:00.000Z');
const at = (min: number) => new Date(T0 + min * 60_000).toISOString();
const usage = (seat: string, min: number, requests: number, out: number, read: number, write: number, cost: number) =>
  ({ type: 'usage', room: 'r', seat, ts: at(min), usage: { requests, input_tokens: 0, output_tokens: out, cache_read_input_tokens: read, cache_creation_input_tokens: write, cost_usd: cost } });
const wait = (pid: string, min: number, empty: boolean) => ({ type: 'call_completion', room: 'r', tool: 'wait_for_messages', outcome: 'success', ts: at(min), participant: pid, ms: 55000, empty });
const chat = (seq: number, min: number) => ({ type: 'message', msg: { seq, kind: 'chat', from: { id: 'p_a', name: 'alice' }, content: 'x', ts: at(min) } });

const events: any[] = [
  { type: 'room', room: 'r', opts: {}, createdAt: at(0) },
  { type: 'join', room: 'r', p: { id: 'p_a', name: 'alice', agent: 'claude', joinedAt: at(0), seatKeyHash: 'ka' } },
  // three busy half hours: 10 requests each, context climbing 100k -> 300k -> 500k per request
  usage('ka', 1, 0, 0, 0, 0, 0),
  usage('ka', 29, 10, 50_000, 900_000, 100_000, 3),
  usage('ka', 59, 20, 100_000, 3_900_000, 100_000, 6),
  usage('ka', 89, 30, 150_000, 8_900_000, 100_000, 9),
  // a compaction: the next 10 requests read 100k each
  usage('ka', 119, 40, 200_000, 9_900_000, 100_000, 12),
  // then the room goes quiet: requests go on, output all but stops
  usage('ka', 149, 50, 201_000, 10_900_000, 100_000, 13),
  usage('ka', 179, 60, 202_000, 11_900_000, 100_000, 14),
  usage('ka', 209, 70, 203_000, 12_900_000, 100_000, 15),
  chat(1, 5), chat(2, 40), chat(3, 70), chat(4, 100),
  { type: 'work', room: 'r', pid: 'p_a', cls: 'run', tool: 'Bash', target: 'x', ts: at(10) },
  { type: 'board', room: 'r', key: 'evidence/a', entry: { text: 'x', by: 'alice', updatedAt: at(12) } },
  wait('p_a', 130, true), wait('p_a', 131, true), wait('p_a', 160, true), wait('p_a', 20, false),
  // the hub was down from minute 180 to minute 200: nothing at all is written
  { type: 'call_completion', room: 'r', tool: 'board_get', outcome: 'success', ts: at(180), participant: 'p_a', ms: 1 },
  { type: 'call_completion', room: 'r', tool: 'board_get', outcome: 'success', ts: at(200), participant: 'p_a', ms: 1 },
];
events.sort((a, b) => String(a.ts ?? a.msg?.ts ?? a.entry?.updatedAt ?? a.createdAt ?? a.p?.joinedAt).localeCompare(String(b.ts ?? b.msg?.ts ?? b.entry?.updatedAt ?? b.createdAt ?? b.p?.joinedAt)));

const t = runTimeline(events);
assert.equal(t.bucketMinutes, 30);
assert.equal(t.buckets.length, 7, 'one bucket per half hour from the room opening to its last event');
assert.deepEqual(t.buckets.map((b: any) => b.requests), [10, 10, 10, 10, 10, 10, 10]);
assert.deepEqual(t.buckets.map((b: any) => b.outputTokens), [50_000, 50_000, 50_000, 50_000, 1_000, 1_000, 1_000]);
assert.equal(t.buckets[0].chat, 1);
assert.equal(t.buckets[0].work, 1);
assert.equal(t.buckets[0].boardWrites, 1);
assert.equal(t.buckets[4].emptyWaits, 2);
assert.equal(t.buckets[0].waits, 1);
assert.equal(t.buckets[0].emptyWaits, 0);
// the stall: output in every bucket from 11:00 on is under a fifth of the mean before it
assert.equal(t.quietFrom, at(120));
assert.equal(t.quietCostUsd, 3, 'what the quiet stretch cost');
// context per request, from the seat's own cumulative usage
const a = t.seats[0];
assert.equal(a.name, 'alice');
assert.equal(a.peakContext, 500_000);
assert.equal(a.compactions, 1, 'one drop to under 60% of a context above 100k');
assert.equal(a.emptyWaits, 3);
assert.equal(a.waits, 4);
assert.equal(Math.round(a.meanContext), Math.round(13_000_000 / 70));
// the longest stretch in which the log has no event at all: a hub outage shows up here
assert.equal(t.longestSilence!.minutes, 20);
assert.equal(t.longestSilence!.from, at(180));
assert.ok(t.silences.some((g: any) => g.minutes === 20 && g.from === at(180)) && t.silences.every((g: any) => g.minutes >= 5), 'every silence of five minutes or more is listed');
assert.deepEqual(t.silences.map((g: any) => g.from), [...t.silences.map((g: any) => g.from)].sort(), 'in order');

// a seat process that was respawned starts its counters again: that is a new process, not negative usage
const re = runTimeline([
  { type: 'room', room: 'r', opts: {}, createdAt: at(0) },
  { type: 'join', room: 'r', p: { id: 'p_a', name: 'alice', agent: 'claude', joinedAt: at(0), seatKeyHash: 'ka' } },
  usage('ka', 5, 10, 1000, 1_000_000, 0, 1), usage('ka', 10, 2, 300, 100_000, 0, 0.5),
]);
assert.equal(re.buckets[0].requests, 12);
assert.equal(re.buckets[0].outputTokens, 1300);
assert.equal(re.quietFrom, undefined, 'a short room has no stall to report');

// notes between rooms (post_to_room lands as inbox/<from room>/<key>): each write is one note, acknowledged by the next
// write of <key>.ack. A digest re-sent under one key every pass keeps only its last text on the board; the log has all.
const note = (key: string, min: number, by = 'consolidator') => ({ type: 'board', room: 'r', key, entry: { text: 'x', by, updatedAt: at(min) } });
const n = runTimeline([
  { type: 'room', room: 'r', opts: {}, createdAt: at(0) },
  { type: 'join', room: 'r', p: { id: 'p_a', name: 'alice', agent: 'claude', joinedAt: at(0), seatKeyHash: 'ka' } },
  note('inbox/leads/digest', 10), note('inbox/leads/digest.ack', 12, 'alice'),
  note('inbox/leads/digest', 30), note('inbox/leads/digest', 50), note('inbox/leads/digest.ack', 53, 'alice'),
  note('inbox/other/tip', 55),
  { type: 'call_completion', room: 'r', tool: 'request_agent', outcome: 'success', ts: at(20), participant: 'p_a', ms: 5 },
  { type: 'call_completion', room: 'r', tool: 'request_agent', outcome: 'hub_refusal', ts: at(21), participant: 'p_a', ms: 5 },
]);
assert.deepEqual(n.notes.map((x: any) => [x.key, x.from, x.ackMinutes]), [
  ['inbox/leads/digest', 'leads', 2], ['inbox/leads/digest', 'leads', undefined], ['inbox/leads/digest', 'leads', 3], ['inbox/other/tip', 'other', undefined],
], 'every note write, with minutes to its acknowledgement; a note overwritten before any ack was never acknowledged');
assert.deepEqual(n.recruitCalls, [{ at: at(20), by: 'alice' }], 'each successful recruit, when and by whom');
assert.match(renderTimeline(n), /4 notes from other rooms, 2 acknowledged \(median 2\.5 min\), 2 never/);
assert.match(renderTimeline(n), /Recruits: 09:20 alice/);

// review latency: a result/<slug> and the first rerun/, verify/, review/ or attack/ entry on it by someone else
const rv = runTimeline([
  { type: 'room', room: 'r', opts: {}, createdAt: at(0) },
  note('result/carry', 10, 'alice'), note('rerun/carry', 12, 'alice'), note('rerun/carry-bob', 19, 'bob'), note('verify/carry', 30, 'carol'),
  note('result/fade-v2', 20, 'bob'), note('result/fade', 21, 'bob'), note('rerun/fade', 26, 'alice'),
  note('result/lonely', 40, 'carol'),
  // the hub's room-idle episodes (src/hub/idle.ts) as they are in the record
  { type: 'room_idle', room: 'r', ts: at(45), idle: { since: at(45) }, steps: 2, seats: 3, window_min: 30 },
  { type: 'room_active', room: 'r', ts: at(58), idle_min: 13 },
  { type: 'room_idle', room: 'r', ts: at(70), idle: { since: at(70) }, steps: 0, seats: 3, window_min: 30 },
]);
assert.deepEqual(rv.reviews.map((x: any) => [x.key, x.by, x.minutes]), [
  ['result/carry', 'bob', 9], ['result/fade-v2', undefined, undefined], ['result/fade', 'alice', 5], ['result/lonely', undefined, undefined],
], 'first review by someone other than the author; the author rerunning their own result is not a review; rerun/fade is not a review of fade-v2');
assert.deepEqual(rv.idle.map((x: any) => [x.from, x.minutes]), [[at(45), 13], [at(70), undefined]], 'idle episodes, an open one has no length');
assert.match(renderTimeline(rv), /4 results, 2 reviewed by another seat \(median 7 min\), 2 never/);
assert.match(renderTimeline(rv), /The hub said the room was idle at 09:45 \(13 min\), 10:10 \(still idle at the end\)/);

const text = renderTimeline(t);
assert.match(text, /## Timeline/);
assert.match(text, /went quiet at 11:00/);
assert.match(text, /\| alice \|/);
assert.match(text, /longest silence in the log: 20 min from 12:00/);
assert.match(text, /All silences of 5 min or more: .*12:00 \(20 min\)/);
console.log('RUN TIMELINE OK');
