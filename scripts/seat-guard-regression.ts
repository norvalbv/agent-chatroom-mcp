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
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
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
  // what a seat writes next once pkill is refused (review/seat-guard-and-room-idle)
  "for p in $(pgrep -f fetch); do kill $p; done",
  "PID=$(pgrep -f fetch_trades.py); kill -9 $PID",
  "pgrep -f fetch_trades.py | while read p; do kill \"$p\"; done",
  "for p in `ps aux | grep fetch_trades | awk '{print $2}'`; do kill $p; done",
  "lsof -ti:7810 | xargs kill; pgrep -f fetch | xargs kill",
  // quotes that do run: a shell's -c script, eval, a substitution inside double quotes
  "bash -lc \"sleep 1; pkill -f fetch_trades.py\"",
  "eval 'pkill -f fetch_trades.py'",
  "kill \"$(pgrep -f fetch_trades.py)\"",
  "nohup sh -c 'pkill -f fetch_trades.py; python3 fetch_trades.py' &",
]) {
  const reason = guard(cmd);
  assert.ok(reason, `refused: ${cmd}`);
  assert.ok(reason.includes(SEAT_PROCS) && /\bstop\b/.test(reason), `names the replacement: ${reason}`);
}
assert.ok(guard("pkill -f fetch_trades.py")!.includes(`stop fetch_trades.py`), "the replacement carries the seat's own pattern");
assert.ok(guard("pkill -9 -f \"crypto/fetch.py markets\"; sleep 1")!.includes(`stop "crypto/fetch.py markets"`), "quoted, as most were typed");

// A seat's dev hub must stop when asked: --always revives its listener after a deliberate stop.
for (const cmd of [
  'node dist/hubd.js --always --port 47881',
  'CHATROOM_INSECURE_LOCAL=1 node dist/hubd.js --port 47881 --always',
  'cd /work && node ./dist/hubd.js --always &',
  'nohup node dist/hubd.js --always > /tmp/hub.log 2>&1 &',
  'bash -lc "node dist/hubd.js --always --port 47881"',
  'node "/tmp/work tree/dist/hubd.js" --always',
  'npx tsx src/hubd.ts --always --port 47881',
]) assert.match(guard(cmd) ?? '', /--always/, `persistent test hub refused: ${cmd}`);
for (const cmd of [
  'node dist/hubd.js --port 47881',
  'node another-program.js --always',
  'echo "node dist/hubd.js --always"',
  'git commit -m "stop node dist/hubd.js --always in seats"',
  "cat > fixture.txt <<'EOF'\nnode dist/hubd.js --always\nEOF",
]) assert.equal(guard(cmd), null, `not a persistent test-hub launch: ${cmd}`);

// 3. Not a kill by pattern: the word in a message, a search, a file being written; a kill by PID or by a PID file.
for (const cmd of [
  "git commit -m \"guard: refuse pkill in a seat's shell\"",
  "grep -c pkill data/room.jsonl",
  "echo 'never use pkill or killall'",
  // quoted text is not a command, even with a ; or | inside it (the verifier's probes)
  "git commit -m \"guard: refuse pkill; killall too\"",
  "echo \"x; pkill y\"",
  "echo 'stop it with: ps aux | grep fetch | xargs kill'",
  "python3 -c 'print(\"Stop: pkill -f code/watchdog.sh\")'",
  "cat > README.md <<'EOF'\nStop it with: pkill -f code/watchdog.sh\nEOF",
  "kill $(cat /tmp/my.pid)",
  "kill -TERM $PID",
  "kill 999999",
  "npm run build && node dist/index.js",
  "pgrep -fl fetch_trades.py",
  // by port, in both forms: how this project's own rules say to stop a private hub
  "kill $(lsof -ti:7810 -sTCP:LISTEN)",
  "lsof -ti:7810 -sTCP:LISTEN | xargs kill",
  "cd /x && lsof -ti :7810 -sTCP:LISTEN | xargs kill -9",
  // a look by name beside a kill by PID file is not a kill by name
  "pgrep -fl fetch_trades.py; kill $(cat fetch.pid)",
  "kill $(cat fetch.pid); sleep 1; pgrep -fl fetch_trades.py || echo stopped",
  "pgrep -F fetch.pid && kill $(<fetch.pid)",
]) assert.equal(guard(cmd), null, `allowed: ${cmd}`);
assert.equal(guard("pkill -f x", A, "Read"), null, "only Bash");
assert.equal(guard("pkill -f x", {}), null, "a shell that is not a seat's is left alone");
assert.equal(spawnSync(process.execPath, [SEAT_GUARD_HOOK], { input: "not json", env: { ...base, ...A }, encoding: "utf8" }).status, 0, "garbage in still exits 0");

//    A refusal is posted to the hub as a step, so the room's record can count them; a pass posts nothing, and a
//    dead hub does not hold the refusal up.
{
  const seen: { seat_key: string; tool: string; detail: string }[] = [];
  const hub = createServer((req, res) => {
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", () => { seen.push(JSON.parse(body)); res.end("{}"); });
  });
  await new Promise<void>((r) => hub.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${(hub.address() as AddressInfo).port}/heartbeat`;
  const run = (command: string, heartbeat: string) => new Promise<string>((done) => {
    const c = spawn(process.execPath, [SEAT_GUARD_HOOK], { env: { ...base, ...A, CHATROOM_HEARTBEAT_URL: heartbeat }, stdio: ["pipe", "pipe", "ignore"] });
    let out = "";
    c.stdout.on("data", (d) => (out += d));
    c.on("close", () => done(out));
    c.stdin.end(JSON.stringify({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command } }));
  });
  assert.ok(await run("pkill -f fetch_trades.py", url));
  const persistent = 'node dist/hubd.js --always --port 47881';
  assert.ok(await run(persistent, url));
  assert.equal(await run("ls", url), "");
  assert.deepEqual(seen, ["pkill -f fetch_trades.py", persistent].map(command => ({ seat_key: A.CHATROOM_SEAT_KEY, tool: "seat-guard", detail: `refused: ${command}` })));
  hub.close();
  const t0 = Date.now();
  assert.ok(await run("pkill -f fetch_trades.py", "http://127.0.0.1:9/heartbeat"), "refused with the hub down");
  assert.ok(Date.now() - t0 < 4_000, "and promptly");
}

// 4. Two seats, one file name (the incident). Each seat's processes inherit its key, detached or not.
const dir = mkdtempSync(join(tmpdir(), "seat-guard-"));
// a name of this run's own: other seats on this machine run a fetch_trades.py too, which is the point of the guard
const NAME = `fetch_trades_${process.pid}.py`;
const script = join(dir, `${NAME}.mjs`);
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
const stopped = procs(["stop", NAME], A);
assert.equal(stopped.status, 0, stopped.stderr);
await new Promise((r) => setTimeout(r, 500));
assert.ok(!alive(a1) && !alive(a2), "its own processes are stopped");
assert.ok(alive(b1), "the other seat's process of the same name survives (it died three times in swarm-094251-5y46)");
assert.ok(alive(plain), "an untagged process survives");
assert.match(stopped.stdout, /stopped 2/);
assert.match(stopped.stdout, /left 2 .*not started by this seat/, "says what it matched and left alone");

//    nothing of its own matches: exit 1, nothing touched. No seat key: refuses outright.
const none = procs(["stop", NAME], A);
assert.equal(none.status, 1);
assert.ok(alive(b1));
assert.equal(procs(["stop", NAME], {}).status, 2, "no seat key, no pattern stop");
assert.ok(alive(b1) && alive(plain));

console.log("SEAT GUARD OK");
