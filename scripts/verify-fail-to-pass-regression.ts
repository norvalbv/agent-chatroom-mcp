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

test("the census still parses exactly as recorded: 241 of 260 heads, row by row, and none carries fail-to-pass evidence", () => {
  const rows = readFileSync("bench/results/verify-practice/heads.jsonl", "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as { id: string; text: string; schema_valid: boolean });
  const drift = rows.filter((r) => (parseVerifyHead(r.text) !== undefined) !== r.schema_valid).map((r) => r.id);
  assert.deepEqual(drift, [], "parseVerifyHead must keep the paper's schema_valid count (paper/sections/results.tex, How seats check each other)");
  assert.equal(rows.filter((r) => r.schema_valid).length, 241);
  const passing = rows.map((r) => parseVerifyHead(r.text)).filter((h): h is VerifyHead => !!h && h.exit_code === 0);
  assert.equal(passing.length, 237);
  assert.equal(passing.filter((h) => !failToPassShortfall(h)).length, 0, "no census head recorded a failing-before run in its head");
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
