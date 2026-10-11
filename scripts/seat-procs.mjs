#!/usr/bin/env node
// A seat's own processes: list them, or stop the ones matching a pattern, and never anyone else's.
//   node scripts/seat-procs.mjs list              pid, memory, running time and command of everything this seat started
//   node scripts/seat-procs.mjs stop <pattern>    SIGTERM this seat's processes whose command line matches (as pkill -f would)
//   node scripts/seat-procs.mjs stop -9 <pattern> the same with SIGKILL
// Seats share one machine and often one directory, and two of them pick the same file name (swarm-094251-5y46:
// `pkill -f fetch_trades.py` from one seat killed another's script three times). What tells their processes apart is
// the CHATROOM_SEAT_KEY the launcher puts in each seat's env (src/env.ts seatBeat): every process a seat starts
// inherits it, and keeps it after nohup or a closed shell hands the process to PID 1. `ps eww` shows it for this
// user's processes, except Apple's own binaries (/bin/sh, /bin/sleep: the system hides their env), so a bare shell
// loop is not found here: keep its PID (`... & echo $! > x.pid`) and stop it with `kill $(cat x.pid)`.
// Exit: 0 done, 1 nothing of this seat's matched, 2 usage or no seat key.
import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

const KEY_RE = /(?:^|\s)CHATROOM_SEAT_KEY=(\S+)/;

function ps(args) {
  const r = spawnSync("ps", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 5_000 });
  return r.status === 0 || r.stdout ? r.stdout.split("\n") : [];
}

/** The seat key in a process's env: a string, or null when it has none or the system hides its env. */
export function seatKeyOf(pid) {
  return KEY_RE.exec(ps(["eww", "-o", "command=", "-p", String(pid)]).join(" "))?.[1] ?? null;
}

/** Every process of this user: { pid, ppid, rssKb, etime, command, key }, key as in seatKeyOf. */
export function processTable() {
  const keys = new Map();
  for (const line of ps(["eww", "-Ao", "pid=,command="])) {
    const m = /^\s*(\d+)\s+(.*)$/.exec(line);
    if (m) keys.set(Number(m[1]), KEY_RE.exec(m[2])?.[1] ?? null);
  }
  const table = [];
  for (const line of ps(["-Ao", "pid=,ppid=,rss=,etime=,command="])) {
    const m = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/.exec(line);
    if (m) table.push({ pid: Number(m[1]), ppid: Number(m[2]), rssKb: Number(m[3]), etime: m[4], command: m[5], key: keys.get(Number(m[1])) ?? null });
  }
  return table;
}

/** This process and its ancestors: the seat itself and the shell it is typing in are never a target. */
function lineage(table) {
  const parent = new Map(table.map((p) => [p.pid, p.ppid]));
  const mine = new Set();
  for (let pid = process.pid; pid > 1 && !mine.has(pid); pid = parent.get(pid) ?? 0) mine.add(pid);
  return mine;
}

/** What this seat started and may stop: tagged with its key, and not the seat or the shell asking. */
export function ownProcesses(key, table = processTable()) {
  const self = lineage(table);
  return table.filter((p) => p.key === key && !self.has(p.pid));
}

function matcher(pattern) {
  try { const re = new RegExp(pattern); return (s) => re.test(s); } catch { return (s) => s.includes(pattern); }
}

const row = (p) => `${String(p.pid).padStart(7)}  ${String(Math.round(p.rssKb / 1024)).padStart(6)} MB  ${p.etime.padStart(11)}  ${p.command.slice(0, 160)}`;

function main(argv) {
  const key = process.env.CHATROOM_SEAT_KEY;
  const [cmd, ...rest] = argv;
  if (!key) { console.error("seat-procs: no CHATROOM_SEAT_KEY in this shell, so it cannot tell which processes are yours. Stop a process by its PID."); return 2; }
  if (cmd === "list" && !rest.length) {
    const own = ownProcesses(key);
    console.log(own.length ? own.map(row).join("\n") : "no running process was started by this seat");
    return 0;
  }
  const signal = rest[0] === "-9" ? "SIGKILL" : "SIGTERM";
  const pattern = rest[0] === "-9" ? rest[1] : rest[0];
  if (cmd !== "stop" || !pattern || rest.length > (signal === "SIGKILL" ? 2 : 1)) { console.error("usage: seat-procs.mjs list | stop [-9] <pattern>"); return 2; }
  const table = processTable();
  const match = matcher(pattern);
  const self = lineage(table);
  const hits = table.filter((p) => match(p.command) && !self.has(p.pid));
  const own = hits.filter((p) => p.key === key);
  const stopped = own.filter((p) => { try { process.kill(p.pid, signal); return true; } catch { return false; } });
  if (stopped.length) console.log(`stopped ${stopped.length} (${signal}):\n${stopped.map(row).join("\n")}`);
  else console.log(`nothing this seat started matches ${JSON.stringify(pattern)}`);
  const left = hits.length - own.length;
  if (left) console.log(`left ${left} matching process${left === 1 ? "" : "es"} not started by this seat (another seat's, or untagged: a shell loop is stopped by its PID)`);
  return stopped.length ? 0 : 1;
}

const direct = (() => { try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; } })();
if (direct) process.exit(main(process.argv.slice(2)));
