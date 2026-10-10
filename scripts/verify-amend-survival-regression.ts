/**
 * Verification binds to the commit, not to the text version (swarm-000525-jcz8, evidence/verification-throughput).
 * In 128 require_verification room logs, 157 of 228 passing verify heads that named a real proposal were voided by
 * a later amend ("written before vN's text: check vN and write it again"); in 119 of those 157 the commit the entry
 * checked was still cited verbatim in every later version of the text, so nothing that had been verified changed.
 * An agree already survives an amend while its quoted clause does; a verify entry now survives while the amended
 * text still cites the commit its head names. Dropping or changing the commit voids it exactly as before, and an
 * entry that names no commit the text cites is still bound to the version it was written against. An amend that
 * cites a hex token the text the entry was written against did not have, and that no verify head covers, voids it
 * (the verifier's attack: keep commit A, add B); any lowercase hex token of 7 to 40 characters counts there, all-digit
 * included (reviewer claude-opus-5-5-2: 3.7% of 7-character shas have no letter). The rule compares the current text
 * with the text the entry saw, so taking the addition back out restores the entry: dev room swarm-003315-al9z quoted
 * the example 'ABCDEF1' in an amend, the hub lowercased it into a commit, and removing it did not bring the entry back.
 * Coverage is reported, not enforced: 409 of the 499 commits cited by 75 concluded require_verification rooms were
 * the commit or base_commit of no passing verify head, in 68 of the rooms, so a hard gate would have stopped nearly
 * all of them over history references. The open proposal and the conclusion now name the cited commits nobody checked.
 * Run: npx tsx --test scripts/verify-amend-survival-regression.ts
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Hub, citedCommits } from "../src/hub.js";

const COMMIT = "e4f5a6b7c8d9";
const TEXT = `Ship the fix on branch swarm/x at commit ${COMMIT}, regression red on the parent.`;

function fixture(t: { after: (fn: () => void) => void }, text = TEXT) {
  const dir = mkdtempSync(join(tmpdir(), "verify-amend-"));
  const hub = new Hub({ dataDir: dir });
  const name = "verify-amend-test";
  const a = hub.join(name, "Alice", "test", { requireVerification: true, requireChallenge: false, expectedParticipants: 2 }, undefined, "session-a").participant;
  const b = hub.join(name, "Bob", "test", {}, undefined, "session-b").participant;
  const room = hub.getRoom(name);
  hub.setBoard(name, a.id, "verify/own-run", "the author's own run");
  const pr = hub.propose(name, a.id, text);
  t.after(() => {
    clearTimeout(room.nudgeTimer);
    clearTimeout(room.openingsTimer);
    rmSync(dir, { recursive: true, force: true });
  });
  const head = (over: Record<string, unknown> = {}) =>
    JSON.stringify({ proposal: pr.id, command: "npx tsx --test scripts/x.ts", cwd: "/repo", base_commit: "a1b2c3d", base_exit_code: 1, commit: COMMIT.slice(0, 7), exit_code: 0, output_tail: "9 passed", ...over });
  return { hub, room, pr, a, b, head };
}

/** The proposal's updatedAt and the entry's are ISO strings compared lexically; make the amend strictly later. */
const tick = () => new Promise((r) => setTimeout(r, 5));

test("a verify entry survives an amend that still cites the commit it checked", async (t) => {
  const { hub, room, pr, a, b, head } = fixture(t);
  hub.setBoard(room.name, b.id, "verify/fix", head());
  assert.ok(hub.verifiedBy(room, pr), "counts before the amend");
  await tick();
  hub.amend(room.name, a.id, pr.id, "regression red on the parent", "regression red on the parent commit a1b2c3d");
  assert.equal(pr.version, 2);
  assert.equal(hub.verifiedBy(room, pr)?.by, "Bob", `v2 still cites ${COMMIT}, which is what Bob checked`);
  assert.equal(hub.blockedBy(room, pr).some((m) => m.startsWith("a verify/* board entry")), false, "a1b2c3d is the base_commit Bob's own head names, so citing it adds nothing unchecked");
});

test("an amend that changes the commit voids the entry, and the refusal says which commit went", async (t) => {
  const { hub, room, pr, a, b, head } = fixture(t);
  hub.setBoard(room.name, b.id, "verify/fix", head());
  await tick();
  hub.amend(room.name, a.id, pr.id, `at commit ${COMMIT}`, "at commit 0123abcd4567");
  assert.equal(hub.verifiedBy(room, pr), undefined, "the text now claims a commit nobody checked");
  const why = hub.blockedBy(room, pr).find((m) => m.startsWith("a verify/* board entry"));
  assert.match(why ?? "", /verify\/fix does not count: .*e4f5a6b/, "names the commit the entry checked");
});

test("an entry whose commit the text never cited is still bound to the version it was written against", async (t) => {
  const { hub, room, pr, a, b, head } = fixture(t);
  hub.setBoard(room.name, b.id, "verify/fix", head({ commit: "9999999" }));
  assert.ok(hub.verifiedBy(room, pr), "fresh entries count as before, whatever commit they name");
  await tick();
  hub.amend(room.name, a.id, pr.id, "regression red", "regression shown red");
  assert.equal(hub.verifiedBy(room, pr), undefined);
});

test("a hex run inside a longer word is not a citation", async (t) => {
  const { hub, room, pr, a, b, head } = fixture(t, "Ship the fix described in doc deadbeefcafe-notes, tested.");
  hub.setBoard(room.name, b.id, "verify/fix", head({ commit: "eadbeef" }));
  await tick();
  hub.amend(room.name, a.id, pr.id, "tested.", "tested twice.");
  assert.equal(hub.verifiedBy(room, pr), undefined, "eadbeef only occurs inside deadbeefcafe");
});

test("the amend notice says which verify entries still count and which must be redone", async (t) => {
  const { hub, room, pr, a, b, head } = fixture(t);
  hub.setBoard(room.name, b.id, "verify/fix", head());
  await tick();
  hub.amend(room.name, a.id, pr.id, "regression red", "regression shown red");
  const kept = room.messages.at(-1)?.content ?? "";
  assert.match(kept, /verify\/fix by Bob still counts/, kept);
  await tick();
  hub.amend(room.name, a.id, pr.id, `at commit ${COMMIT}`, "at commit 0123abcd4567");
  const voided = [...room.messages].reverse().find((m) => m.content.startsWith("AMENDED"))?.content ?? "";
  assert.match(voided, /verify\/fix by Bob no longer counts/, voided);
});

test("the proposer's own entry and a failing head gain nothing from the rule", async (t) => {
  const { hub, room, pr, a, b, head } = fixture(t);
  hub.setBoard(room.name, a.id, "verify/self", head());
  hub.setBoard(room.name, b.id, "verify/red", head({ exit_code: 1 }));
  await tick();
  hub.amend(room.name, a.id, pr.id, "regression red", "regression shown red");
  assert.equal(hub.verifiedBy(room, pr), undefined);
});

test("an amend that adds a commit voids every earlier entry, even one whose own commit is still cited", async (t) => {
  const { hub, room, pr, a, b, head } = fixture(t);
  hub.setBoard(room.name, b.id, "verify/fix", head());
  await tick();
  hub.amend(room.name, a.id, pr.id, "", "Also ships commit 0123abcd4567 on branch swarm/y.");
  assert.equal(hub.verifiedBy(room, pr), undefined, "Bob checked e4f5a6b; v2 also claims 0123abcd4567");
  const why = hub.blockedBy(room, pr).find((m) => m.startsWith("a verify/* board entry")) ?? "";
  assert.match(why, /verify\/fix does not count: .*cites 0123abcd4567 that the text it checked did not/);
  assert.match(room.messages.at(-1)?.content ?? "", /verify\/fix by Bob no longer counts/);
  await tick();
  hub.amend(room.name, a.id, pr.id, "regression red", "regression shown red");
  assert.equal(hub.verifiedBy(room, pr), undefined, "a later amend that adds nothing does not bring it back");
  hub.setBoard(room.name, b.id, "verify/fix", head());
  assert.ok(hub.verifiedBy(room, pr), "rewritten against the current text, it counts");
});

test("an added sha with no letter, or no digit, voids the entry too", async (t) => {
  for (const sha of ["4082913", "deadbee"]) {
    const { hub, room, pr, a, b, head } = fixture(t);
    hub.setBoard(room.name, b.id, "verify/fix", head());
    await tick();
    hub.amend(room.name, a.id, pr.id, "", `and the lexer fix is done at ${sha}`);
    assert.equal(hub.verifiedBy(room, pr), undefined, `${sha} is 7 hex characters and may be a commit nobody checked`);
  }
});

test("taking the added token back out restores the entry (dev room swarm-003315-al9z)", async (t) => {
  const { hub, room, pr, a, b, head } = fixture(t);
  hub.setBoard(room.name, b.id, "verify/fix", head());
  await tick();
  hub.amend(room.name, a.id, pr.id, "", "So abcdef1 is a hex string that returns false.");
  assert.equal(hub.verifiedBy(room, pr), undefined);
  await tick();
  hub.amend(room.name, a.id, pr.id, "So abcdef1 is a hex string", "So a lower-cased hex string");
  assert.equal(hub.verifiedBy(room, pr)?.by, "Bob", "v3 cites nothing v1 did not");
  await tick();
  hub.amend(room.name, a.id, pr.id, "", "An upper-case example such as 'ABCDEF1' is not a sha.");
  assert.ok(hub.verifiedBy(room, pr), "git prints lowercase; an upper-case example is not read as a commit");
});

test("a second reviewer covering the added commit brings the first entry back", async (t) => {
  const { hub, room, pr, a, b, head } = fixture(t);
  const c = hub.join(room.name, "Carol", "test", {}, undefined, "session-c").participant;
  hub.setBoard(room.name, b.id, "verify/fix", head());
  await tick();
  hub.amend(room.name, a.id, pr.id, "", "Also ships commit 0123abcd4567 on branch swarm/y.");
  assert.deepEqual(hub.proposalView(room, pr).unverified_commits, [COMMIT, "0123abcd4567"], "with Bob's entry void, nothing is covered");
  await tick();
  hub.setBoard(room.name, c.id, "verify/y", head({ commit: "0123abcd4567", base_commit: COMMIT }));
  assert.equal(hub.proposalView(room, pr).unverified_commits, undefined, "Carol covers the new commit, Bob the first and its parent");
  await tick();
  hub.amend(room.name, a.id, pr.id, "regression red", "regression shown red");
  assert.equal(hub.proposalView(room, pr).unverified_commits, undefined, "and both survive a wording amend");
});

test("re-citing the same commit at another length is not adding one, and only sha-like tokens are listed as unverified", async (t) => {
  const { hub, room, pr, a, b, head } = fixture(t);
  hub.setBoard(room.name, b.id, "verify/fix", head());
  await tick();
  hub.amend(room.name, a.id, pr.id, "", `Short form ${COMMIT.slice(0, 8)}; 120 rows; parent a1b2c3d.`);
  assert.ok(hub.verifiedBy(room, pr));
  assert.deepEqual(citedCommits("sha256 " + "ab12".repeat(16) + " and prop_4f1d4de0, 20261010, 1234567, deadbee and 9d069ee"), ["9d069ee"]);
});

test("a replayed hub remembers that a commit was added", async (t) => {
  const { hub, room, pr, a, b, head } = fixture(t);
  hub.setBoard(room.name, b.id, "verify/fix", head());
  await tick();
  hub.amend(room.name, a.id, pr.id, "", "Also ships commit 0123abcd4567.");
  await tick();
  hub.amend(room.name, a.id, pr.id, "regression red", "regression shown red");
  const again = new Hub({ dataDir: (hub as unknown as { dataDir: string }).dataDir });
  const r2 = again.getRoom(room.name);
  t.after(() => { clearTimeout(r2.nudgeTimer); clearTimeout(r2.openingsTimer); });
  assert.equal(again.verifiedBy(r2, r2.proposals.get(pr.id)!), undefined);
});

test("the open proposal and the conclusion name the cited commits no verify entry checked", async (t) => {
  const { hub, room, pr, a, b, head } = fixture(t, `Built: branch x at ${COMMIT} (red at parent a1b2c3d) and branch y at 0123abcd4567.`);
  assert.deepEqual(hub.proposalView(room, pr).unverified_commits, [COMMIT, "a1b2c3d", "0123abcd4567"]);
  hub.setBoard(room.name, b.id, "verify/x", head());
  assert.deepEqual(hub.proposalView(room, pr).unverified_commits, ["0123abcd4567"], "commit and base_commit of a counting head are covered");
  hub.vote(room.name, a.id, pr.id, "agree", undefined, undefined, "Built: branch x at");
  hub.vote(room.name, b.id, pr.id, "agree", undefined, undefined, "Built: branch x at");
  assert.equal(room.state, "concluded", "coverage is reported, not a gate");
  assert.deepEqual(room.conclusion?.verification?.unverified_commits, ["0123abcd4567"]);
  assert.match(room.messages.at(-1)?.content ?? "", /Cited but checked by no verify entry: 0123abcd4567\./);
});
