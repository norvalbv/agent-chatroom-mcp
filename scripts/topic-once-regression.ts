#!/usr/bin/env node
/** Failing-first regression (swarm-092526-89rn, evidence/context-share-transcripts): a flat-run brief carried the room
 * topic twice: once as the brief itself and once more as the topic="{{TOPIC}}" argument of its join instruction. The seat
 * then copies that argument into its join_room call, so the topic sat in every request's context three times before
 * join_room's own result added a fourth. In swarm-092526-89rn the topic is ~8.3k chars, so each surplus copy is ~2k tokens
 * re-read on every model request of every seat. join_room settings apply only when the call creates the room, and the
 * launcher now always creates the flat room itself (swarm.ts, before any seat launches), so the argument does nothing.
 *
 * RED before the change: minimal.md, terse.md and loop.md each render the topic twice, and swarm.ts pre-creates the
 * room only under --require-verification/--quorum/--chair. GREEN after.
 * Run: npx tsx scripts/topic-once-regression.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MARK = "TOPIC-MARKER-7f3c";
const render = (file: string) =>
  Object.entries({ NAME: "seat-1", N: 3, ROOM: "r", TOPIC: MARK, AGENT: "claude" })
    .reduce((s, [k, v]) => s.split(`{{${k}}}`).join(String(v)), readFileSync(resolve(root, "prompts", file), "utf8"));

for (const file of ["minimal.md", "terse.md", "loop.md"]) {
  const n = render(file).split(MARK).length - 1;
  assert.equal(n, 1, `[${file}] renders the topic ${n} times; a flat brief should carry it once`);
}

// the verifier joins the same pre-created room; its topic="Final answer: {{TASK}}" argument was the one copy left
// (dev room swarm-095501-i8xt: the verifier's join_room args were 1664 chars, the worker's 103, for a 1506-char topic)
const verifier = readFileSync(resolve(root, "prompts", "verifier.md"), "utf8").split("{{TASK}}").join(MARK);
const nv = verifier.split(MARK).length - 1;
assert.equal(nv, 1, `[verifier.md] renders the task ${nv} times; the verifier joins the pre-created room, so topic= is dead weight`);

// with no topic= in the join instruction, the first seat to join would otherwise create a room with no topic
const swarm = readFileSync(resolve(root, "src", "swarm.ts"), "utf8");
const create = swarm.indexOf("/rooms/${encodeURIComponent(leadsRoom)}/create");
const gate = swarm.indexOf("if (REQUIRE_VERIFICATION || QUORUM || CHAIR)");
assert.ok(create > 0, "swarm.ts must pre-create the leads/flat room");
assert.ok(gate < 0 || create < gate, "swarm.ts must pre-create the leads/flat room with its topic whatever the policy flags");
console.log("topic-once-regression OK");
