/**
 * Scrutiny before the proposal (swarm-000525-jcz8, findings/scrutiny-quality). In 82 past rooms the first proposal
 * arrived a median 19.5 min in and the first challenge 18 s after it: objections had nowhere to go earlier, because
 * challenge only accepts an open proposal. Of 1345 pre-proposal board findings, 43% were ever named by a non-author.
 * attack/<key> is the earlier primitive: a non-author on another connection quotes a clause of a board entry and says
 * what is wrong with it; the author answers by editing the entry. The first propose is refused once with the findings
 * nobody else attacked and the attacks nobody answered. Never a standing gate: the second propose goes through.
 * Run: npx tsx scripts/board-attack-regression.ts
 */
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hub } from "../src/hub.js";

const cases: [string, () => Promise<void> | void][] = [];
const test = (name: string, run: () => Promise<void> | void) => cases.push([name, run]);

let serial = 0;
function room(sessions = ["sess-alice", "sess-bob", "sess-carol"]) {
  const h = new Hub();
  const name = `board-attack-${++serial}`;
  const [a, b, c] = ["alice", "bob", "carol"].map((n, i) => h.join(name, n, "test", {}, undefined, sessions[i]).participant);
  return { h, name, a, b, c };
}
const FINDING = "Measured on 40 rooms: seats recruited in 2% of seat-runs, and refused calls are not the cause (20 refusals in total). " +
  "Recruits join in a median 7 s. So the gap is the missing trigger, not the cap, and a hub-side trigger is the fix to build.";
const ATTACK = 'The clause "refused calls are not the cause (20 refusals in total)" counts refusals, not seats that never tried because the cap was in the brief.';
const throws = (run: () => unknown, re: RegExp) => assert.throws(run, (e: Error) => re.test(e.message) || assert.fail(`unexpected message: ${e.message}`));

test("a non-author attacks a finding by quoting it; the author is told and the entry leaves the unexamined list", () => {
  const { h, name, a, b } = room();
  h.setBoard(name, a.id, "findings/recruiting", FINDING);
  assert.deepEqual(h.scrutiny(name).unexamined, ["findings/recruiting"]);
  h.setBoard(name, b.id, "attack/findings/recruiting", ATTACK);
  const s = h.scrutiny(name);
  assert.deepEqual(s.unexamined, []);
  assert.deepEqual(s.open_attacks, ["attack/findings/recruiting"]);
  const notice = h.getRoom(name).messages.find((m) => m.content.startsWith("@alice") && m.content.includes("attack/findings/recruiting"));
  assert.ok(notice, "the author gets an @-notice naming the attack");
  assert.equal(notice.kind, "chat", "chat kind so the @-mention wakes a held wait");
});

test("an attack must target an existing finding, by someone else, on another connection, quoting its text", () => {
  const { h, name, a, b } = room();
  throws(() => h.setBoard(name, b.id, "attack/findings/nope", ATTACK), /no board entry "findings\/nope"/);
  h.setBoard(name, a.id, "findings/recruiting", FINDING);
  throws(() => h.setBoard(name, a.id, "attack/findings/recruiting", ATTACK), /your own entry/);
  throws(() => h.setBoard(name, b.id, "attack/findings/recruiting", "I do not find this convincing at all, the numbers look thin to me."), /quote/);
  h.setBoard(name, a.id, "claim/recruiting", JSON.stringify({ area: "recruiting", owner: "alice" }));
  throws(() => h.setBoard(name, b.id, "attack/claim/recruiting", 'The claim "recruiting" is too broad for one seat.'), /cannot be attacked/);
  const alias = room(["sess-shared", "sess-shared", "sess-carol"]);
  alias.h.setBoard(alias.name, alias.a.id, "findings/recruiting", FINDING);
  throws(() => alias.h.setBoard(alias.name, alias.b.id, "attack/findings/recruiting", ATTACK), /connection/);
});

test("the author answers an attack by editing the entry; an attack on an already-edited entry is open again only if refiled", () => {
  const { h, name, a, b } = room();
  h.setBoard(name, a.id, "findings/recruiting", FINDING);
  h.setBoard(name, b.id, "attack/findings/recruiting", ATTACK);
  h.setBoard(name, a.id, "findings/recruiting", `${FINDING}\nRE attack: checked, 3 briefs named the cap; 0 of those seats recruited either way.`);
  assert.deepEqual(h.scrutiny(name).open_attacks, []);
  assert.deepEqual(h.scrutiny(name).unexamined, [], "an answered attack still counts as scrutiny");
  h.setBoard(name, b.id, "attack/findings/recruiting", `${ATTACK} Three briefs is not a sample.`);
  assert.deepEqual(h.scrutiny(name).open_attacks, ["attack/findings/recruiting"]);
});

test("the first propose is refused once, naming unexamined findings and unanswered attacks; the second goes through", () => {
  const { h, name, a, b, c } = room();
  h.setBoard(name, a.id, "findings/recruiting", FINDING);
  h.setBoard(name, c.id, "findings/research", FINDING.replace("recruited", "searched"));
  h.setBoard(name, b.id, "attack/findings/recruiting", ATTACK);
  throws(() => h.propose(name, a.id, "Build the hub-side trigger; see findings/recruiting."),
    /findings\/research[\s\S]*attack\/findings\/recruiting|attack\/findings\/recruiting[\s\S]*findings\/research/);
  const pr = h.propose(name, a.id, "Build the hub-side trigger; see findings/recruiting.");
  assert.equal(pr.status, "open");
});

test("nothing to say, nothing refused: short notes, reserved keys and fully attacked boards do not hold a proposal", () => {
  const { h, name, a, b } = room();
  h.setBoard(name, a.id, "todo", "ask bob about ports");
  h.setBoard(name, a.id, "claim/recruiting", JSON.stringify({ area: "recruiting", owner: "alice", note: FINDING }));
  h.setBoard(name, a.id, "findings/recruiting", FINDING);
  h.setBoard(name, b.id, "attack/findings/recruiting", ATTACK);
  h.setBoard(name, a.id, "findings/recruiting", `${FINDING}\nRE attack: conceded; the 20 refusals are calls, not seats, and the sentence above now says so.`);
  assert.deepEqual(h.scrutiny(name), { unexamined: [], open_attacks: [] });
  assert.equal(h.propose(name, a.id, "Build the hub-side trigger.").status, "open");
});

test("a finding another connection already named or quoted in chat is not listed (dev room swarm-002346-crax: the verifier had checked it in chat)", () => {
  const { h, name, a, b, c } = room();
  h.setBoard(name, a.id, "findings/recruiting", FINDING);
  h.setBoard(name, c.id, "findings/research", FINDING.replace("recruited", "searched"));
  h.send(name, a.id, "findings/recruiting is up, please look.", undefined, true);
  assert.deepEqual(h.scrutiny(name).unexamined, ["findings/recruiting", "findings/research"], "the author naming it is not scrutiny");
  h.send(name, b.id, "Reproduced findings/recruiting: I count 2% as well.", undefined, true);
  h.send(name, b.id, 'carol, "seats searched in 2% of seat-runs" is seat-runs, not seats.', undefined, true);
  assert.deepEqual(h.scrutiny(name).unexamined, []);
  const alias = room(["sess-shared", "sess-shared", "sess-carol"]);
  alias.h.setBoard(alias.name, alias.a.id, "findings/recruiting", FINDING);
  alias.h.send(alias.name, alias.b.id, "Reproduced findings/recruiting: I count 2% as well.", undefined, true);
  assert.deepEqual(alias.h.scrutiny(alias.name).unexamined, ["findings/recruiting"], "a same-connection alias is the author");
});

// Both found by the reviewer's probe (claude-opus-5-5-6, review/scrutiny-quality) at 6dc0ed7f.
test("re-saving the attacked entry does not answer the attack: the quoted clause must go, or a reply of some length be added", () => {
  const { h, name, a, b } = room();
  h.setBoard(name, a.id, "findings/recruiting", FINDING);
  h.setBoard(name, b.id, "attack/findings/recruiting", ATTACK);
  h.setBoard(name, a.id, "findings/recruiting", `${FINDING} `);
  assert.deepEqual(h.scrutiny(name).open_attacks, ["attack/findings/recruiting"], "a one-space edit");
  h.setBoard(name, a.id, "findings/recruiting", `${FINDING}\nok.`);
  assert.deepEqual(h.scrutiny(name).open_attacks, ["attack/findings/recruiting"], "a three-character reply");
  h.setBoard(name, a.id, "findings/recruiting", FINDING.replace("refused calls are not the cause (20 refusals in total)", "20 calls were refused; seats that never tried are not counted"));
  assert.deepEqual(h.scrutiny(name).open_attacks, [], "the quoted clause is gone");
});

test("the once-per-room refusal is on the record: the room sees it, and a hub restart does not refuse again", () => {
  const dataDir = mkdtempSync(join(tmpdir(), "board-attack-"));
  const h = new Hub({ dataDir });
  const name = "board-attack-restart";
  const a = h.join(name, "alice", "test", {}, undefined, "sess-alice").participant;
  const b = h.join(name, "bob", "test", {}, undefined, "sess-bob").participant;
  h.setBoard(name, a.id, "findings/recruiting", FINDING);
  throws(() => h.propose(name, a.id, "Build the hub-side trigger."), /findings\/recruiting/);
  const line = h.getRoom(name).messages.find((m) => m.kind === "system" && m.content.includes("findings/recruiting") && /held once/.test(m.content));
  assert.ok(line, "one system line tells the room which findings nobody else examined");
  const h2 = new Hub({ dataDir });
  const a2 = h2.join(name, "alice", "test", {}, a.id, "sess-alice").participant;
  h2.join(name, "bob", "test", {}, b.id, "sess-bob");
  assert.equal(h2.propose(name, a2.id, "Build the hub-side trigger.").status, "open");
  for (const hub of [h, h2]) for (const r of hub.rooms.values()) { clearTimeout(r.nudgeTimer); clearTimeout(r.openingsTimer); }
});

test("room_status carries the two lists only while there is something on them", () => {
  const { h, name, a, b } = room();
  assert.equal("scrutiny" in h.summary(h.getRoom(name)), false);
  h.setBoard(name, a.id, "findings/recruiting", FINDING);
  assert.deepEqual((h.summary(h.getRoom(name)) as { scrutiny?: unknown }).scrutiny, { unexamined: ["findings/recruiting"], open_attacks: [] });
  h.setBoard(name, b.id, "attack/findings/recruiting", ATTACK);
  h.setBoard(name, a.id, "findings/recruiting", `${FINDING}\nRE attack: conceded; the count is of refused calls and says nothing about seats that never tried.`);
  assert.equal("scrutiny" in h.summary(h.getRoom(name)), false);
});

let failed = 0;
for (const [name, run] of cases) {
  try {
    await run();
    console.log(`ok   ${name}`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${name}\n     ${(e as Error).message.split("\n")[0]}`);
  }
}
console.log(failed ? `\n${failed} of ${cases.length} failed` : `\nBOARD ATTACK OK (${cases.length} cases)`);
process.exit(failed ? 1 : 0);
