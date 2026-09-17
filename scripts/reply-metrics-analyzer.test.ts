/** Shared analyzer contract. Run: npx tsx scripts/reply-metrics-analyzer.test.ts */
import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hub } from "../src/hub.js";
import { analyzeReplyMetrics, parseReplyWindowMinutes } from "../src/reply-metrics.js";

const room = "metric-fixture";
const ts = (minutes: number) => new Date(Date.UTC(2026, 0, 1) + minutes * 60_000).toISOString();
const who = (id: string, agent = "test") => ({ id, name: id, agent });
const member = (id: string, type = "join", agent = "test") => ({ type, room, p: { ...who(id, agent), active: type === "join", joinedAt: ts(0), lastActiveAt: ts(0), session: `SECRET-${id}` } });
const msg = (seq: number, from: string, minute: number, mentions: string[] = [], extra: object = {}) => ({ type: "message", msg: { seq, id: `m${seq}`, room, kind: "chat", from: who(from), ts: ts(minute), content: "prose deliberately lacks literal tokens", mentions, ...extra } });
const base = () => [member("a"), member("b"), member("c"), member("human", "join", "human"), member("hub", "join", "hub")];
// Fixtures intentionally model a partial historical log without requiring full Participant snapshots.
const analyze = (events: any[], end = 30, opts: object = {}) => analyzeReplyMetrics(events, { observationEnd: ts(end), asOf: ts(end), ...opts });

test("pair unit deduplicates targets, excludes self/human/hub/openings, includes quiet and persisted-only mentions", () => {
  const result = analyze([...base(),
    msg(1, "a", 0, ["a", "b", "b", "c", "human", "hub"], { quiet: true }),
    msg(2, "a", 0, ["b"], { tag: "opening" }),
    msg(3, "human", 0, ["b"], { from: who("human", "human") }),
    msg(4, "hub", 0, ["b"], { from: who("hub", "hub") }),
  ]);
  assert.equal(result.mentions, 2);
  assert.equal(result.live_mentions, 2);
  assert.equal(result.to_departed, 0);
  assert.equal(result.departure_unknown, 0);
  assert.ok(!JSON.stringify(result).includes("SECRET"), "no connection identifiers in aggregate metrics");
});

test("strict reply is later target chat, not generic activity/opening/wrong-author reply", () => {
  const events = [...base(), msg(1, "a", 0, ["b"]),
    msg(2, "b", 1, [], { kind: "vote" }), msg(3, "b", 2),
    msg(4, "c", 3, [], { replyTo: "m1" }),
    msg(5, "b", 4, [], { replyTo: "m1", tag: "opening" })];
  const before = analyze(events);
  assert.equal(before.answered_within_window, 0);
  assert.equal(before.activity_within_window, 1);
  assert.equal(analyze([...events, msg(6, "b", 15, [], { replyTo: "m1" })]).answered_within_window, 1);
  assert.equal(analyze([...events, msg(6, "b", 15.0001, [], { replyTo: "m1" })]).answered_within_window, 0);
});

test("@-back credits each earlier ask, but a future ask cannot take earlier reply credit", () => {
  const result = analyze([...base(), msg(1, "a", 0, ["b"]), msg(2, "a", 1, ["b"]),
    msg(3, "b", 2, ["a"]), msg(4, "a", 3, ["b"])]);
  assert.equal(result.mentions, 4, "reply mentions are themselves pairs");
  assert.equal(result.answered_within_window, 3, "two a asks answered by b; b ask answered by later a");
});

test("membership follows event order through departure and rejoin, never final active state", () => {
  const result = analyze([member("a"), member("b"), msg(1, "a", 0, ["b"]), member("b", "leave"),
    msg(2, "a", 1, ["b"]), member("b"), msg(3, "a", 2, ["b"]),
    msg(4, "b", 3, [], { replyTo: "m2" }), member("b", "leave")]);
  assert.equal(result.mentions, 3);
  assert.equal(result.live_mentions, 2);
  assert.equal(result.to_departed, 1);
  assert.equal(result.answered_within_window, 0, "reply to departed-at-ask pair cannot enter live numerator");
});

test("missing target membership remains unknown even if a later join appears", () => {
  const result = analyze([member("a"), msg(1, "a", 0, ["missing"]), member("missing")]);
  assert.equal(result.mentions, 1);
  assert.equal(result.departure_unknown, 1);
  assert.equal(result.live_mentions, 0);
  assert.equal(result.to_departed, 0);
  assert.equal(result.reply_rate, null);
  assert.equal(result.mature_reply_rate, null);
});

test("raw vs mature vs pending preserves early-answered pending pairs", () => {
  const result = analyze([...base(), msg(1, "a", 0, ["b"]), msg(2, "b", 1, [], { replyTo: "m1" }),
    msg(3, "a", 18, ["b"]), msg(4, "b", 19, [], { replyTo: "m3" }), msg(5, "a", 20, ["c"])], 20);
  assert.equal(result.live_mentions, 3);
  assert.equal(result.answered_within_window, 2);
  assert.equal(result.reply_rate, 2 / 3);
  assert.equal(result.mature_live_mentions, 1);
  assert.equal(result.mature_answered_within_window, 1);
  assert.equal(result.mature_reply_rate, 1);
  assert.equal(result.pending_live_mentions, 2);
});

test("frozen prefix excludes later replies and uses prefix observation end", () => {
  const events = [...base(), msg(1, "a", 0, ["b"]), msg(2, "c", 5), msg(3, "b", 10, [], { replyTo: "m1" })];
  const prefix = analyzeReplyMetrics(events as any, { maxSeq: 2 });
  const full = analyzeReplyMetrics(events as any);
  assert.equal(prefix.answered_within_window, 0);
  assert.equal(prefix.observation_end, ts(5));
  assert.equal(full.answered_within_window, 1);
  assert.equal(full.observation_end, ts(10));
});

test("historical passes are not timed strict replies or manufactured declines", () => {
  const result = analyze([...base(), msg(1, "a", 0, ["b"]), { ...member("b", "leave"), p: { ...member("b").p, active: false, passes: 2 } }]);
  assert.equal(result.answered_within_window, 0);
  assert.equal(result.declined_within_window, null);
  assert.equal(result.decline_coverage, "unknown");
});

test("configurable bounded finite window", () => {
  assert.equal(parseReplyWindowMinutes(undefined), 15);
  for (const value of [1, "1", "0.5", 1440]) assert.equal(parseReplyWindowMinutes(value), Number(value));
  for (const value of ["", " ", 0, -1, "NaN", "Infinity", Infinity, NaN, 1441, "15junk", [], ["15"], { a: 15 }]) {
    assert.throws(() => parseReplyWindowMinutes(value), `must reject ${JSON.stringify(value)}`);
  }
  assert.equal(analyze([...base(), msg(1, "a", 0, ["b"]), msg(2, "b", 2, [], { replyTo: "m1" })], 30, { windowMinutes: 1 }).answered_within_window, 0);
});

test("live, persisted replay and reloaded hub share the same historical analyzer", () => {
  const dir = mkdtempSync(join(tmpdir(), "reply-metric-parity-"));
  try {
    const hub = new Hub({ dataDir: dir });
    const { room: live, participant: a } = hub.join("parity", "asker", "test", { expectedParticipants: 0, anonymous: true });
    const { participant: b } = hub.join("parity", "target", "test");
    const ask = hub.send("parity", a.id, "@B @target: Check this", undefined, true, true);
    hub.send("parity", b.id, "Checked", ask.id, true);
    hub.leave("parity", b.id);
    const metrics = (hub.stats(live) as any).reply_metrics;
    const events = readFileSync(join(dir, "parity.jsonl"), "utf8").trim().split("\n").map(line => JSON.parse(line));
    const replay = analyzeReplyMetrics(events, { asOf: metrics.as_of, observationEnd: metrics.observation_end });
    assert.deepEqual(replay, metrics);
    const reloaded = new Hub({ dataDir: dir });
    const again = (reloaded.stats(reloaded.rooms.get("parity")!) as any).reply_metrics;
    for (const key of ["mentions", "live_mentions", "to_departed", "answered_within_window", "pending_live_mentions"]) {
      assert.equal(again[key], metrics[key], key);
    }
    assert.equal(metrics.mentions, 1, "aliases and repeated tokens are one persisted pair");
    assert.equal(metrics.live_mentions, 1, "later departure cannot change original denominator");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Closure can be years old: never age a closed room using today's wall clock.
test("closed hub uses last observed event rather than analysis wall clock", () => {
  const dir = mkdtempSync(join(tmpdir(), "reply-metric-closed-"));
  try {
    const hub = new Hub({ dataDir: dir });
    const { room: closed, participant: a } = hub.join("closed-metric", "asker", "test", { expectedParticipants: 0 });
    const { participant: b } = hub.join("closed-metric", "target", "test");
    hub.send(closed.name, a.id, "@target Check", undefined, true);
    hub.send(closed.name, b.id, "Checked", undefined, true);
    hub.closeRoom(closed.name, "test");
    const metrics = (hub.stats(closed) as any).reply_metrics;
    const events = readFileSync(join(dir, "closed-metric.jsonl"), "utf8").trim().split("\n").map(line => JSON.parse(line));
    const replay = analyzeReplyMetrics(events);
    assert.equal(metrics.observation_end, replay.observation_end);
    assert.equal(metrics.mature_live_mentions, 0);
    assert.equal(metrics.pending_live_mentions, 1);
    const reloaded = new Hub({ dataDir: dir });
    assert.equal((reloaded.stats(reloaded.rooms.get(closed.name)!) as any).reply_metrics.observation_end, replay.observation_end);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
