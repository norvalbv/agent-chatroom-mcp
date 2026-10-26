/**
 * A seat's commit that skips the repository's hooks is put on the room's record, and a run can turn the hooks copy off
 * (evidence/seat-hooks-cost-and-bypass; evidence-pack items 11 and 13, "guard slips"). Run: npx tsx scripts/hook-bypass-regression.ts
 *
 * On this machine chatroom seats ran 152 git commands with --no-verify in 24 sessions (39 in devkit-correctness-swarm),
 * one of them disclosed; nothing in the hub recorded any. The guard does not refuse a bypass (whether to is the
 * owner's policy): it lets the command run, tells the seat it was recorded, and posts it to the hub as a step.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { readFileSync } from "node:fs";
import { SEAT_GUARD_HOOK } from "../src/env.js";

const posted: { tool?: string; detail?: string }[] = [];
const server = createServer((req, res) => { let b = ""; req.on("data", (d) => (b += d)); req.on("end", () => { try { posted.push(JSON.parse(b)); } catch {} res.end("{}"); }); });
await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/heartbeat`;
const guard = (command: string) => {
  const r = spawnSync(process.execPath, [SEAT_GUARD_HOOK], { input: JSON.stringify({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command } }), env: { PATH: process.env.PATH ?? "", CHATROOM_SEAT_KEY: "bypass-key", CHATROOM_HEARTBEAT_URL: url }, encoding: "utf8", timeout: 10_000 });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout ? JSON.parse(r.stdout).hookSpecificOutput : null;
};

let failed = 0;
const check = async (name: string, fn: () => void | Promise<void>) => {
  try { await fn(); console.log(`PASS ${name}`); }
  catch (e) { failed++; console.error(`FAIL ${name}: ${e instanceof Error ? e.message.split("\n")[0] : e}`); }
};
for (const cmd of [
  'git add -A && git commit -q --no-verify -m "wip"',
  'git commit -qn -m "wip"',
  "HUSKY=0 git commit -m x",
  "git -c core.hooksPath=/dev/null commit -m x",
  "git push --no-verify origin HEAD",
]) {
  await check(`a hook bypass runs, is recorded and the seat is told: ${cmd}`, async () => {
    posted.length = 0;
    const out = guard(cmd);
    assert.ok(out, "the guard answers");
    assert.notEqual(out.permissionDecision, "deny", "not refused");
    assert.match(String(out.additionalContext), /skips the repository's commit hooks/);
    await new Promise((r) => setTimeout(r, 200));
    assert.ok(posted.some((p) => p.tool === "seat-guard" && /^bypassed hooks: /.test(p.detail ?? "")), `posted: ${JSON.stringify(posted)}`);
  });
}
for (const cmd of ['git commit -m "do not use --no-verify here"', "git log -n 3", "git commit -m x", "git notes add -m 'no-verify'"]) {
  await check(`no bypass, nothing said: ${cmd}`, () => {
    assert.equal(guard(cmd), null);
  });
}
await check("the launcher has --seat-hooks off, and the spawner honours it", () => {
  const swarm = readFileSync("src/swarm.ts", "utf8");
  assert.match(swarm, /const SEAT_HOOKS_OFF = flag\("seat-hooks"\) === "off"/);
  assert.match(swarm, /SEAT_HOOKS_OFF \? \{ CHATROOM_SEAT_HOOKS: "off" \}/, "the hub it starts tells its recruits");
  // a write recruit's worktree, and the hooks it carries, are fitted out in src/spawner/worktrees.ts (decision/machine-load)
  assert.match(readFileSync("src/spawner/worktrees.ts", "utf8"), /process\.env\.CHATROOM_SEAT_HOOKS === "off"/);
});
server.close();
if (failed) { console.error(`HOOK BYPASS: ${failed} failed`); process.exitCode = 1; } else console.log("HOOK BYPASS OK");
