/** Executable challenges: a runnable counterexample cannot be reworded away; only a rerun that passes answers it.
 * Run against source: npx tsx --test scripts/executable-challenge-regression.ts
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Hub, HubError } from "../src/hub.js";

const TEXT = "Ship the formatter: it prints %.17g like C printf for every double.";
const QUOTE = "Ship the formatter";
const CMD = "printf-check '%.17g' 1e-07";
const OBJECTION = "The formatter prints 1e-07 as 1.0000000000000000e-07; C gives 9.9999999999999995e-08.";
const REASON = "The counterexample now passes when rerun, so the objection is settled.";
const ROOM = "executable-challenge";
const tick = () => new Promise((r) => setTimeout(r, 3)); // distinct ISO timestamps
const head = (proposal: string, command: string, exit_code: number) =>
  JSON.stringify({ proposal, command, cwd: "/repo", exit_code, output_tail: exit_code ? "mismatch" : "ok" });

function fixture(t: { after: (fn: () => void) => void }) {
  const dir = mkdtempSync(join(tmpdir(), "exec-challenge-"));
  const hub = new Hub({ dataDir: dir });
  const a = hub.join(ROOM, "A", "test", { requireChallenge: true, quorum: "majority", nudgeAfterMs: 0 }, undefined, "s1").participant;
  const b = hub.join(ROOM, "B", "test", {}, undefined, "s2").participant;
  const c = hub.join(ROOM, "C", "test", {}, undefined, "s3").participant;
  const room = hub.getRoom(ROOM);
  const pr = hub.propose(ROOM, a.id, TEXT);
  t.after(() => {
    clearTimeout(room.nudgeTimer);
    clearTimeout(room.openingsTimer);
    rmSync(dir, { recursive: true, force: true });
  });
  return { hub, room, pr, a, b, c, dir };
}

test("an executable challenge needs no quoted span, but an uncited prose challenge still does", (t) => {
  const { hub, pr, b } = fixture(t);
  assert.throws(() => hub.challenge(ROOM, b.id, pr.id, OBJECTION), HubError);
  hub.challenge(ROOM, b.id, pr.id, OBJECTION, true, `  ${CMD} `);
  assert.equal(pr.challenges[0].command, CMD, "command stored whitespace-normalised");
  assert.equal(pr.challenges[0].status, "open");
  assert.throws(() => hub.challenge(ROOM, b.id, pr.id, OBJECTION, true, "x"), HubError, "a one-char command is refused");
});

test("rewording, the proposer's own rerun, a different command, or a failing rerun do not answer it", async (t) => {
  const { hub, room, pr, a, b, c } = fixture(t);
  hub.challenge(ROOM, b.id, pr.id, `${OBJECTION} "${QUOTE}" is premature.`, true, CMD);
  await tick();
  hub.amend(ROOM, a.id, pr.id, "Ship the formatter", "Ship the corrected formatter");
  assert.equal(pr.challenges[0].status, "open", "amending the cited text away does not answer an executable challenge");
  const q = "Ship the corrected formatter";
  hub.vote(ROOM, a.id, pr.id, "agree", REASON, undefined, q);
  hub.vote(ROOM, c.id, pr.id, "agree", REASON, undefined, q);
  assert.equal(room.state, "open", "majority agree cannot overrule an open executable challenge");
  await tick();
  hub.setBoard(ROOM, a.id, "verify/proposer", head(pr.id, CMD, 0));
  hub.setBoard(ROOM, c.id, "verify/other", head(pr.id, "npm test", 0));
  hub.setBoard(ROOM, c.id, "verify/fails", head(pr.id, CMD, 1));
  assert.equal(pr.challenges[0].status, "open");
  assert.equal(room.state, "open");
  assert.match(hub.proposalView(room, pr).blocked_by.join(" "), /executable challenge/);
});

test("a passing rerun by someone else answers it and the room can conclude; replay keeps the answer", async (t) => {
  const { hub, room, pr, a, b, c, dir } = fixture(t);
  hub.challenge(ROOM, b.id, pr.id, OBJECTION, true, CMD);
  hub.vote(ROOM, a.id, pr.id, "agree", REASON, undefined, QUOTE);
  await tick();
  hub.setBoard(ROOM, c.id, "verify/rerun", head(pr.id, `${CMD.replace(" ", "   ")}`, 0));
  assert.equal(pr.challenges[0].status, "answered", "whitespace differences still match");
  assert.ok(room.messages.some((m) => m.kind === "system" && /Executable challenge by B .* answered/.test(m.content)));
  const replayed = new Hub({ dataDir: dir });
  const rpr = replayed.getRoom(ROOM).proposals.get(pr.id)!;
  assert.equal(rpr.challenges[0].status, "answered", "status survives replay");
  assert.equal(rpr.challenges[0].command, CMD);
  hub.vote(ROOM, c.id, pr.id, "agree", REASON, undefined, QUOTE);
  assert.equal(room.state, "concluded");
});

test("a later amend reopens an answered executable challenge until the command is rerun against the new text", async (t) => {
  const { hub, room, pr, a, b, c } = fixture(t);
  hub.challenge(ROOM, b.id, pr.id, OBJECTION, true, CMD);
  await tick();
  hub.setBoard(ROOM, c.id, "verify/rerun", head(pr.id, CMD, 0));
  assert.equal(pr.challenges[0].status, "answered");
  await tick();
  const { reopened } = hub.amend(ROOM, a.id, pr.id, "for every double", "for every finite double");
  assert.deepEqual(reopened, ["B"]);
  assert.equal(pr.challenges[0].status, "open", "the old rerun predates the new text");
  const q = "for every finite double";
  hub.vote(ROOM, a.id, pr.id, "agree", REASON, undefined, q);
  hub.vote(ROOM, c.id, pr.id, "agree", REASON, undefined, q);
  assert.equal(room.state, "open");
  await tick();
  hub.setBoard(ROOM, c.id, "verify/rerun", head(pr.id, CMD, 0));
  assert.equal(room.state, "concluded");
});

test("the challenger conceding still clears it", (t) => {
  const { hub, room, pr, a, b } = fixture(t);
  hub.challenge(ROOM, b.id, pr.id, OBJECTION, true, CMD);
  hub.vote(ROOM, a.id, pr.id, "agree", REASON, undefined, QUOTE);
  hub.vote(ROOM, b.id, pr.id, "agree", REASON, undefined, QUOTE);
  assert.equal(pr.challenges[0].status, "conceded");
  assert.equal(room.state, "concluded");
});

test("a verifier may rule a bogus command invalid at any exit code with a reason; the challenger, a worker, or a bare head cannot", async (t) => {
  const { hub, room, pr, a, b, c } = fixture(t);
  const v = hub.join(ROOM, "V", "test", {}, undefined, "s4", "verifier").participant;
  hub.challenge(ROOM, b.id, pr.id, OBJECTION, true, "false");
  await tick();
  hub.setBoard(ROOM, b.id, "verify/self", `${head(pr.id, "false", 1)}\nI rule my own counterexample stands forever.`);
  hub.setBoard(ROOM, c.id, "verify/worker", `${head(pr.id, "false", 1)}\n\`false\` always exits 1 and tests nothing.`);
  hub.setBoard(ROOM, v.id, "verify/bare", head(pr.id, "false", 1));
  assert.equal(pr.challenges[0].status, "open", "only an adjudicator with a stated reason may rule");
  hub.setBoard(ROOM, v.id, "verify/ruling", `${head(pr.id, "false", 1)}\n\`false\` always exits 1 and probes nothing in the spec.`);
  assert.equal(pr.challenges[0].status, "answered");
  assert.ok(room.messages.some((m) => m.kind === "system" && /answered by ruling: V/.test(m.content)));
  for (const p of [a, c]) hub.vote(ROOM, p.id, pr.id, "agree", REASON, undefined, QUOTE);
  assert.equal(room.state, "concluded");
});
