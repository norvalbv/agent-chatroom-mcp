/** Replay parity regressions. Run: npx tsx scripts/regression-replay.ts */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Hub, type Proposal } from "../src/hub.js";

const text = "Keep the established safe wording for this proposal.";
const quote = "established safe wording";
const reason = "New evidence answers this objection adequately.";
const delay = () => new Promise((resolve) => setTimeout(resolve, 15));
/** A counting verify/* head: first line JSON naming the proposal, failing at base_commit and passing (exit_code 0) at commit. */
const verifyHead = (proposalId: string) =>
  JSON.stringify({ proposal: proposalId, command: "npm test", cwd: "/tmp/x", base_commit: "a1b2c3d", base_exit_code: 1, commit: "e4f5a6b", exit_code: 0, output_tail: `ran checks for ${proposalId}` });

function fixture(requireVerification = false) {
  const dir = mkdtempSync(join(tmpdir(), "chatroom-replay-"));
  const hub = new Hub({ dataDir: dir });
  const name = "audit-replay";
  const a = hub.join(name, "A", "test", { expectedParticipants: 3, nudgeAfterMs: 0, requireVerification }, undefined, "session-a").participant;
  const b = hub.join(name, "B", "test", {}, undefined, "session-b").participant;
  const c = hub.join(name, "C", "test", {}, undefined, "session-c").participant;
  if (requireVerification) hub.setBoard(name, b.id, "verify/pre", verifyHead("n/a"));
  const pr = hub.propose(name, a.id, text);
  const log = join(dir, `${name}.jsonl`);
  const replay = () => {
    const restored = new Hub({ dataDir: dir });
    const room = restored.getRoom(name);
    return { hub: restored, room, pr: room.proposals.get(pr.id)! };
  };
  const state = (h: Hub, p: Proposal) => ({
    text: p.text, version: p.version, updatedAt: p.updatedAt, votes: p.votes,
    challenges: p.challenges, open: h.openChallenges(p), status: p.status,
    verified: !!h.verifiedBy(h.getRoom(name), p),
  });
  const parity = () => {
    const r = replay();
    // Compare JSON-observable state: persistence naturally drops undefined fields.
    assert.deepEqual(JSON.parse(JSON.stringify(state(r.hub, r.pr))), JSON.parse(JSON.stringify(state(hub, pr))));
    assert.equal(r.room.state, hub.getRoom(name).state);
  };
  const rewrite = (edit: (events: any[]) => void) => {
    const events = readFileSync(log, "utf8").trim().split("\n").map((line) => JSON.parse(line));
    edit(events);
    writeFileSync(log, events.map((e) => JSON.stringify(e)).join("\n") + "\n");
  };
  return { hub, name, a, b, c, pr, replay, parity, rewrite, log, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test("challenger agree concedes after replay; other voters and non-agree do not", () => {
  const f = fixture();
  try {
    f.parity();
    f.hub.challenge(f.name, f.b.id, f.pr.id, `The clause "${quote}" needs better evidence.`);
    f.parity();
    f.hub.vote(f.name, f.a.id, f.pr.id, "agree", reason, undefined, quote);
    f.parity();
    assert.equal(f.pr.challenges[0].status, "open");
    f.hub.vote(f.name, f.b.id, f.pr.id, "disagree", "Please supply independent evidence first.");
    f.parity();
    assert.equal(f.pr.challenges[0].status, "open");
    f.hub.vote(f.name, f.b.id, f.pr.id, "agree", reason, undefined, quote);
    assert.equal(f.pr.challenges[0].status, "conceded");
    assert.equal(f.pr.status, "open", "third voter must keep acceptance snapshot from masking replay");
    f.parity();
  } finally { f.cleanup(); }
});

test("amend persists its timestamp and replay rejects pre-amend verification", async () => {
  const f = fixture(true);
  try {
    await delay();
    f.hub.setBoard(f.name, f.b.id, "verify/final", verifyHead(f.pr.id));
    assert.ok(f.hub.verifiedBy(f.hub.getRoom(f.name), f.pr));
    f.parity();
    await delay();
    f.hub.amend(f.name, f.a.id, f.pr.id, "", "Add another independent requirement.");
    assert.equal(f.hub.verifiedBy(f.hub.getRoom(f.name), f.pr), undefined);
    const r = f.replay();
    assert.equal(r.hub.verifiedBy(r.room, r.pr), undefined, "replay must not revive stale verification");
    const amend = readFileSync(f.log, "utf8").trim().split("\n").map((line) => JSON.parse(line)).find((e) => e.type === "amend");
    assert.equal(amend.updatedAt, f.pr.updatedAt);
    f.parity();
    await delay();
    f.hub.setBoard(f.name, f.b.id, "verify/final", verifyHead(f.pr.id));
    f.parity();
    const fresh = f.replay();
    assert.ok(fresh.hub.verifiedBy(fresh.room, fresh.pr));
  } finally { f.cleanup(); }
});

test("legacy amend without timestamp cannot establish verification freshness", async () => {
  const f = fixture(true);
  try {
    await delay();
    f.hub.setBoard(f.name, f.b.id, "verify/final", verifyHead(f.pr.id));
    await delay();
    f.hub.amend(f.name, f.a.id, f.pr.id, "", "Add another independent requirement.");
    f.rewrite((events) => { for (const e of events) if (e.type === "amend") delete e.updatedAt; });
    const r = f.replay();
    assert.equal(r.hub.verifiedBy(r.room, r.pr), undefined, "unknown amendment time must fail closed");
    r.hub.join(f.name, "A", "test", {}, f.a.id, "session-a");
    r.hub.join(f.name, "B", "test", {}, f.b.id, "session-b");
    await delay();
    r.hub.amend(f.name, f.a.id, f.pr.id, "", "Fresh timestamped amendment.");
    await delay();
    r.hub.setBoard(f.name, f.b.id, "verify/final", verifyHead(f.pr.id));
    const restored = f.replay();
    assert.ok(restored.hub.verifiedBy(restored.room, restored.pr), "known new amendment can restore freshness");
  } finally { f.cleanup(); }
});

test("current-version agree also concedes surviving older challenges", () => {
  const f = fixture();
  try {
    f.hub.challenge(f.name, f.b.id, f.pr.id, `The clause "${quote}" needs better evidence.`);
    f.hub.amend(f.name, f.a.id, f.pr.id, "", "An unrelated addition.");
    assert.equal(f.pr.challenges[0].version, 1);
    assert.equal(f.pr.version, 2);
    f.hub.vote(f.name, f.b.id, f.pr.id, "agree", reason, undefined, quote);
    assert.equal(f.pr.challenges[0].status, "conceded");
    f.parity();
  } finally { f.cleanup(); }
});

test("replay keeps answered challenges answered and derives legacy unversioned concessions", () => {
  const f = fixture();
  try {
    f.hub.challenge(f.name, f.b.id, f.pr.id, `The clause "${quote}" needs better evidence.`);
    f.hub.amend(f.name, f.a.id, f.pr.id, quote, "new independently checked wording");
    assert.equal(f.pr.challenges[0].status, "answered");
    f.hub.vote(f.name, f.b.id, f.pr.id, "agree", reason, undefined, "new independently checked wording");
    assert.equal(f.replay().pr.challenges[0].status, "answered");
  } finally { f.cleanup(); }
  const legacy = fixture();
  try {
    legacy.hub.challenge(legacy.name, legacy.b.id, legacy.pr.id, `The clause "${quote}" needs better evidence.`);
    legacy.hub.vote(legacy.name, legacy.b.id, legacy.pr.id, "agree", reason, undefined, quote);
    legacy.rewrite((events) => {
      for (const e of events) {
        if (e.type === "vote") delete e.entry.version;
        if (e.type === "challenge") { delete e.challenge.status; delete e.challenge.version; }
      }
    });
    assert.equal(legacy.replay().pr.challenges[0].status, "conceded");
  } finally { legacy.cleanup(); }
});

test("stale-version replay agree does not concede a current open challenge", () => {
  const f = fixture();
  try {
    f.hub.amend(f.name, f.a.id, f.pr.id, "", "An unrelated addition.");
    f.hub.challenge(f.name, f.b.id, f.pr.id, `The clause "${quote}" needs better evidence.`);
    f.hub.vote(f.name, f.b.id, f.pr.id, "agree", reason, undefined, quote);
    // A stale historical entry must not be interpreted as endorsing current text.
    f.rewrite((events) => {
      for (const e of events) if (e.type === "vote" && e.pid === f.b.id) e.entry.version = 1;
    });
    const r = f.replay();
    assert.equal(r.pr.version, 2);
    assert.equal(r.pr.votes[f.b.id].version, 1);
    assert.equal(r.pr.challenges[0].status, "open");
  } finally { f.cleanup(); }
});

test("agree concedes own non-blocking objection but preserves another author's", () => {
  const f = fixture();
  try {
    f.hub.challenge(f.name, f.b.id, f.pr.id, `The clause "${quote}" needs better evidence.`, false);
    f.hub.challenge(f.name, f.c.id, f.pr.id, `The clause "${quote}" needs a separate check.`, false);
    f.hub.vote(f.name, f.b.id, f.pr.id, "agree", reason, undefined, quote);
    assert.deepEqual(f.pr.challenges.map((c) => c.status), ["conceded", "open"]);
    f.parity();
  } finally { f.cleanup(); }
});
