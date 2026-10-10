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

test("a non-author attacks a finding by quoting it; the author is told and the entry leaves the unattacked list", () => {
  const { h, name, a, b } = room();
  h.setBoard(name, a.id, "findings/recruiting", FINDING);
  assert.deepEqual(h.scrutiny(name).unattacked, ["findings/recruiting"]);
  h.setBoard(name, b.id, "attack/findings/recruiting", ATTACK);
  const s = h.scrutiny(name);
  assert.deepEqual(s.unattacked, []);
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
  assert.deepEqual(h.scrutiny(name).unattacked, [], "an answered attack still counts as scrutiny");
  h.setBoard(name, b.id, "attack/findings/recruiting", `${ATTACK} Three briefs is not a sample.`);
  assert.deepEqual(h.scrutiny(name).open_attacks, ["attack/findings/recruiting"]);
});

test("the first propose is refused once, naming unattacked findings and unanswered attacks; the second goes through", () => {
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
  h.setBoard(name, a.id, "findings/recruiting", `${FINDING}\nRE attack: conceded, reworded.`);
  assert.deepEqual(h.scrutiny(name), { unattacked: [], open_attacks: [] });
  assert.equal(h.propose(name, a.id, "Build the hub-side trigger.").status, "open");
});

test("room_status carries the two lists only while there is something on them", () => {
  const { h, name, a, b } = room();
  assert.equal("scrutiny" in h.summary(h.getRoom(name)), false);
  h.setBoard(name, a.id, "findings/recruiting", FINDING);
  assert.deepEqual((h.summary(h.getRoom(name)) as { scrutiny?: unknown }).scrutiny, { unattacked: ["findings/recruiting"], open_attacks: [] });
  h.setBoard(name, b.id, "attack/findings/recruiting", ATTACK);
  h.setBoard(name, a.id, "findings/recruiting", `${FINDING}\nRE attack: conceded.`);
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
