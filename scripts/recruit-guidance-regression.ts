#!/usr/bin/env node
/** Failing-first regression for decision/recruit-timing B3 (swarm-005940-77tu, owner ask 8, "when more aptly to use
 * recruits"). prompts/loop.md told every lobby seat "Recruit freely" and sent a paper read to a break-out room. In the
 * records (scripts/recruit-census.py) an in-room recruit costs a median $3 and delivers in ~3-4 min, while a break-out
 * ran 3 seats, 29 min and $28 (n=6). This room's 10-recruit burst overran the machine. So loop.md now says:
 *   - one self-contained job with one output is one recruit in the room, not a break-out;
 *   - a break-out is for a question several seats argue or verify, or a build, and it is seeded with its first tasks;
 *   - recruit only when no free seat can start the job the room waits on, or it needs a fresh context.
 * RED at f6a9eabb, GREEN after. Run: node --import tsx scripts/recruit-guidance-regression.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const loop = readFileSync(resolve(root, "prompts", "loop.md"), "utf8");

assert.doesNotMatch(loop, /Recruit freely/, "loop.md must not tell seats to recruit freely");
assert.doesNotMatch(loop, /or a paper needs reading, or something needs building, `request_agent` with a new_room/, "a paper read is one recruit, not a break-out room");
assert.match(loop, /one recruit in this room/, "loop.md says a self-contained job with one output is one recruit in the room");
assert.match(loop, /no seat here is free/, "loop.md says when to recruit: no free seat can start the job");
assert.match(loop, /fresh context/, "loop.md names a fresh context (an independent check) as a reason to recruit");
assert.match(loop, /first task/, "loop.md says a break-out is seeded with each seat's first task");

console.log("PASS recruit-guidance-regression: loop.md says when to recruit, when to break out, and no longer says recruit freely");
