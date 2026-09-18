#!/usr/bin/env node
/** Failing-first regression for the maintainer's quiet-messaging ask (room swarm-084605-6m31,
 * #77, on claim/item3-read-digests): the send_message tool description already explains
 * quiet=true, but that alone was not reaching flat/minimal.md runs in practice — the maintainer's
 * measured evidence was 66 quiet messages in the loop.md lobby (swarm-214936-s3jy-room, which has
 * the guidance) versus 0 in every minimal.md-prompted room measured, including 55/72 addressed
 * messages in swarm-082729-8b5j-room pushed to all 11 seats as full-context turns for the ten with
 * no use for them. Every flat-run-eligible prompt must carry one short reminder: a working exchange
 * with named seats goes quiet, anything someone must act on (claims, evidence, proposals,
 * challenges, votes) stays public.
 *
 * This is a deliberate, maintainer-directed RE-TARGET of minimal-prompt-hub-carries-coordination
 * for minimal.md specifically (see prompts/minimal.md and the room log): the decision's own premise
 * — that explaining a rule in tool descriptions is enough — is exactly what this evidence refutes.
 * RED before the prompts/*.md edit (minimal.md/recruit.md/worker.md carried no quiet guidance);
 * GREEN after. Run: node --import tsx scripts/quiet-guidance-regression.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FILES = ["minimal.md", "loop.md", "recruit.md", "worker.md"];

for (const file of FILES) {
  const text = readFileSync(resolve(root, "prompts", file), "utf8");
  assert.ok(text.includes("quiet=true"), `[${file}] must tell seats a working exchange with named seats goes quiet (send_message quiet=true)`);
  assert.match(text, /public/i, `[${file}] must say what stays public (claims, evidence, proposals, challenges, votes, anything someone must act on)`);
}

console.log(`PASS quiet-guidance-regression: ${FILES.join(", ")} all carry quiet=true guidance and say what stays public`);
