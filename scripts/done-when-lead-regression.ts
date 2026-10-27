/**
 * An unmet DONE WHEN sits beside the best example and its gap; the verifier never dictates the opening line
 * (audit/done-when-lead, decision/chair-1009). In the
 * reserve pm-slice pair both rooms named the right winner with its fill counts, but NEW's verifier challenged its
 * proposal to "open with \"DONE WHEN: NOT MET.\"" (ch_91bdc7e0), so the owner's first words were the verdict; the blind
 * rating gave that opening 0 and OLD's qualified negative 1 (rate/scores-chair). The vote gate ("agree only with evidence
 * it meets DONE WHEN") pushes a verdict in every build, and the NOT VERIFIED form of the verifier's own final message,
 * new in that arm, plausibly hardened the push into the opening. The scored rule is where the verdict sits, not whether
 * it is first: OLD's "CONCLUSION: NOT DEMONSTRATED." with its qualifier in the same paragraph scored 1. So step 3 says
 * NOT MET goes in one paragraph with the best existing example and its gap, and the verifier never dictates the opening
 * (review/c5940e60-claude-opus-5-5-2). The words come out of the same prompt (conduct-guidance's budget: under 574).
 * Prompt text only: the behaviour change is unmeasured until a paired run.
 *
 * npx tsx scripts/done-when-lead-regression.ts */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const prompt = readFileSync(new URL("../prompts/verifier.md", import.meta.url), "utf8");
const step3 = prompt.split("\n").find((l) => l.startsWith("3. On the final proposal")) ?? "";
const final = prompt.split("\n").find((l) => l.startsWith("Your final message is ONLY")) ?? "";

// 1. step 3 says where an unmet DONE WHEN goes: one paragraph with the best existing example and its gap, opening undictated
assert.match(step3, /Unmet\? NOT MET goes in one paragraph with the best existing example, its numbers and gap; never dictate the opening line\./,
  "NOT MET sits with the best example and its gap, and the verifier does not dictate the opening");
// 2. the vote gate and the final's first token and cause/yes-if form are unchanged (launcher parsing, verifier #127)
assert.match(step3, /agree only with evidence it meets DONE WHEN/, "the vote gate itself is unchanged");
assert.match(final, /"NOT VERIFIED: <what stopped it: which limit, too few rounds, failed, or untested>; yes-if: <the best existing example and what must change>"/);
// 3. the verifier asks for no verdict-first opening anywhere in its prompt
assert.doesNotMatch(prompt, /open(s)? with "?DONE WHEN/i, "nothing tells the verifier to put DONE WHEN first");
console.log("done-when-lead: OK");
