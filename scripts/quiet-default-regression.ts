/**
 * Quiet by default for two-seat working exchanges (swarm-082539-kns2, idea/quiet-default; RE-TARGET of
 * minimal-prompt-hub-carries-coordination). The prompt sentence moved codex seats from 3% to 44% quiet and claude seats
 * from 5% to 9%; a quarter of claude chat is an exchange with one or two named agents pushed to every seat. When the
 * sender leaves `quiet` unset, the hub delivers such a message quiet unless it names a human or carries an evidence
 * pointer (a coordination board key, a proposal id, a commit), which the axis keeps public. quiet=false is always
 * public. Quiet stays delivery, not privacy (quiet-delivery-not-privacy). Run: npx tsx scripts/quiet-default-regression.ts
 */
import assert from "node:assert/strict";
import * as hubModule from "../src/hub.js";
import { Hub } from "../src/hub.js";

const hub = new Hub({ cwd: process.cwd() }); // the hub reads settled-axis slugs from <cwd>/docs/decisions
const ROOM = "quiet-default";
const join = (name: string, agent = "claude") => hub.join(ROOM, name, agent, { nudgeAfterMs: 0 }, undefined, `s-${name}`).participant;
const a = join("A"), b = join("B"), c = join("C"), d = join("D");
const human = join("benji", "human");
const verifier = hub.join(ROOM, "V", "claude", {}, undefined, "s-V", "verifier").participant;
const ids = (xs: { id: string }[]) => xs.map((x) => x.id).sort();
// each send is forced so the stale-send guard (others' unread messages) never decides the case
const say = (p: { id: string }, text: string, replyTo?: string, quiet?: boolean) => hub.send(ROOM, p.id, text, replyTo, true, quiet);

// 1. an @-message to one agent, nothing the room acts on in it: quiet, to sender and addressee
const m1 = say(a, "@B can you look at line 3 of the parser? I think the loop is off by one.");
assert.equal(m1.quiet, true, "a plain two-seat working exchange is delivered quiet by default");
assert.deepEqual(m1.audience?.slice().sort(), ids([a, b]));

// 2. a reply to another agent's message, no @: quiet to the replied-to author
const m2 = say(b, "Yes, the bound should be < not <=, looking now.", m1.id);
assert.equal(m2.quiet, true, "a plain reply between two agents is quiet by default");
assert.deepEqual(m2.audience?.slice().sort(), ids([a, b]));

// 3. two named agents is still a working exchange
const m3 = say(a, "@B @C either of you seen this flake before?");
assert.equal(m3.quiet, true);
assert.deepEqual(m3.audience?.slice().sort(), ids([a, b, c]));

// 4. three named agents is the room, not an exchange
assert.ok(!say(a, "@B @C @D standup: who is on what?").quiet, "three or more addressees stay public");

// 5. evidence pointers stay public: a coordination board key, a proposal id, a commit
assert.ok(!say(a, "@B verify/parser is up, please read it.").quiet, "a board key is an evidence pointer");
assert.ok(!say(a, "@B what do you make of prop_1a2b3c4d?").quiet, "a proposal id stays public");
assert.ok(!say(a, "@B the fix is at 1b0871f5 on my branch.").quiet, "a commit stays public");
assert.ok(say(a, "@B that was a deadbeef moment, nothing more.").quiet, "a hex-letter word without a digit is not a commit");

// 5a. the room's OWN board keys are evidence pointers too, whatever prefix the room invented (swarm-180216-182a,
// evidence/auto-quiet-hides-results): the fixed prefix list missed result/, rerun/, prereg/, take/ and bare keys like
// "position", so in 0btz-break "New break, T-B2-8 ... (result/T-B2-8-...)" reached 2 of 3 seats; 91 of 164 auto-quieted
// messages in 13 rooms named a key that was on the room's board.
hub.setBoard(ROOM, a.id, "result/T-B2-8-wide-book", "wide-book reward is modelled but not paid: b = 0.03 per modelled dollar");
hub.setBoard(ROOM, a.id, "position", "POSITION of the group (all three seats edit)");
hub.setBoard(ROOM, b.id, "take/bench", "B has the bench");
const m5a = say(a, "@B New break, T-B2-8, pre-registered (result/T-B2-8-wide-book). Reward from wide books is not paid.");
assert.ok(!m5a.quiet, "a result on the board is the room's business");
assert.equal((m5a as { keptPublic?: string }).keptPublic, "board-key", "the message records that the board-key rule kept it public");
assert.equal((say(a, "The parser bug is fixed, see result/T-B2-8-wide-book.") as { keptPublic?: string }).keptPublic, undefined, "a message that was public anyway carries no mark");
assert.ok(!say(a, "@B you still hold take/bench from the probe. Is anything running?").quiet, "who holds what is the room's business");
assert.ok(!say(a, "@B position is now v11 and its second clause changed.").quiet, "a bare key that is on the board");
assert.ok(!say(a, "@B result/T-B3-3-entrants is scored, once.").quiet, "a new key under a prefix the board already uses");
assert.ok(say(a, "@B the bound in src/hub.ts and/or the parser looks off to me.").quiet, "a file path or a slash in prose is not a board key");

// 5b. what stops duplicate work and what settles a dispute stays public too (attack/idea/quiet-default by -3 and -5):
// a first-person commitment, a settled-axis slug, a RE-TARGET
assert.ok(!say(a, "@B I'll run the parser dev room myself.").quiet, "a commitment is public: seeing it stops duplicate work");
assert.ok(!say(a, "@B I'm taking the lexer, leave it.").quiet, "taking work is a commitment");
assert.ok(!say(a, "@B per quiet-delivery-not-privacy a thread surfaces when cited.").quiet, "a settled-axis slug is public");
assert.ok(!say(a, "@B this is a RE-TARGET of the prompt axis.").quiet, "a RE-TARGET is public");

// 5c. the verifier and a lead act for the room: what they are asked is room business (attack/idea/quiet-default, -3 point 3)
assert.ok(!say(a, "@V ready for integration when you are.").quiet, "a message to the verifier stays public");
assert.ok(!say(verifier, "@A merged, thanks.").quiet, "and so does the verifier's own reply");

// 6. anything naming a human is public
assert.ok(!say(a, "@B @benji asked for this earlier, can you take it?").quiet, "a message naming a human is public");

// 7. the sender's explicit choice wins both ways
assert.ok(!say(a, "@B can you look at the lexer too?", undefined, false).quiet, "quiet=false keeps it public");
assert.ok(say(a, "@B @C @D all of you: lexer?", undefined, true).quiet, "quiet=true is unchanged");

// 8. unaddressed chat and a human's own message are public
assert.ok(!say(a, "The parser bug is fixed in my tree.").quiet, "an unaddressed message is public");
assert.ok(!hub.send(ROOM, human.id, "@A thanks", undefined, true).quiet, "humans speak to the room");

// 9. the sender is told it went quiet and how to undo it
assert.equal((m1 as { autoQuiet?: boolean }).autoQuiet, true, "the message records that the hub chose quiet");
assert.ok(!(say(a, "@B explicit", undefined, true) as { autoQuiet?: boolean }).autoQuiet, "an explicit quiet is the sender's, not the hub's");
assert.match(String((hubModule as Record<string, unknown>).AUTO_QUIET_NOTE ?? ""), /quiet=false/, "the send result tells the sender how to make it public");

console.log("quiet-default-regression OK");
