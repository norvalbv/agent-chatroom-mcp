/**
 * The swarm skill's "How a room closes" section says what the code does (the operator who launches the next rooms reads
 * the skill, not the commits). Each claim is checked against a constant or a source line, so a later change to the
 * window, the silence bound or the env name fails here instead of leaving the skill wrong.
 * Run: npx tsx scripts/skill-closing-regression.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Hub } from "../src/hub.js";
import { SUSPECTED_DEAD_MS } from "../src/hub/kick.js";

const skill = readFileSync(new URL("../skills/swarm/SKILL.md", import.meta.url), "utf8");
const hub = readFileSync(new URL("../src/hub.ts", import.meta.url), "utf8");
const index = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");
const section = skill.slice(skill.indexOf("## How a room closes"), skill.indexOf("## Running it and watching"));
assert.ok(section.length > 200, "the section exists");
assert.match(section, new RegExp(`${Hub.SERVED_LAST_CALL_MS / 1000} s on a served hub`), "the window it states is the served default");
assert.match(index, /CHATROOM_LAST_CALL_MS/, "and the env name it gives is the one index.ts reads");
assert.match(section, /CHATROOM_LAST_CALL_MS/);
assert.match(section, new RegExp(`silent for ${SUSPECTED_DEAD_MS / 60_000} minutes`), "the silence bound is SUSPECTED_DEAD_MS");
assert.match(hub, /Concluded WITHOUT the verifier's agree/, "the conclusion line it quotes exists");
assert.match(section, /Concluded WITHOUT the verifier's agree/);
assert.match(hub, /LAST CALL: /);
assert.match(hub, /agreed_unsent/);
assert.match(hub, /"amend-stale"/);
// the launcher creates group rooms (as breakouts) only under these flags: the section names each (review/77d2048f); the
// leads/flat room itself is created whatever the flags (swarm-092526-89rn, scripts/topic-once-regression.ts)
const swarm = readFileSync(new URL("../src/swarm.ts", import.meta.url), "utf8");
const cond = /if \((REQUIRE_VERIFICATION[^)]*)\) \{\s*\n\s*\/\/ a hand-written group/.exec(swarm);
assert.ok(cond, "found the launcher's room-create condition");
for (const [v, flag] of [["REQUIRE_VERIFICATION", "--require-verification"], ["QUORUM", "--quorum"], ["CHAIR", "--chair"]] as const) if (cond![1].includes(v)) assert.ok(section.includes(flag), `the section names ${flag}`);
console.log("skill-closing-regression OK");
