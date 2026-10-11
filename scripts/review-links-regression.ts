/**
 * A review/<sha> entry with a verify head is a review of that commit, and the hub reads it as one (evidence-pack item 4,
 * telemetry gaps G3/G14). The hub read only verify/*: in swarm-003601-tky5, 19 review/* keys were written and 11 carried
 * a verify head naming a commit ("proposal":"<id>"), and none of them covered anything, so the final list's
 * unverified_commits could not see them. 2 of 22 commits named in verify heads across runs did not exist in the repo and
 * nothing said so when they were written. Coverage only, never the gate (done-means-independently-verified):
 * uncovered commits are reported, not gated.
 * Run: npx tsx --test scripts/review-links-regression.ts
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Hub } from "../src/hub.js";

const X = "a1b2c3d4e5", Y = "f6e5d4c3b2";
const repo = process.cwd();
const HEAD = spawnSync("git", ["-C", repo, "rev-parse", "HEAD"], { encoding: "utf8" }).stdout.trim();
const PARENT = spawnSync("git", ["-C", repo, "rev-parse", "HEAD~1"], { encoding: "utf8" }).stdout.trim();

function fixture(t: { after: (fn: () => void) => void }, opts: { cwd?: string; dataDir?: string } = {}) {
  const hub = new Hub(opts);
  const name = "review-links";
  const a = hub.join(name, "Alice", "test", { requireVerification: true, requireChallenge: false, expectedParticipants: 3 }, undefined, "session-a").participant;
  const b = hub.join(name, "Bob", "test", {}, undefined, "session-b").participant;
  const c = hub.join(name, "Carol", "test", {}, undefined, "session-c").participant;
  const room = hub.getRoom(name);
  t.after(() => { clearTimeout(room.nudgeTimer); clearTimeout(room.openingsTimer); });
  const head = (commit: string, proposal = "pending", over: Record<string, unknown> = {}) =>
    JSON.stringify({ proposal, command: "npx tsx scripts/x.ts", cwd: "/w", base_commit: "0123abc", base_exit_code: 1, commit, exit_code: 0, output_tail: "ok", ...over });
  return { hub, room, a, b, c, head };
}

test("a review/<sha> head covers the commit it names, carries its gaps, and never opens the gate", (t) => {
  const { hub, room, a, b, c, head } = fixture(t);
  hub.setBoard(room.name, a.id, "verify/own", "author's own run");
  hub.setBoard(room.name, b.id, `review/${X}`, head(X, "<id>", { unverified: ["no dev room"] })); // tky5's placeholder
  const pr = hub.propose(room.name, a.id, `1. built ${X}. 2. built ${Y}.`);
  assert.deepEqual(hub.unverifiedCommits(room, pr), [Y], "the reviewed commit is covered, the other is reported");
  assert.deepEqual(hub.verificationGaps(room, pr), [{ key: `review/${X}`, by: "Bob", gaps: ["no dev room"] }]);
  assert.equal(hub.verifiedBy(room, pr), undefined, "a review/* entry is coverage, never the gate");
  hub.setBoard(room.name, c.id, `review/${Y}`, head(Y, pr.id));
  assert.equal(hub.verifiedBy(room, pr), undefined, "even one naming the proposal: the gate stays verify/*");
  assert.deepEqual(hub.unverifiedCommits(room, pr), []);
});

test("a failing, proposer-written or head-less review covers nothing", (t) => {
  const { hub, room, a, b, head } = fixture(t);
  hub.setBoard(room.name, a.id, "verify/own", "author's own run");
  hub.setBoard(room.name, a.id, `review/${X}`, head(X));
  hub.setBoard(room.name, b.id, `review/${Y}`, head(Y, "pending", { exit_code: 1 }));
  hub.setBoard(room.name, b.id, "review/prose", `looked at ${X} and ${Y}, fine`);
  const pr = hub.propose(room.name, a.id, `built ${X} and ${Y}.`);
  assert.deepEqual(hub.unverifiedCommits(room, pr), [X, Y]);
});

test("review/* is author-only like verify/*: a peer cannot swap someone's failing verdict", (t) => {
  const { hub, room, b, c, head } = fixture(t);
  hub.setBoard(room.name, b.id, `review/${X}`, head(X, "pending", { exit_code: 1 }));
  // a plain second write is kept beside it under the writer's own key (scripts/second-scrutiny-regression.ts) ...
  hub.setBoard(room.name, c.id, `review/${X}`, head(X));
  assert.ok(room.board.has(`review/${X}.Carol`));
  // ... and replacing it is refused, however it is asked for
  assert.throws(() => hub.setBoard(room.name, c.id, `review/${X}`, head(X), { overwrite: true }), /only its author or a human/);
  assert.equal(JSON.parse(room.board.get(`review/${X}`)!.text).exit_code, 1);
});

test("the hub checks a reviewed commit exists in the writer's own worktree, says so, and logs a review event", (t) => {
  const dataDir = mkdtempSync(join(tmpdir(), "review-links-"));
  // the hub's own repo is not the one to ask: on a shared hub the next rooms review devkit commits (attack/decision/review-links)
  const { hub, room, a, b, c, head } = fixture(t, { cwd: mkdtempSync(join(tmpdir(), "not-a-repo-")), dataDir });
  hub.bindSeat("key-b", "session-b", repo);
  hub.bindSeat("key-c", "session-c", repo);
  hub.setBoard(room.name, b.id, `review/${HEAD.slice(0, 8)}`, head(HEAD.slice(0, 8), "pending", { base_commit: PARENT.slice(0, 8), kind: "own_check", unverified: ["no dev room"] }));
  hub.setBoard(room.name, c.id, "review/ghost", head("ca10a76f", "pending", { base_commit: PARENT.slice(0, 8) }));
  hub.setBoard(room.name, a.id, "review/unbound", head("ca10a76f")); // no worktree known for Alice: not checked, not "missing"
  assert.deepEqual(room.board.get("review/unbound")!.commitCheck, { commit: "ca10a76f", base_commit: "0123abc" });
  const notices = room.messages.filter((m) => m.kind === "board").map((m) => m.content);
  assert.ok(!/does not exist/.test(notices.find((n) => n.includes(`review/${HEAD.slice(0, 8)}`))!), "a real commit is not flagged");
  assert.match(notices.find((n) => n.includes("review/ghost"))!, /names commit ca10a76f, which does not exist in your worktree's repository/);
  assert.deepEqual(room.board.get("review/ghost")!.commitCheck, { commit: "ca10a76f", commit_known: false, base_commit: PARENT.slice(0, 8), base_known: true });
  const events = readFileSync(join(dataDir, `${room.name}.jsonl`), "utf8").trim().split("\n").map((l) => JSON.parse(l)).filter((e) => e.type === "review");
  assert.equal(events.length, 3);
  assert.deepEqual(
    { ...events[0], ts: undefined },
    { type: "review", room: room.name, key: `review/${HEAD.slice(0, 8)}`, by: "Bob", proposal: "pending", commit: HEAD.slice(0, 8), commit_known: true, base_commit: PARENT.slice(0, 8), base_known: true, exit_code: 0, base_exit_code: 1, kind: "own_check", unverified_n: 1, ts: undefined },
  );
  // room_status: per commit, the review keys that cover it and whether each passed
  const reviews = hub.summary(room).reviews as { commit: string; known?: boolean; by: { key: string; by: string; passes: boolean }[] }[];
  assert.deepEqual(reviews.map((r) => [r.commit, r.known, r.by.map((x) => x.key)]), [[HEAD.slice(0, 8), true, [`review/${HEAD.slice(0, 8)}`]], ["ca10a76f", false, ["review/ghost", "review/unbound"]]]);
});

test("a review/* entry is scrutiny, not a finding: it is never listed as unexamined, and what it names has been looked at", (t) => {
  const { hub, room, a, b, head } = fixture(t);
  const finding = "The cap counts notes that need no acknowledgement, so ten digests block every later note to the room. ".repeat(3);
  hub.setBoard(room.name, a.id, "evidence/inbox-cap", finding);
  assert.deepEqual(hub.scrutiny(room.name).unexamined, ["evidence/inbox-cap"]);
  hub.setBoard(room.name, b.id, `review/${X}`, `${head(X)}\nExercised evidence/inbox-cap's claim on a private hub: ${"it holds as written. ".repeat(12)}`);
  assert.deepEqual(hub.scrutiny(room.name).unexamined, [], "the review is not owed an attack, and the entry it names counts as examined");
  assert.equal((hub.summary(room).participants as { name: string; output: { verifies: number } }[]).find((p) => p.name === "Bob")!.output.verifies, 1, "a review counts as the seat's verifying output");
});

test("a review/<sha> naming a dev room gets the hub's own reading of it, like a verify/* entry", async (t) => {
  const { hub, room, a, b, head } = fixture(t);
  const DEV = "http://127.0.0.1:7999/rooms/dev-1";
  hub.setBoard(room.name, a.id, "verify/own", "author's own run");
  hub.setBoard(room.name, b.id, `review/${X}`, head(X, "pending", { dev_room: DEV }));
  const seen: string[] = [];
  const receipt = await hub.readDevRoom(room.name, `review/${X}`, async (u) => { seen.push(u); return { name: "dev-1", state: "concluded", code_state: { head: X, dirty: false }, participants: [{ agent: "claude", messages: 3 }, { agent: "claude", messages: 2 }], message_count: 9 }; });
  assert.deepEqual(seen, [DEV], "the hub fetches the dev room itself");
  assert.equal(receipt?.agent_seats, 2);
  assert.equal(room.board.get(`review/${X}`)!.devReceipt?.agent_seats, 2, "and keeps what it read on the entry");
  const pr = hub.propose(room.name, a.id, `built ${X}.`);
  assert.doesNotMatch(hub.verificationGaps(room, pr).flatMap((g) => g.gaps).join(" | "), /not read by the hub/, "a read dev room is not reported as unread");
});
