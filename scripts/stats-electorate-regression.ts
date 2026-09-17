/** Stats-only contract checks; electorate mechanics belong to electorate-regression.ts.
 * Run: npx tsx scripts/stats-electorate-regression.ts
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Hub } from "../src/hub.js";

const ROOM = "stats-electorate";
const TEXT = "Require independent evidence before adopting this conclusion.";
const QUOTE = "before adopting this conclusion";
const LEGACY_KEYS = ["room", "state", "duration_ms", "time_to_conclusion_ms", "messages_by_kind",
  "per_participant", "proposals", "amendments", "challenges", "board_entries", "refusals",
  "call_outcomes", "refusal_rates", "refusal_rate_coverage", "near_simultaneous_replies", "unanswered_human_messages"];
function setup(dataDir?: string) {
  const hub = new Hub({ dataDir });
  const { room, participant: a } = hub.join(ROOM, "A", "test", { requireChallenge: true, nudgeAfterMs: 0 }, undefined, "s1");
  const b = hub.join(ROOM, "B", "test", {}, undefined, "s2").participant;
  const pr = hub.propose(ROOM, a.id, TEXT);
  const agree = (id: string) => hub.vote(ROOM, id, pr.id, "agree", "Checked independently.", undefined, QUOTE);
  // Unknown keys deliberately checked at runtime so this regression runs red on the old hub.
  const stats = () => hub.stats(room) as ReturnType<Hub["stats"]> & Record<string, any>;
  return { hub, room, a, b, pr, agree, stats };
}

test("stats retains existing fields and reads never mutate room/cursors", () => {
  const { room, stats } = setup();
  const before = structuredClone(room);
  const first = stats();
  for (const key of LEGACY_KEYS) assert.ok(key in first, `legacy key ${key}`);
  assert.ok(Array.isArray(first.proposal_electorates), "stats must expose proposal_electorates");
  assert.equal(first.conclusion_electorate, null);
  // reply_metrics.as_of and observation_end (open room) are the read time by design; everything else must be byte-identical between reads.
  const stable = (x: Record<string, any>) => { const c = structuredClone(x); if (c.reply_metrics) { delete c.reply_metrics.as_of; delete c.reply_metrics.observation_end; } return c; };
  assert.deepEqual(stable(stats()), stable(first), "consecutive stats reads must be identical");
  assert.deepEqual(room, before, "stats must not mutate any room state or participant cursor");
});

test("open stats uses the hub electorate, excluding ordinary late joiner votes", () => {
  const { hub, room, pr, agree, stats } = setup();
  const c = hub.join(ROOM, "Late", "test", {}, undefined, "s3").participant;
  agree(c.id);
  const summaries = stats().proposal_electorates;
  assert.ok(Array.isArray(summaries), "stats must expose proposal_electorates");
  assert.equal(summaries.length, 1);
  const summary = summaries[0];
  assert.equal(summary.proposal_id, pr.id);
  assert.equal(summary.electorate, 2, "late joiner must not inflate denominator");
  assert.equal(summary.denominator, "electorate");
  const view = hub.proposalView(room, pr);
  assert.deepEqual({ agree: summary.agree, disagree: summary.disagree, abstain: summary.abstain }, view.tally);
  assert.equal(summary.agree, 1, "late agree is not an electorate agree");
  assert.equal(summary.electorate - summary.agree - summary.disagree - summary.abstain, view.waiting_on.length);
});

test("accepted stats freeze denominator/tally after departures and persisted reload", () => {
  const dir = mkdtempSync(join(tmpdir(), "stats-electorate-"));
  try {
    const { hub, room, a, b, pr, agree, stats } = setup(dir);
    hub.challenge(ROOM, b.id, pr.id, '"independent evidence" needs a checked source.');
    agree(b.id);
    assert.equal(room.state, "concluded");
    const frozen = structuredClone(stats().conclusion_electorate);
    assert.ok(frozen, "stats must expose frozen conclusion_electorate");
    assert.equal(frozen.electorate, 2);
    assert.equal(frozen.agree, 2);
    assert.equal(frozen.excluded_leavers, 0);
    assert.deepEqual({ agree: frozen.agree, disagree: frozen.disagree, abstain: frozen.abstain }, room.conclusion?.tally);
    assert.match(room.messages.find((m) => m.kind === "conclusion")!.content, /\(2\/2 agree;/);
    hub.leave(ROOM, a.id);
    hub.leave(ROOM, b.id);
    const before = structuredClone(room);
    assert.deepEqual(stats().conclusion_electorate, frozen);
    assert.deepEqual(stats().conclusion_electorate, frozen);
    assert.deepEqual(hub.proposalView(room, pr).tally, room.conclusion?.tally);
    assert.deepEqual(room, before, "post-conclusion reads must not mutate state");
    const restored = new Hub({ dataDir: dir });
    const restoredStats = restored.stats(restored.getRoom(ROOM)) as Record<string, any>;
    assert.deepEqual(restoredStats.conclusion_electorate, frozen, "acceptance data must survive reload");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
