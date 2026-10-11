/**
 * Flaw 5 (swarm-094251-5y46): one seat's pkill killed another seat's process.
 * Six seats shared one machine and one cwd. A seat restarted its fetcher with `pkill -f fetch_trades.py` four times;
 * another seat's script of the same name died three times with no traceback. The room ran 34 pkill commands (17 with a
 * bare file name) against 5 kills by PID, and 26 of them came after the seat had promised in chat to stop: the
 * command line was the only handle a seat had on what it started. Now: a launched claude seat's --settings carries a
 * second PreToolUse hook on Bash (scripts/seat-guard-hook.mjs) that refuses a kill by pattern and a kill of a PID
 * another seat started, and names the replacement (scripts/seat-procs.mjs: list or stop this seat's own processes,
 * found by the CHATROOM_SEAT_KEY they inherit).
 * No hub. Starts four short node processes and stops them by PID.
 * Run: npx tsx scripts/seat-guard-regression.ts
 */
import assert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { claudeArgs } from "../src/claude-args.js";
import { HEARTBEAT_HOOK, SEAT_GUARD_HOOK, SEAT_PROCS, heartbeatHookSettings } from "../src/env.js";

const A = { CHATROOM_SEAT_KEY: "guard-key-A" };
const B = { CHATROOM_SEAT_KEY: "guard-key-B" };
const base = { PATH: process.env.PATH ?? "" };
const guard = (command: string, env: Record<string, string> = A, tool = "Bash") => {
  const r = spawnSync(process.execPath, [SEAT_GUARD_HOOK], { input: JSON.stringify({ hook_event_name: "PreToolUse", tool_name: tool, tool_input: { command } }), env: { ...base, ...env }, encoding: "utf8", timeout: 10_000 });
  assert.equal(r.status, 0, `the guard exits 0 (${command}): ${r.stderr}`);
  if (!r.stdout) return null;
  const out = JSON.parse(r.stdout).hookSpecificOutput;
  assert.equal(out.hookEventName, "PreToolUse");
  assert.equal(out.permissionDecision, "deny");
  return String(out.permissionDecisionReason);
};
const procs = (args: string[], env: Record<string, string>) =>
  spawnSync(process.execPath, [SEAT_PROCS, ...args], { env: { ...base, ...env }, encoding: "utf8", timeout: 10_000 });

// 1. The launcher's seat settings: the heartbeat hook is untouched and first; the guard follows it on Bash only, and
//    only before the call. CHATROOM_SEAT_GUARD=0 on the launcher leaves it out.
{
  const s = JSON.parse(heartbeatHookSettings());
  assert.equal(s.hooks.PreToolUse[0].hooks[0].command, `node ${JSON.stringify(HEARTBEAT_HOOK)}`);
  assert.equal(s.hooks.PreToolUse[1].matcher, "Bash");
  assert.equal(s.hooks.PreToolUse[1].hooks[0].command, `node ${JSON.stringify(SEAT_GUARD_HOOK)}`);
  assert.equal(s.hooks.PostToolUse.length, 1, "nothing to guard after the call");
  const args = claudeArgs({ mcpJson: "/m.json", tools: ["Bash"], full: true, settings: heartbeatHookSettings() });
  assert.equal(JSON.parse(args[args.indexOf("--settings") + 1]).hooks.PreToolUse.length, 2, "kept under --claude-full");
  process.env.CHATROOM_SEAT_GUARD = "0";
  assert.equal(JSON.parse(heartbeatHookSettings()).hooks.PreToolUse.length, 1, "CHATROOM_SEAT_GUARD=0 turns it off");
  delete process.env.CHATROOM_SEAT_GUARD;
}

// 2. A kill by pattern is refused, in the forms the room used and the ones a seat would reach for next. The refusal
//    names the replacement, with the pattern the seat just typed.
for (const cmd of [
  "pkill -f fetch_trades.py",
  "pkill -f fetch_loop.sh; pkill -f fetch_trades.py; sleep 1; python3 - <<'EOF'\nprint(1)\nEOF",
  "ls /x; pkill -f \"explore.py\" ; time python3 crypto/fetch.py",
  "until grep -q done /tmp/l.log; do sleep 5; done; pkill -f \"crypto/fetch.py\"",
  "killall python3",
  "sudo killall -9 node",
  "kill $(pgrep -f fetch_trades.py)",
  "kill -9 `pgrep -f fetch_trades.py`",
  "pgrep -f fetch_trades.py | xargs kill",
  "ps aux | grep fetch_trades | grep -v grep | awk '{print $2}' | xargs kill -9",
  "sh -c 'pkill -f fetch_trades.py'",
  "cd /x && pkill -9 -f fetch_trades.py",
]) {
  const reason = guard(cmd);
  assert.ok(reason, `refused: ${cmd}`);
  assert.ok(reason.includes(SEAT_PROCS) && /\bstop\b/.test(reason), `names the replacement: ${reason}`);
}
assert.ok(guard("pkill -f fetch_trades.py")!.includes(`stop fetch_trades.py`), "the replacement carries the seat's own pattern");

// 3. Not a kill by pattern: the word in a message, a search, a file being written; a kill by PID or by a PID file.
for (const cmd of [
  "git commit -m \"guard: refuse pkill in a seat's shell\"",
  "grep -c pkill data/room.jsonl",
  "echo 'never use pkill or killall'",
  "cat > README.md <<'EOF'\nStop it with: pkill -f code/watchdog.sh\nEOF",
  "kill $(cat /tmp/my.pid)",
  "kill -TERM $PID",
  "kill 999999",
  "npm run build && node dist/index.js",
  "pgrep -fl fetch_trades.py",
]) assert.equal(guard(cmd), null, `allowed: ${cmd}`);
assert.equal(guard("pkill -f x", A, "Read"), null, "only Bash");
assert.equal(guard("pkill -f x", {}), null, "a shell that is not a seat's is left alone");
assert.equal(spawnSync(process.execPath, [SEAT_GUARD_HOOK], { input: "not json", env: { ...base, ...A }, encoding: "utf8" }).status, 0, "garbage in still exits 0");

// 4. Two seats, one file name (the incident). Each seat's processes inherit its key, detached or not.
const dir = mkdtempSync(join(tmpdir(), "seat-guard-"));
const script = join(dir, "fetch_trades.py.mjs");
writeFileSync(script, "setTimeout(() => {}, 60_000);\n");
const started: ChildProcess[] = [];
const start = (env: Record<string, string>) => {
  const c = spawn(process.execPath, [script], { env: { ...base, ...env }, stdio: "ignore", detached: true });
  c.unref();
  started.push(c);
  return c.pid!;
};
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
process.on("exit", () => { for (const c of started) try { process.kill(c.pid!); } catch { /* already stopped */ } });
const [a1, a2, b1, plain] = [start(A), start(A), start(B), start({})];
await new Promise((r) => setTimeout(r, 300));

//    list: this seat's processes and nobody else's.
const listed = procs(["list"], A);
assert.equal(listed.status, 0, listed.stderr);
for (const pid of [a1, a2]) assert.match(listed.stdout, new RegExp(`^\\s*${pid}\\b`, "m"), "lists its own");
for (const pid of [b1, plain]) assert.doesNotMatch(listed.stdout, new RegExp(`^\\s*${pid}\\b`, "m"), "not another seat's, not an untagged one");

//    kill by PID: its own goes through; another seat's is refused and says whose it is not.
assert.equal(guard(`kill ${a1}`), null, "its own PID");
const other = guard(`kill -9 ${a1} ${b1}`);
assert.ok(other && other.includes(String(b1)) && !other.includes(String(a1)), `another seat's PID is refused by number: ${other}`);
assert.equal(guard(`kill ${plain}`), null, "a process no seat started is not this guard's business");

//    stop <pattern>: the same habit as pkill -f, scoped. Seat A's two die; seat B's same-named one and the untagged one live.
const stopped = procs(["stop", "fetch_trades.py"], A);
assert.equal(stopped.status, 0, stopped.stderr);
await new Promise((r) => setTimeout(r, 500));
assert.ok(!alive(a1) && !alive(a2), "its own processes are stopped");
assert.ok(alive(b1), "the other seat's process of the same name survives (it died three times in swarm-094251-5y46)");
assert.ok(alive(plain), "an untagged process survives");
assert.match(stopped.stdout, /stopped 2/);
assert.match(stopped.stdout, /left 2 .*not started by this seat/, "says what it matched and left alone");

//    nothing of its own matches: exit 1, nothing touched. No seat key: refuses outright.
const none = procs(["stop", "fetch_trades.py"], A);
assert.equal(none.status, 1);
assert.ok(alive(b1));
assert.equal(procs(["stop", "fetch_trades.py"], {}).status, 2, "no seat key, no pattern stop");
assert.ok(alive(b1) && alive(plain));

console.log("SEAT GUARD OK");
