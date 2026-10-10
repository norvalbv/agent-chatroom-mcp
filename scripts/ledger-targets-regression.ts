/** The work ledger counts distinct targets, not the first 120 characters of them: npx tsx scripts/ledger-targets-regression.ts
 * In swarm-082539-kns2 every seat's worktree path was 114 characters, and src/hub/work.ts deduped on text.slice(0, 120):
 * every edit under scripts/ was one target, and every `cd "<worktree>"; ...` shell call was one target, so a seat with
 * ~35 shell calls over 3 files showed "run 10, edit 2" in the ledger, the evidence line and run metrics. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { countWork } from "../src/hub/work.ts";
import type { Participant, WorkClass } from "../src/hub/types.ts";

const WT = "/Users/someone-else/Desktop/Personal and learning/agent-chatroom-mcp/.swarm-worktrees/swarm-082539-kns2/claude-opus-5-5-4";
assert.ok(WT.length >= 114, "as long as this run's worktree paths");
const seat = () => ({ id: "p_x", name: "x" }) as unknown as Participant;
type Counted = ReturnType<typeof countWork>;
const keyOf = (c: Counted) => (c && typeof c === "object" ? c.key : c);
const targetOf = (c: Counted) => (c && typeof c === "object" ? c.target : c);

test("edits of different files under one long worktree are different targets", () => {
  const p = seat();
  for (const f of ["scripts/a-regression.ts", "scripts/measure/b.ts", "src/seat-targets.ts"]) countWork(p, "edit", `${WT}/${f}`);
  assert.equal(p.work?.edit, 3);
});

test("shell calls behind the same long cd prefix are different targets; a repeat is not", () => {
  const p = seat();
  for (const c of ["grep -n foo src/hub.ts", "npm run build", "git log --oneline -3", "npm run build"]) countWork(p, "run", `cd "${WT}"; ${c}`);
  assert.equal(p.work?.run, 3);
});

test("web counts hosts, as before", () => {
  const p = seat();
  countWork(p, "web", "curl https://arxiv.org/abs/2510.22954");
  countWork(p, "web", "curl https://arxiv.org/abs/2604.18005");
  assert.equal(p.work?.web, 1);
});

test("the persisted target is short and names what was touched; replaying its key reproduces the count", () => {
  const p = seat();
  const events: { cls: WorkClass; target: string; key?: string }[] = [];
  for (const [cls, d] of [["edit", `${WT}/scripts/a-regression.ts`], ["edit", `${WT}/scripts/measure/b.ts`], ["run", `cd "${WT}"; npm run build`], ["run", `cd "${WT}"; git status`]] as const) {
    const c = countWork(p, cls, d);
    assert.ok(c !== undefined);
    const target = targetOf(c)!;
    assert.ok(target.length <= 120, `persisted target is at most 120 chars: ${target.length}`);
    events.push({ cls, target, key: keyOf(c) });
  }
  assert.match(events[0].target, /a-regression\.ts$/, "a long path keeps its file name");
  assert.match(events[2].target, /^npm run build/, "a shell call drops its cd prefix");
  const replayed = seat();
  for (const e of events) countWork(replayed, e.cls, e.target, e.key);
  assert.deepEqual(replayed.work, p.work);
});

test("an old log (target only, no key) replays as it was counted", () => {
  const p = seat();
  countWork(p, "run", "ls");
  countWork(p, "run", "ls");
  countWork(p, "run", "pwd");
  assert.equal(p.work?.run, 2);
});
