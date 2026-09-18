#!/usr/bin/env node
/** Rank 6 failing-first regression: shared read-digest convention taught in the prompts
 * (swarm-082729-8b5j-room prop_a7a385ba item 6). Static content check, not a hub/behaviour test:
 * prompts/*.md are literal text baked into every seat's system prompt, and the convention itself
 * (board_get digest/<path>@<hash> before read_file; the first reader board_set's it for later
 * readers) cannot be hub-enforced — read_file is a local seat tool in src/seat.ts, invisible to the
 * hub. This proves the instruction exists, is worded consistently across the target prompts, and
 * encodes a real staleness guard: the file's hash lives IN THE KEY, so an edited file's digest is
 * simply not found at the new key (no hash-comparison logic needed, nothing to get stale silently).
 * RED before the prompts/*.md edit (no file mentions "digest/"); GREEN after.
 * Run: node --import tsx scripts/read-digest-regression.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// minimal.md is deliberately EXCLUDED even though the room brief named it: it is the "default
// minimal" prompt governed by docs/decisions/minimal-prompt-hub-carries-coordination.md ("states
// only the goal, who is in the room and that a board exists; every coordination rule ... is
// enforced by the hub and explained in tool descriptions", scope prompts/**). A read-digest
// convention is exactly that kind of coordination rule and cannot be hub-enforced (see above), so
// it stays out of the one prompt that decision names directly.
const FILES = ["loop.md", "recruit.md", "worker.md"];
const HASH_CMD = "shasum -a 256";

for (const file of FILES) {
  const text = readFileSync(resolve(root, "prompts", file), "utf8");
  assert.match(text, /digest\/<path>@<hash>/, `[${file}] must document the digest/<path>@<hash> board-key convention`);
  assert.ok(text.includes(HASH_CMD), `[${file}] must name the hash command so every seat computes the same key`);
  assert.match(text, /board_get/, `[${file}] must tell seats to board_get the digest before reading`);
  assert.match(text, /board_set/, `[${file}] must tell the first reader to board_set the digest for later readers`);
}

const minimal = readFileSync(resolve(root, "prompts", "minimal.md"), "utf8");
assert.ok(!minimal.includes("digest/"), "minimal.md must not carry the digest convention (minimal-prompt-hub-carries-coordination)");

console.log(`PASS read-digest-regression: ${FILES.join(", ")} document a consistent digest/<path>@<hash> convention (${HASH_CMD} ... | cut -c1-10); minimal.md correctly excluded`);
