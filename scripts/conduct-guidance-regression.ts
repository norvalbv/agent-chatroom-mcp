#!/usr/bin/env node
/**
 * Failing-first regression for owner ask 5 ("general better guidance to verifier, and agents within said room"),
 * swarm-005940-77tu evidence/seat-verifier-guidance. Run: node --import tsx scripts/conduct-guidance-regression.ts
 *
 * - 139 of 155 runs with a verifier were flat, yet verifier.md told it "the others investigate in sub-rooms and their
 *   leads bring conclusions" and that the room was unanimous; its flat-room work (a seat's commit, a break-out's
 *   inbox/<room>/conclusion) was never named. In 9f66 the parent verifier reran bk2/bk4/bk5 by choice (#2910, #2934).
 * - Seats had to be told, in 46 board entries over 14 rooms: look at claim/take/review before building (10 entries,
 *   4 rooms) and take figures from the record, reading earlier findings first (9 incidents, 3 rooms). No seat prompt
 *   said either.
 * - help/<area> and join-request/<area> were prescribed in recruit.md and written 4 times each in 332 logs. Two lines
 *   stay that other suites require: the verify head (verify-fail-to-pass-regression) and filedigest/<hash>
 *   (read-digest-regression, settled axis token-cost-is-resent-context), though filedigest/ was written 0 times.
 * - IFScale (sources/arXiv:2507.11538): more instructions, worse following, earlier ones favoured. So both files must
 *   carry the new rules in FEWER words than at f6a9eabb (verifier.md 574, recruit.md 455).
 * RED at 3ab2f440 (dd4195b8 + 80da69ea + 0d9cc769): 8 failed; GREEN after.
 */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promptDigests } from "../src/result.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (f: string) => readFileSync(resolve(root, "prompts", f), "utf8");
const words = (s: string) => s.split(/\s+/).filter(Boolean).length;
let failed = 0;
const check = (name: string, fn: () => void) => {
  try { fn(); console.log(`PASS ${name}`); } catch (e) { failed++; console.error(`FAIL ${name}: ${e instanceof Error ? e.message.split("\n")[0] : e}`); }
};

// the verifier prompt as src/swarm.ts renders it for a flat run (GROUP_LIST's flat value)
const verifier = read("verifier.md").split("{{GROUP_LIST}}").join("none: every agent is in this one room with you, and may recruit or break out into sub-rooms");
const recruit = read("recruit.md");

check("verifier.md does not describe a leads room to a flat-room verifier", () => {
  for (const wrong of [/investigate in sub-rooms and their leads/i, /each time a lead posts/i, /room is unanimous/i, /no lead has proposed/i]) assert.doesNotMatch(verifier, wrong);
});
check("verifier.md names what lands in a flat room: a seat's commit and a break-out's inbox conclusion", () => {
  assert.match(verifier, /commit/i);
  assert.match(verifier, /inbox\/<room>\/conclusion/);
  assert.match(verifier, /break-out/i);
});
check("verifier.md checks the parent's text carries a break-out's numbers and caveats", () => assert.match(verifier, /numbers and caveats/i));
check("verifier.md looks for someone else's review before checking", () => assert.match(verifier, /review\/<sha>/));
check("verifier.md keeps what other suites assert (absence claims, Slug line, background jobs, quoted hold)", () => {
  assert.match(verifier, /absent, zero or never/i);
  assert.match(verifier, /complete/i);
  assert.match(verifier, /its own line `Slug: <kebab-case-slug>`/);
  assert.match(verifier, /stop every background command and Monitor/);
  assert.match(verifier, /`quote` set to the pending line/);
  assert.match(verifier, /hold\/<room>/);
});
check("recruit.md: look for the same work before building, reviewing or recruiting, and take it first", () => {
  assert.match(recruit, /claim\/\*, take\/\* and review\/<sha>/);
  assert.match(recruit, /before you start/i);
});
check("recruit.md: figures from the record, earlier findings first", () => {
  assert.match(recruit, /never from memory/i);
  assert.match(recruit, /already found/i);
});
check("recruit.md drops the conventions nobody used", () => {
  for (const dead of [/help\/<area>/, /join-request\/<area>/]) assert.doesNotMatch(recruit, dead);
  assert.match(recruit, /board_set/, "it points at the tool that carries the conventions");
});
check("fewer words than at f6a9eabb (verifier.md 574, recruit.md 455)", () => {
  assert.ok(words(read("verifier.md")) < 574, `verifier.md has ${words(read("verifier.md"))} words`);
  assert.ok(words(recruit) < 455, `recruit.md has ${words(recruit)} words`);
});

// telemetry: the launcher records which prompt texts its seats got, so a replay can compare rooms by prompt version
check("promptDigests: one 12-hex digest per template, changing with its text", () => {
  const d = promptDigests(resolve(root, "prompts"), ["verifier.md", "recruit.md"]);
  assert.deepEqual(Object.keys(d), ["verifier.md", "recruit.md"]);
  for (const v of Object.values(d)) assert.match(v, /^[0-9a-f]{12}$/);
  assert.notEqual(d["verifier.md"], d["recruit.md"]);
  assert.deepEqual(promptDigests(resolve(root, "prompts"), ["no-such.md"]), {}, "a missing template is left out, not thrown");
});

// the reader a replay scores verifier conduct with (evidence/seat-verifier-guidance E): 9f66's verifier re-cast its
// disagree 4 times and chatted "still holding" while it stood; 0 hold/* writes in 149 rooms with a verifier
const fixture = [
  { type: "join", p: { id: "p_v", name: "verifier", role: "verifier" } },
  { type: "join", p: { id: "p_w", name: "seat-1", role: "worker" } },
  { type: "vote", proposalId: "prop_1", pid: "p_v", entry: { vote: "disagree", quote: "bk2 result is PENDING" } },
  { type: "message", msg: { seq: 5, kind: "chat", from: { id: "p_v" }, content: "Verifier, still holding (this isn't silence)." } },
  { type: "amend", proposalId: "prop_1", votes: {} },
  { type: "message", msg: { seq: 7, kind: "chat", from: { id: "p_v" }, content: "dropped by the amend, so this is not chat while disagreeing" } },
  { type: "vote", proposalId: "prop_1", pid: "p_v", entry: { vote: "disagree", quote: "bk2 result is PENDING" } },
  { type: "amend", proposalId: "prop_1", votes: { p_v: { vote: "disagree" } } },
  { type: "message", msg: { seq: 9, kind: "chat", from: { id: "p_w" }, content: "a seat's message is not the verifier's" } },
  { type: "board", key: "hold/r", entry: { by: "verifier", text: "waiting on bk2 until 02:10" } },
  { type: "board", key: "review/abc1234", entry: { by: "verifier", text: "{}" } },
  { type: "board", key: "review/def5678", entry: { by: "seat-1", text: "{}" } },
  { type: "work", pid: "p_v", tool: "Bash", target: "node -e 'median([4,1,3,2])'" },
  { type: "vote", proposalId: "prop_1", pid: "p_v", entry: { vote: "agree", quote: "x" } },
  { type: "message", msg: { seq: 12, kind: "chat", from: { id: "p_v" }, content: "Agreed." } },
];
await (async () => {
  try {
    const { conductRow } = await import("./verifier-conduct.js");
    const dir = mkdtempSync(join(tmpdir(), "conduct-"));
    const file = join(dir, "r-room.jsonl");
    writeFileSync(file, fixture.map((e) => JSON.stringify(e)).join("\n") + "\nnot json\n");
    const row = await conductRow(file);
    assert.deepEqual({ ...row, chat_while_disagreeing: row!.chat_while_disagreeing.map((m: { seq: number }) => m.seq) }, {
      room: "r-room", verifier: "verifier", disagrees: 2, recast: 1, chat: 3, chat_median_words: 6, chat_over_100: 0,
      chat_while_disagreeing: [5], hold_writes: 1, reviews: ["review/abc1234"], bash: 1,
    });
    writeFileSync(file, JSON.stringify(fixture[1]) + "\n");
    assert.equal(await conductRow(file), null, "a room with no verifier has no row");
    console.log("PASS verifier-conduct: re-casts, chat while its disagree stands, hold/ writes, its reviews, its commands");
  } catch (e) { failed++; console.error(`FAIL verifier-conduct: ${e instanceof Error ? e.message.split("\n")[0] : e}`); }
})();

if (failed) { console.error(`CONDUCT GUIDANCE: ${failed} failed`); process.exitCode = 1; }
else console.log("CONDUCT GUIDANCE OK");
