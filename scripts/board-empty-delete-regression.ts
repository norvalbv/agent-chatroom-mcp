/**
 * An empty board_set deleted anyone's entry: setBoard's ownership guard only fired for non-empty text, so a peer could
 * erase a verify/* that gates a proposal, or an attack/* the proposer disliked, without overwrite (found by a seat in
 * claude-opus-5-5-1's dev room swarm-083717-gjep; idea/board-empty-delete). Deleting someone else's entry now follows
 * the replacing rule (overwrite=true, and the notice names whose entry went), and verify/* and attack/* can be cleared
 * only by their author or a human.
 * Run: npx tsx scripts/board-empty-delete-regression.ts
 */
import assert from "node:assert/strict";
const { Hub } = await import("../src/hub.js");

const hub = new Hub();
const a = hub.join("r", "alice", "claude", {}, undefined, "s_a").participant;
const b = hub.join("r", "bob", "claude", {}, undefined, "s_b").participant;
const h = hub.join("r", "benji", "human", {}, undefined, "s_h").participant;
const refused = (fn: () => unknown, why: string) => assert.throws(fn, (e: Error) => /written by alice|only alice|its author/.test(e.message), why);

hub.setBoard("r", a.id, "findings/x", "alice's finding");
hub.setBoard("r", a.id, "verify/x", '{"proposal":"p"}');
hub.setBoard("r", b.id, "notes/b", "bob's claim that the hub never drops a message");
hub.setBoard("r", a.id, "attack/notes/b", 'alice objects to "the hub never drops a message": it drops withheld ones.');

refused(() => hub.setBoard("r", b.id, "findings/x", ""), "a peer's empty write does not delete another seat's finding");
assert.ok(hub.getRoom("r").board.get("findings/x"), "finding still there");
refused(() => hub.setBoard("r", b.id, "verify/x", ""), "a peer cannot clear a verify entry");
refused(() => hub.setBoard("r", b.id, "verify/x", "", { overwrite: true }), "not even with overwrite");
refused(() => hub.setBoard("r", b.id, "attack/notes/b", "", { overwrite: true }), "the attacked author cannot clear the attack");
assert.ok(hub.getRoom("r").board.get("verify/x") && hub.getRoom("r").board.get("attack/notes/b"), "verify and attack survive");

// with overwrite a peer may clear an ordinary entry, and the room is told whose it was
assert.equal(hub.setBoard("r", b.id, "findings/x", "", { overwrite: true }), null);
assert.equal(hub.getRoom("r").board.get("findings/x"), undefined);
assert.ok(hub.getRoom("r").messages.some((m: { content: string }) => m.content.includes('cleared board entry "findings/x"') && m.content.includes("alice")), "notice names the author whose entry was cleared");

// authors and humans keep their powers
assert.equal(hub.setBoard("r", a.id, "verify/x", ""), null, "the author clears her own verify entry");
assert.equal(hub.setBoard("r", h.id, "attack/notes/b", ""), null, "a human may clear anything");
assert.equal(hub.setBoard("r", b.id, "notes/b", ""), null, "an author clears his own entry");
console.log("board-empty-delete regression OK");
