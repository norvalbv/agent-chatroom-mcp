#!/usr/bin/env node
/** Failing-first regression for absence claims (room swarm-092526-89rn, probe/p1-esports): the probe room's first
 * proposal said the wallets had "no rebate rows… earn none" because the copied activity file held none; that copy was
 * incomplete (the brief said it held rebates), and data-api /activity type=TAKER_REBATE pays them $31,978 and $41,696
 * in the window, which the probe's verifier measured only after an outside steer. A claim that something is absent,
 * zero or never happens is true only over a source that would show it if it existed, so the verifier must ask which
 * source was checked and whether it is complete before it agrees. RED before the prompts/verifier.md edit, GREEN after.
 * Run: node --import tsx scripts/absence-claim-regression.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { absenceClaims } from "../src/run-metrics.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const text = readFileSync(resolve(root, "prompts", "verifier.md"), "utf8");
assert.match(text, /absent, zero or never/i, "verifier.md must tell the verifier to check absence claims");
assert.match(text, /complete/i, "verifier.md must ask which source was checked for completeness");

// telemetry: the proposal texts that make an absence claim, and whether each names where it looked
const log = [
  { type: "proposal", proposal: { id: "prop_1", text: "Verdict: not reproducible. The wallets earn no rebates." } },
  { type: "amend", proposalId: "prop_1", text: "Verdict: not reproducible. No TAKER_REBATE rows exist in activity.csv (grep over all 41,203 rows)." },
  { type: "proposal", proposal: { id: "prop_3", text: "Edge is 1.2c per fill, measured on 900 fills." } },
];
const found = absenceClaims([log]);
assert.deepEqual(found.map((r) => [r.id, r.version, r.sourced]), [["prop_1", 1, false], ["prop_1", 2, true]]);

console.log("PASS absence-claim-regression: verifier.md asks for the completeness source of absence claims; absenceClaims flags 1 unsourced of 2");
