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

const hub = new Hub({});
const ROOM = "quiet-default";
const join = (name: string, agent = "claude") => hub.join(ROOM, name, agent, { nudgeAfterMs: 0 }, undefined, `s-${name}`).participant;
const a = join("A"), b = join("B"), c = join("C"), d = join("D");
const human = join("benji", "human");
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
