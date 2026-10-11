/**
 * The SKILL's paragraphs on review links, checks, late results, the hub's clock and stated limits say numbers and names a
 * launcher or a seat acts on; each is tied here to the code, so a later change that makes the skill wrong fails this test
 * instead (the pattern of scripts/skill-closing-regression.ts). Pure reads: no hub is started.
 * Run: npx tsx --test scripts/skill-review-claims-regression.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { Hub } from "../src/hub.js";
import { BOARD_ENTRY_MAX } from "../src/hub/board.js";
import { CHECK_PREFIXES, VERDICT_HINT, verdictOf } from "../src/hub/checks.js";
import { TIME_CLAIM_SLACK_MIN } from "../src/hub/clock.js";

const skill = readFileSync("skills/swarm/SKILL.md", "utf8");
const said = (re: RegExp, what: string) => assert.match(skill, re, `the SKILL no longer says ${what}`);

test("late results: the window the SKILL names is the hub's default, and the env var is the one the hub reads", () => {
  said(/`CHATROOM_LATE_WRITE_MS` \(default 3 hours, 0 = off\)/, "the late-results window");
  assert.equal(Hub.LATE_WRITE_MS, 3 * 60 * 60_000, "Hub.LATE_WRITE_MS default (CHATROOM_LATE_WRITE_MS unset in this test)");
  assert.match(readFileSync("src/hub.ts", "utf8"), /process\.env\.CHATROOM_LATE_WRITE_MS/);
});

test("checks: the prefixes and the verdict line the SKILL lists are the resolver's", () => {
  for (const p of ["rerun/", "audit/", "review/", "valid/", "critique/", "check/", "attack/", "verify/"]) {
    assert.ok(CHECK_PREFIXES.includes(p), `${p} is a check prefix in checks.ts`);
    assert.ok(skill.includes(`\`${p}\``), `the SKILL names ${p}`);
  }
  said(/VERDICT: holds\|fails\|partial/, "the declared verdict line");
  assert.equal(verdictOf("VERDICT: holds — exact"), "holds");
  assert.match(VERDICT_HINT, /VERDICT: holds\|fails\|partial/);
});

test("the clock and the limits: the thresholds the SKILL states are the code's", () => {
  said(/more than 5 minutes from the hub's clock/, "the time-claim slack");
  assert.equal(TIME_CLAIM_SLACK_MIN, 5);
  said(/over 8,000 characters/, "the board entry cap");
  assert.equal(BOARD_ENTRY_MAX, 8000);
  said(/`limits` `\{message_chars, board_entry_chars, opening_chars\}`/, "the limits field");
});

