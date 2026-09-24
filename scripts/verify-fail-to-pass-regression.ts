/**
 * Verify gate stage 1 (docs/decisions/proposed/verify-head-fail-to-pass.md; todo/verify-gate-fail-to-pass.md and
 * todo/reviewer-prompts-exercise-behaviour.md, from docs/reuse-survey-2026-09-23.md "Verify gate" and "Reviewer and
 * verifier prompts"). A verify/* head now carries fail-to-pass evidence in SWE-bench's sense (Jimenez et al. 2023,
 * arXiv:2310.06770, FAIL_TO_PASS): the reviewer's check failed at the parent commit (base_exit_code nonzero) and the
 * same check passes at the proposal's commit. A refactor has nothing that can fail before it, so it takes the
 * PASS_TO_PASS path instead: "refactor":true with base_exit_code 0, named on the conclusion so it stays visible.
 * An optional kind (existing_tests | own_check | exercised) matches the census classes in
 * scripts/paper-verify-practice.ts. Every earlier rule of the gate still holds.
 *
 * The reviewer prompts port two rules from the OpenHands extensions qa-changes plugin (MIT,
 * github.com/OpenHands/extensions, skills/qa-changes/SKILL.md and plugins/qa-changes/scripts/prompt.py at
 * 76bbae25): exercise the changed behaviour the way a user would instead of re-running the suite, and say what
 * you were unable to verify (switch approach after three attempts, give up after two approaches).
 *
 * RED at d755a873: a passing head with no base_commit/base_exit_code satisfied verifiedBy(), failToPassShortfall
 * and VERIFY_KINDS did not exist, and the prompts taught the head without fail-to-pass fields.
 * Run: npx tsx --test scripts/verify-fail-to-pass-regression.ts
 */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { failToPassShortfall, Hub, parseVerifyHead, VERIFY_HEAD_EXAMPLE, VERIFY_HEAD_RULE, VERIFY_KINDS, type VerifyHead } from "../src/hub.js";
import { createSessionServer } from "../src/server.js";
import { CLASSES } from "./paper-verify-practice.ts";

const base = { command: "npx tsx probe.ts", cwd: "/repo", output_tail: "probe ok" };
/** A counting head: fails at the parent commit, passes at the proposal's. */
const f2p = (proposal: string, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ proposal, ...base, base_commit: "a1b2c3d", base_exit_code: 1, commit: "e4f5a6b", exit_code: 0, ...extra });

function fixture(t: { after: (fn: () => void) => void }, opts: { challenge?: boolean | "auto" } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "verify-f2p-"));
  const hub = new Hub({ dataDir: dir });
  const name = "verify-f2p";
  const a = hub.join(name, "Alice", "test", { requireVerification: true, requireChallenge: opts.challenge ?? false, expectedParticipants: 2 }, undefined, "session-a").participant;
  const b = hub.join(name, "Bob", "test", {}, undefined, "session-b").participant;
  const room = hub.getRoom(name);
  hub.setBoard(name, a.id, "verify/author", JSON.stringify({ proposal: "pending", command: "npm test", cwd: "/repo", exit_code: 0, output_tail: "ok" }));
  const pr = hub.propose(name, a.id, "Ship the fix as tested.");
  t.after(() => {
    clearTimeout(room.nudgeTimer);
    clearTimeout(room.openingsTimer);
    rmSync(dir, { recursive: true, force: true });
  });
  const agree = () => {
    for (const p of [a, b]) if (room.state === "open") hub.vote(name, p.id, pr.id, "agree", undefined, undefined, "Ship the fix as tested");
  };
  const refusal = () => hub.blockedBy(room, pr).find((m) => m.startsWith("a verify/* board entry")) ?? "";
  return { hub, room, pr, a, b, agree, refusal };
}

// ---------- the head ----------

test("parseVerifyHead type-checks the new optional fields and the kind enum", () => {
  const ok = parseVerifyHead(f2p("p1", { kind: "exercised", refactor: false }));
  assert.equal(ok?.base_exit_code, 1);
  assert.equal(ok?.kind, "exercised");
  assert.equal(parseVerifyHead(f2p("p1", { base_exit_code: "1" })), undefined, "base_exit_code must be a number");
  assert.equal(parseVerifyHead(f2p("p1", { base_commit: 7 })), undefined, "base_commit must be a string");
  assert.equal(parseVerifyHead(f2p("p1", { refactor: "yes" })), undefined, "refactor must be a boolean");
  assert.equal(parseVerifyHead(f2p("p1", { kind: "self-check" })), undefined, "kind must be one of the three classes");
  for (const kind of VERIFY_KINDS) assert.equal(parseVerifyHead(f2p("p1", { kind }))?.kind, kind);
});

// Passing census heads that report a check run without the change (at the parent or base, on main, or with the fix
// reverted, swapped out or deleted) where it failed, and with the change where it passed, but only as free text the
// gate does not interpret: the prose under the head, or the head's own command and output_tail strings (25wq#5, #6,
// #7 and #9). Each id maps to the words that say so. Versions of one board entry are separate census heads, so a
// later version that repeats the run counts again (kooz#3 after kooz#1, 25wq#9 after 25wq#7), as does a later entry
// in which the same seat reports its earlier run (pen5#14, citing pen5#2's verify/branch1-crashfix).
// README.md and the decision record cite this count as "at least 19"; NOT_FAIL_BEFORE says why it is "at least".
const FREE_TEXT_FAIL_BEFORE: Record<string, string> = {
  "swarm-011152-pen5#2": "pre-fix 9eba547 gave 4/4 snag screens",
  "swarm-011152-pen5#11": "The new regression test FAILS on 91a1cb2 (without the fix",
  "swarm-011152-pen5#14": "prod repro 4/4 snag screens before, 0/4 after",
  "swarm-083203-kooz#1": "with af45763's hub.ts, 1 of 9 fails",
  "swarm-083203-kooz#2": "which exits 1 at 4755f75",
  "swarm-083203-kooz#3": "with af45763's hub.ts, 1 of 9 fails",
  "swarm-083203-kooz#5": "hub-notice-not-debt 4/4 (0/4 on main src)",
  "swarm-092653-202z#5": "Smoke was red on main 1a7c0f0",
  "swarm-120937-t1gx#1": "New regression independently failed on parent reporter (10 pass/1 fail) and passed on fix",
  "swarm-140213-25wq#2": "Tested against unmodified main: regression fails",
  "swarm-140213-25wq#3": "Ran the regression against unmodified main first (fails",
  "swarm-140213-25wq#4": "Regression fails on main",
  "swarm-140213-25wq#5": "main: ERR_ASSERTION actual:false expected:true (red)",
  "swarm-140213-25wq#6": "RED on main hub.ts",
  "swarm-140213-25wq#7": "RED on main server.ts",
  "swarm-140213-25wq#8": "Regression red against main's hub.ts",
  "swarm-140213-25wq#9": "RED on main server.ts",
  "swarm-174126-0s5m#5": "the focused regression then exited 1",
  "swarm-193626-mwbk#28": "before the fix council.test was 9/9 failing",
};
// The search: words for a run without the change, looked for in each passing head's text and in all three census
// coders' reasons (coder_a, coder_b, final in bench/results/verify-practice/codes.json). Every head it finds is in
// FREE_TEXT_FAIL_BEFORE or here, with why it is left out. The borderline ones (0s5m#3 and #4, mwbk#30) are why the
// docs say "at least".
const FAIL_BEFORE_WORDS =
  /\bred\b|revert|swapped in|unmodified|\bpre-fix\b|without (the )?fix|before the fix|before\/after|before and after|\d+\/\d+ [a-z ]{0,20}before|fail(s|ed)? (on|at|against|without) (main|base|the parent|parent|unmodified|[0-9a-f]{7})|exits? 1 at/i;
const NOT_FAIL_BEFORE: Record<string, string> = {
  "swarm-011152-pen5#8": "draw calls before and after a storeys change; nothing failed before it",
  "swarm-042511-ov9e#5": "no run without the change: the lead's old repro now fails its settled:false assertion because the bug is gone",
  "swarm-042511-ov9e#7": "the reverted head d410ff3 is the proposal's own commit, and only it was tested",
  "swarm-042511-ov9e#8": "the reverted head d410ff3 is the proposal's own commit, and only it was tested",
  "swarm-042511-ov9e#9": "the reverted head d410ff3 is the proposal's own commit, and only it was tested",
  "swarm-120129-s12h#1": "describes a hash checked before and after a benchmark run, not a check run without the change",
  "swarm-125438-jp20#0": "says it did not re-verify the red state",
  "swarm-164742-5jvl#8": "a flaky test rerun on unmodified main, where it passed",
  "swarm-171735-2lp8#3": "the checks also passed before the fix; the pixel step before and after measures the reviewer's own CSS fix",
  "swarm-174126-0s5m#3": "borderline: 'red before / green after' is in its summary of the diff (the author's tamper test); it does not say the writer ran it",
  "swarm-174126-0s5m#4": "borderline: 'red before / green after' is in its summary of the diff (the author's tamper test); it does not say the writer ran it",
  "swarm-193626-mwbk#24": "before and after screenshots and draw calls from an earlier visual review; nothing failed",
  "swarm-193626-mwbk#25": "the author's before and after screenshots; the reviewer ran no check without the change",
  "swarm-193626-mwbk#30": "borderline: the reviewer's probe counts 241 facing samples before and 7 after, with no failing exit or assertion",
};

test("the census still parses exactly as recorded: 241 of 260 heads, row by row, and no head carries fail-to-pass fields", () => {
  const rows = readFileSync("bench/results/verify-practice/heads.jsonl", "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as { id: string; text: string; schema_valid: boolean });
  const drift = rows.filter((r) => (parseVerifyHead(r.text) !== undefined) !== r.schema_valid).map((r) => r.id);
  assert.deepEqual(drift, [], "parseVerifyHead must keep the paper's schema_valid count (paper/sections/results.tex, How seats check each other)");
  assert.equal(rows.filter((r) => r.schema_valid).length, 241);
  const passing = rows.map((r) => ({ id: r.id, text: r.text, head: parseVerifyHead(r.text) })).filter((r): r is { id: string; text: string; head: VerifyHead } => !!r.head && r.head.exit_code === 0);
  assert.equal(passing.length, 237);
  const shortfalls = passing.map((r) => failToPassShortfall(r.head));
  assert.equal(shortfalls.filter((s) => !s).length, 0, "no census head carries base_commit/base_exit_code fields");
  assert.equal(shortfalls.filter((s) => s?.startsWith('it names no "commit"')).length, 123, "123 passing heads name no commit");
  assert.equal(shortfalls.filter((s) => s?.startsWith('it names no "base_commit"')).length, 114, "114 name a commit but no base commit");

  // A failing-before run that lives only in free text is still refused: the gate reads the head's fields.
  assert.equal(Object.keys(FREE_TEXT_FAIL_BEFORE).length, 19);
  for (const [id, words] of Object.entries(FREE_TEXT_FAIL_BEFORE)) {
    const row = passing.find((r) => r.id === id);
    assert.ok(row, `${id} is a passing census head`);
    assert.ok(row.text.includes(words), `${id} says: ${words}`);
    assert.ok(failToPassShortfall(row.head), `${id}'s head carries no fail-to-pass fields`);
  }
  const codes = JSON.parse(readFileSync("bench/results/verify-practice/codes.json", "utf8")) as Record<"coder_a" | "coder_b" | "final", Record<string, { reason: string }>>;
  const reasons = (id: string) => (["coder_a", "coder_b", "final"] as const).map((k) => codes[k][id]?.reason ?? "");
  const found = passing.filter((r) => [r.text, ...reasons(r.id)].some((t) => FAIL_BEFORE_WORDS.test(t))).map((r) => r.id);
  assert.deepEqual(found.sort(), [...Object.keys(FREE_TEXT_FAIL_BEFORE), ...Object.keys(NOT_FAIL_BEFORE)].sort(), "every head the search finds is counted or left out with a reason");
  assert.match(readFileSync("README.md", "utf8"), new RegExp(`At least ${Object.keys(FREE_TEXT_FAIL_BEFORE).length} of them describe a failing-before`), "README.md cites this count");
});

test("kind matches the census classes in scripts/paper-verify-practice.ts", () => {
  assert.deepEqual([...VERIFY_KINDS], ["existing_tests", "own_check", "exercised"]);
  for (const k of ["existing_tests", "own_check"] as const) assert.ok(CLASSES.includes(k), `${k} is a census class`);
  for (const k of ["app_in_browser", "agents_on_changed_build"] as const) assert.ok(CLASSES.includes(k), `exercised covers the census class ${k}`);
});

test("failToPassShortfall: fail-to-pass counts, the refactor path counts, everything else says what to write", () => {
  const h = (extra: Record<string, unknown>) => parseVerifyHead(f2p("p1", extra))!;
  assert.equal(failToPassShortfall(h({})), undefined, "fails at base, passes at commit");
  assert.equal(failToPassShortfall(h({ base_exit_code: 0, refactor: true })), undefined, "the refactor path: passes at both");
  assert.match(failToPassShortfall(h({ commit: undefined }))!, /no "commit"/);
  assert.match(failToPassShortfall(h({ commit: "" }))!, /no "commit"/);
  assert.match(failToPassShortfall(h({ base_commit: undefined }))!, /no "base_commit".*parent commit/);
  assert.match(failToPassShortfall(h({ base_commit: "E4F5A6B0123" }))!, /same commit/, "an abbreviated and a longer sha of one commit are the same commit");
  assert.equal(failToPassShortfall(h({ base_commit: "HEAD~1", commit: "HEAD" })), undefined, "names that are not shas compare exactly");
  assert.match(failToPassShortfall(h({ base_exit_code: undefined }))!, /no "base_exit_code"/);
  assert.match(failToPassShortfall(h({ base_exit_code: 0 }))!, /passed before the change too.*"refactor":true/);
  assert.match(failToPassShortfall(h({ refactor: true }))!, /drop "refactor"/, "a refactor claim whose check failed before is contradictory");
});

// ---------- the gate ----------

test("a passing rerun with no fail-to-pass evidence does not count, and the refusal names the entry and what is missing", (t) => {
  const { hub, room, pr, b, agree, refusal } = fixture(t);
  hub.setBoard(room.name, b.id, "verify/rerun", JSON.stringify({ proposal: pr.id, command: "npm test", cwd: "/repo", commit: "e4f5a6b", exit_code: 0, output_tail: "9 passed" }));
  assert.equal(hub.verifiedBy(room, pr), undefined);
  agree();
  assert.equal(room.state, "open");
  assert.ok(refusal().includes(VERIFY_HEAD_EXAMPLE.replace("<PROPOSAL_ID>", pr.id)), "the refusal quotes the head to write");
  assert.ok(refusal().includes(VERIFY_HEAD_RULE));
  assert.match(refusal(), /Bob's verify\/rerun does not count: it names no "base_commit"/);
  assert.ok(!/verify\/author/.test(refusal()), "the proposer's own entry is not named back");
});

test("each kind counts with fail-to-pass evidence, as does a head with no kind; the conclusion records the path", async (t) => {
  for (const kind of [...VERIFY_KINDS, undefined]) {
    await t.test(`kind ${kind ?? "absent"}`, (tt) => {
      const { hub, room, pr, b, agree } = fixture(tt);
      hub.setBoard(room.name, b.id, "verify/check", f2p(pr.id, kind ? { kind } : {}));
      assert.ok(hub.verifiedBy(room, pr));
      agree();
      assert.equal(room.state, "concluded");
      assert.deepEqual(room.conclusion?.verification, { key: "verify/check", by: "Bob", path: "fail_to_pass", base_commit: "a1b2c3d", commit: "e4f5a6b", ...(kind ? { kind } : {}) });
      const line = room.messages.find((m) => m.kind === "conclusion")!.content;
      assert.match(line, new RegExp(`Verified by Bob \\(verify/check\\)${kind ? `, kind ${kind}` : ""}: the check failed at a1b2c3d and passes at e4f5a6b\\.`));
    });
  }
});

test("the refactor path counts only with refactor:true and is named as such on the conclusion", (t) => {
  const { hub, room, pr, b, agree, refusal } = fixture(t);
  hub.setBoard(room.name, b.id, "verify/p2p", f2p(pr.id, { base_exit_code: 0 }));
  assert.equal(hub.verifiedBy(room, pr), undefined, "passing at both without the declaration is not evidence");
  assert.match(refusal(), /verify\/p2p does not count: "base_exit_code" is 0.*"refactor":true/);
  hub.setBoard(room.name, b.id, "verify/p2p", f2p(pr.id, { base_exit_code: 0, refactor: true, kind: "existing_tests" }));
  assert.ok(hub.verifiedBy(room, pr));
  agree();
  assert.equal(room.state, "concluded");
  assert.equal(room.conclusion?.verification?.path, "refactor");
  assert.match(room.messages.find((m) => m.kind === "conclusion")!.content, /on the refactor path, kind existing_tests: the check passed at a1b2c3d and at e4f5a6b; no check failed before the change\./);
});

test("every earlier rule still holds for fail-to-pass heads: author, same connection, proposal id, exit code, freshness", async (t) => {
  await t.test("the proposer's own fail-to-pass head does not count", (tt) => {
    const { hub, room, pr, a } = fixture(tt);
    hub.setBoard(room.name, a.id, "verify/self", f2p(pr.id));
    assert.equal(hub.verifiedBy(room, pr), undefined);
  });
  await t.test("a second name on the proposer's connection does not count, and the refusal says why", (tt) => {
    const { hub, room, pr, refusal } = fixture(tt);
    const alias = hub.join(room.name, "Alias", "test", {}, undefined, "session-a").participant;
    hub.setBoard(room.name, alias.id, "verify/alias", f2p(pr.id));
    assert.equal(hub.verifiedBy(room, pr), undefined);
    assert.match(refusal(), /Alias's verify\/alias does not count: it shares Alice's connection/);
  });
  await t.test("another proposal's head does not count and is not named back", (tt) => {
    const { hub, room, pr, b, refusal } = fixture(tt);
    hub.setBoard(room.name, b.id, "verify/other", f2p("prop_other"));
    assert.equal(hub.verifiedBy(room, pr), undefined);
    assert.ok(!refusal().includes("verify/other"));
  });
  await t.test("a nonzero exit_code at the proposal's commit does not count", (tt) => {
    const { hub, room, pr, b, refusal } = fixture(tt);
    hub.setBoard(room.name, b.id, "verify/red", f2p(pr.id, { exit_code: 2 }));
    assert.equal(hub.verifiedBy(room, pr), undefined);
    assert.match(refusal(), /verify\/red does not count: it reports exit_code 2/);
  });
  await t.test("a head written before the current text does not count after an amend", async (tt) => {
    const { hub, room, pr, a, b, refusal } = fixture(tt);
    hub.setBoard(room.name, b.id, "verify/early", f2p(pr.id));
    assert.ok(hub.verifiedBy(room, pr));
    await new Promise((r) => setTimeout(r, 10));
    hub.amend(room.name, a.id, pr.id, "", "Also cover the empty case.");
    assert.equal(hub.verifiedBy(room, pr), undefined);
    assert.match(refusal(), /verify\/early does not count: it was written before v2's text/);
  });
  await t.test("free text naming the proposal does not count and is named back", (tt) => {
    const { hub, room, pr, b, refusal } = fixture(tt);
    hub.setBoard(room.name, b.id, "verify/prose", `PARTIAL for ${pr.id}: could not start the hub`);
    assert.equal(hub.verifiedBy(room, pr), undefined);
    assert.match(refusal(), /verify\/prose does not count: its first line is not a JSON verify head/);
  });
  await t.test("a malformed head naming the proposal is named back with the field to fix", (tt) => {
    const { hub, room, pr, b, refusal } = fixture(tt);
    hub.setBoard(room.name, b.id, "verify/kind", f2p(pr.id, { kind: "self-check" }));
    assert.equal(hub.verifiedBy(room, pr), undefined);
    assert.match(refusal(), /verify\/kind does not count: "kind" must be one of existing_tests, own_check, exercised/);
    hub.setBoard(room.name, b.id, "verify/kind", f2p(pr.id, { base_exit_code: "1" }));
    assert.match(refusal(), /verify\/kind does not count: "base_exit_code" must be a number/);
  });
  await t.test("a .partial entry never counts and is not named back", (tt) => {
    const { hub, room, pr, b, refusal } = fixture(tt);
    hub.setBoard(room.name, b.id, "verify/area.partial", f2p(pr.id));
    assert.equal(hub.verifiedBy(room, pr), undefined);
    assert.ok(!refusal().includes("verify/area.partial"));
  });
});

test("the refusal names at most the two latest misses (blocked_by is re-sent on every wait)", async (t) => {
  const { hub, room, pr, b, refusal } = fixture(t);
  for (const k of ["one", "two", "three"]) {
    hub.setBoard(room.name, b.id, `verify/${k}`, f2p(pr.id, { base_exit_code: 0 }));
    await new Promise((r) => setTimeout(r, 5));
  }
  assert.equal((refusal().match(/does not count/g) ?? []).length, 2);
  assert.ok(refusal().includes("verify/three") && refusal().includes("verify/two") && !refusal().includes("verify/one"));
});

test("the mandatory challenge is unchanged (consensus-requires-scrutiny, owner decision): under auto, a counting head and every agree still wait for a challenge", (t) => {
  const { hub, room, pr, b, agree } = fixture(t, { challenge: "auto" });
  hub.setBoard(room.name, b.id, "verify/check", f2p(pr.id));
  assert.ok(hub.verifiedBy(room, pr));
  agree();
  assert.equal(room.state, "open");
  assert.equal(hub.challengeRequired(room), true);
});

test("executable challenges are unchanged: a plain rerun of the challenge's command answers it", (t) => {
  const { hub, room, pr, b } = fixture(t, { challenge: true });
  const c = hub.join(room.name, "Carol", "test", {}, undefined, "session-c").participant;
  hub.challenge(room.name, c.id, pr.id, '"Ship the fix as tested" fails the empty case.', true, "npx tsx empty-case.ts");
  hub.setBoard(room.name, b.id, "verify/answer", JSON.stringify({ proposal: pr.id, command: "npx tsx empty-case.ts", cwd: "/repo", exit_code: 0, output_tail: "ok" }));
  assert.equal(pr.challenges[0].status, "answered");
  assert.equal(hub.verifiedBy(room, pr), undefined, "the answer alone is not fail-to-pass evidence for the gate");
});

// ---------- where seats learn the head ----------

const HEAD_FOR_SEATS = VERIFY_HEAD_EXAMPLE.replace("<PROPOSAL_ID>", "<id>");
const LEGACY_HEAD = '"exit_code":0,"output_tail":"<last lines of real output>"}';

test("prompts and the repo SKILL.md that teach the head quote the canonical one; minimal.md stays minimal", () => {
  for (const file of ["loop.md", "recruit.md"]) {
    const text = readFileSync(join("prompts", file), "utf8");
    assert.ok(text.includes(HEAD_FOR_SEATS), `${file} quotes VERIFY_HEAD_EXAMPLE`);
    assert.ok(!text.includes(LEGACY_HEAD), `${file} no longer teaches the head without fail-to-pass fields`);
    assert.match(text, /"refactor":true/, `${file} names the refactor path`);
  }
  assert.ok(!readFileSync("prompts/minimal.md", "utf8").includes("verify/"), "minimal-prompt-hub-carries-coordination: the hub and tool descriptions carry it");
  const skill = readFileSync("skills/swarm/SKILL.md", "utf8");
  assert.ok(skill.includes(HEAD_FOR_SEATS), "the repo SKILL.md teaches the same head");
  assert.ok(!skill.includes(LEGACY_HEAD));
  // verifyHeadRefusal names at most two misses (see "the refusal names at most the two latest misses"); the docs say so.
  for (const [file, text] of [["skills/swarm/SKILL.md", skill], ["README.md", readFileSync("README.md", "utf8")]]) {
    assert.match(text, /`blocked_by` names up to the two latest entries about the proposal that do not count/, `${file} states the two-entry limit`);
    assert.doesNotMatch(text, /`blocked_by` names each entry/, `${file} does not claim every miss is named`);
  }
});

test("reviewer prompts carry the two qa-changes rules: exercise the change like a user, say what could not be verified", () => {
  for (const file of ["loop.md", "recruit.md", "verifier.md"]) {
    const text = readFileSync(join("prompts", file), "utf8");
    assert.match(text, /users would/, `${file}: exercise the changed behaviour the way its users would`);
    assert.match(text, /only rerunning|only rerun/, `${file}: not only rerunning the author's tests`);
    assert.match(text, /`--help` is not a check/, `${file}: --help is not verification`);
    assert.match(text, /could not verify|unable to verify/, `${file}: the Unable to Verify rule`);
    assert.match(text, /three failed attempts/, `${file}: when to give up on an approach`);
  }
  for (const file of ["loop.md", "recruit.md"]) assert.match(readFileSync(join("prompts", file), "utf8"), /verify\/<area>\.partial/, `${file}: nothing verified goes to .partial`);
  assert.match(readFileSync("skills/swarm/SKILL.md", "utf8"), /exercise the change the way its users would/);
});

test("tool descriptions carry the fail-to-pass head", async () => {
  const s = createSessionServer(new Hub());
  const c = new Client({ name: "c", version: "1" });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await s.server.connect(st);
  await c.connect(ct);
  const tools = (await c.listTools()).tools;
  const boardSet = JSON.stringify(tools.find((x) => x.name === "board_set")?.inputSchema);
  assert.ok(boardSet.includes(JSON.stringify(HEAD_FOR_SEATS).slice(1, -1)), "board_set's key description quotes VERIFY_HEAD_EXAMPLE");
  assert.ok(boardSet.includes(VERIFY_HEAD_RULE.replace(/"/g, '\\"')));
  const join_ = JSON.stringify(tools.find((x) => x.name === "join_room")?.inputSchema);
  assert.match(join_, /base_exit_code nonzero/);
  assert.match(join_, /refactor:true/);
  await c.close();
});
