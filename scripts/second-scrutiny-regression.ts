/**
 * A second seat's attack, review or verify entry lands under its own key instead of being refused after the work
 * (friction/second-attack-has-no-key, friction/duplicate-review, swarm-180216-182a). attack/<key>, review/<sha> and
 * verify/<area> are author-only, so the second seat to write one was refused for ownership once its text existed: here
 * a 1,900-character attack on decision/verifier-vote-counts at 18:37, written two minutes after the verifier's; in the
 * records since 2026-10-10, 7 of 38 attack/* writes were refused. The point then went into chat, where the hub tracks
 * no open attack. Now the entry lands as <key>.<writer>, the reply and the notice say so, and a second attack is an
 * open attack on the same target that its author is asked to answer. Clearing someone else's entry stays refused.
 * Run: npx tsx --test scripts/second-scrutiny-regression.ts
 */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Hub } from "../src/hub.js";

const FINDING = `The cap counts notes that need no acknowledgement, so ten digests block every later note to the room. ${"More detail on the measured rooms. ".repeat(6)}`;

function fixture(t: { after: (fn: () => void) => void }) {
  const dataDir = mkdtempSync(join(tmpdir(), "second-scrutiny-"));
  const hub = new Hub({ dataDir });
  const name = "second-scrutiny";
  const a = hub.join(name, "Alice", "test", { requireChallenge: false, expectedParticipants: 3 }, undefined, "session-a").participant;
  const b = hub.join(name, "Bob", "test", {}, undefined, "session-b").participant;
  const c = hub.join(name, "Carol", "test", {}, undefined, "session-c").participant;
  const room = hub.getRoom(name);
  t.after(() => { clearTimeout(room.nudgeTimer); clearTimeout(room.openingsTimer); });
  hub.setBoard(name, a.id, "decision/inbox-cap", FINDING);
  return { hub, room, a, b, c, dataDir };
}
const keyOf = (room: { board: Map<string, unknown> }, e: unknown) => [...room.board].find(([, x]) => x === e)?.[0];

test("a second attacker's entry lands under its own key, is an open attack on the same target, and is answered like the first", (t) => {
  const { hub, room, a, b, c, dataDir } = fixture(t);
  hub.setBoard(room.name, b.id, "attack/decision/inbox-cap", 'Weakest: "ten digests block every later note to the room" is counted on two rooms only.');
  const second = hub.setBoard(room.name, c.id, "attack/decision/inbox-cap", 'A different point: "The cap counts notes that need no acknowledgement" mixes two causes.')!;
  assert.equal(keyOf(room, second), "attack/decision/inbox-cap.Carol", "the second attack is kept, under the writer's name");
  assert.equal(room.board.get("attack/decision/inbox-cap")!.by, "Bob", "the first attack is untouched");
  assert.match(room.messages.at(-1)!.content, /@Alice Carol attacked your "decision\/inbox-cap" in "attack\/decision\/inbox-cap\.Carol"/);
  assert.match(room.messages.find((m) => m.kind === "board" && m.from.name === "Carol")!.content, /attack\/decision\/inbox-cap\.Carol.*Bob already holds "attack\/decision\/inbox-cap"/);
  assert.deepEqual(hub.scrutiny(room.name).open_attacks.sort(), ["attack/decision/inbox-cap", "attack/decision/inbox-cap.Carol"]);
  // Carol writing again updates her own entry, whichever key she uses
  hub.setBoard(room.name, c.id, "attack/decision/inbox-cap", 'Revised: "The cap counts notes that need no acknowledgement" mixes two causes, see the split.');
  assert.match(room.board.get("attack/decision/inbox-cap.Carol")!.text, /^Revised/);
  assert.equal([...room.board.keys()].filter((k) => k.startsWith("attack/")).length, 2);
  const events = readFileSync(join(dataDir, `${room.name}.jsonl`), "utf8").trim().split("\n").map((l) => JSON.parse(l)).filter((e) => e.type === "second_scrutiny");
  assert.deepEqual(events.map((e) => [e.asked, e.key, e.by, e.held_by]), [["attack/decision/inbox-cap", "attack/decision/inbox-cap.Carol", "Carol", "Bob"]], "logged once, when the second entry is created");
  // the author answers both by replying in the attacked entry
  hub.setBoard(room.name, a.id, "decision/inbox-cap", `${FINDING}\nANSWER to both attacks: the count is over two rooms and says so; the two causes are split below. ${"x".repeat(60)}`);
  assert.deepEqual(hub.scrutiny(room.name).open_attacks, []);
});

test("a second review or verify entry lands under its own key too; replacing or clearing a peer's stays refused", (t) => {
  const { hub, room, b, c } = fixture(t);
  const head = (exit: number) => JSON.stringify({ proposal: "pending", command: "npx tsx scripts/x.ts", cwd: "/w", base_commit: "0123abc", base_exit_code: 1, commit: "a1b2c3d4e5", exit_code: exit, output_tail: "x" });
  hub.setBoard(room.name, b.id, "review/a1b2c3d4", head(1));
  const mine = hub.setBoard(room.name, c.id, "review/a1b2c3d4", head(0))!;
  assert.equal(keyOf(room, mine), "review/a1b2c3d4.Carol");
  assert.equal(JSON.parse(room.board.get("review/a1b2c3d4")!.text).exit_code, 1, "Bob's failing verdict stands");
  assert.deepEqual((hub.summary(room).reviews as { by: { key: string }[] }[])[0].by.map((x) => x.key), ["review/a1b2c3d4", "review/a1b2c3d4.Carol"]);
  hub.setBoard(room.name, b.id, "verify/build", head(0));
  assert.equal(keyOf(room, hub.setBoard(room.name, c.id, "verify/build", head(0))), "verify/build.Carol");
  // a second .partial stays a .partial (it must never count toward the gate), with the writer's name before the suffix
  hub.setBoard(room.name, b.id, "verify/soak.partial", "could not run the soak: no free port");
  assert.equal(keyOf(room, hub.setBoard(room.name, c.id, "verify/soak.partial", "ran 2 of 10 minutes, then the hub was stopped")), "verify/soak.Carol.partial");
  assert.throws(() => hub.setBoard(room.name, c.id, "review/a1b2c3d4", ""), /only its author or a human may clear/);
  assert.throws(() => hub.setBoard(room.name, c.id, "review/a1b2c3d4", head(0), { overwrite: true }), /only its author or a human may replace/, "overwrite=true asks to replace a peer's verdict");
  assert.throws(() => hub.setBoard(room.name, c.id, "attack/decision/nothing-here", 'no such "target entry at all"'), /no board entry/);
});
