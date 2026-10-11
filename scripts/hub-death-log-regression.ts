/** A hub outlives the terminal it was started from, and says why whenever it does stop. Hub 7717 died at 16:28:54 UTC
 * on 2026-10-10, the second its terminal app was quit, 70 minutes before a seven-hour room's deadline; its log held
 * start-up lines only, so the cause had to be dug out of the macOS system log (swarm-003601-tky5,
 * evidence/hub-death-cause). PORT=<first of your range> npx tsx scripts/hub-death-log-regression.ts */
import assert from "node:assert/strict";
import { type ChildProcess, spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

let nextPort = Number(process.env.PORT) || 0;
const freePort = () => new Promise<number>((done) => { const s = createServer(); s.listen(nextPort ? nextPort++ : 0, "127.0.0.1", () => { const p = (s.address() as { port: number }).port; s.close(() => done(p)); }); });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const up = async (port: number) => { try { await fetch(`http://127.0.0.1:${port}/`); return true; } catch { return false; } };
const waitUp = async (port: number) => { for (let i = 0; i < 150; i++) { if (await up(port)) return true; await sleep(200); } return false; };
const waitDown = async (port: number, ms: number) => { for (let t = 0; t < ms; t += 200) { if (!(await up(port))) return true; await sleep(200); } return false; };
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const hubEnv = (port: number, dir: string) => {
  const { CHATROOM_SEAT_KEY: _k, CHATROOM_HEARTBEAT_URL: _h, ...rest } = process.env;
  return { ...rest, PORT: String(port), CHATROOM_DATA_DIR: dir, CHATROOM_INSECURE_LOCAL: "1", CHATROOM_SPAWN_DRY: "1", CHATROOM_LOG_DIR: join(dir, "spawned") };
};
const lifecycle = (dir: string, port: number) => { const f = join(dir, `hub-${port}.lifecycle.log`); return existsSync(f) ? readFileSync(f, "utf8") : ""; };
const pidOf = (dir: string, port: number) => Number(readFileSync(join(dir, `hub-${port}.pid`), "utf8").trim());

// A terminal that closes: python's pty.fork gives the hub a controlling terminal of its own; closing the master end
// is what quitting the terminal app does, and the kernel then sends SIGHUP to the hub.
const PTY = `
import os, pty, sys, time
pid, fd = pty.fork()
if pid == 0:
    os.execvp(sys.argv[1], sys.argv[1:])
sys.stdin.readline()
os.close(fd)
time.sleep(1)
`;

const started: number[] = [];
const procs: ChildProcess[] = [];
try {
  // (a) the terminal closes: the hub keeps serving, and its lifecycle log says it was told to hang up
  const dirA = mkdtempSync(join(tmpdir(), "hub-death-a-"));
  const portA = await freePort();
  const term = spawn("python3", ["-I", "-c", PTY, "npx", "tsx", "src/index.ts"], { env: hubEnv(portA, dirA), stdio: ["pipe", "ignore", "inherit"] });
  procs.push(term);
  assert.equal(await waitUp(portA), true, "the hub starts under a terminal");
  assert.equal(existsSync(join(dirA, `hub-${portA}.pid`)), true, "the hub writes hub-<port>.pid in its data directory");
  const pidA = pidOf(dirA, portA);
  started.push(pidA);
  assert.match(lifecycle(dirA, portA), new RegExp(`start pid=${pidA} `), "start is logged with the pid");
  term.stdin!.write("close\n");
  await new Promise((r) => term.on("exit", r));
  await sleep(1500);
  assert.equal(alive(pidA) && (await up(portA)), true, "the hub is still serving after its terminal closed");
  assert.match(lifecycle(dirA, portA), /SIGHUP ignored/, "the hang-up is recorded");
  // ...and it still answers after writing to the terminal that is gone (a boot line on stderr would otherwise throw EIO)
  await fetch(`http://127.0.0.1:${portA}/rooms`);
  await sleep(300);
  assert.equal(alive(pidA), true);

  // (b) asked to stop: it stops, the log names the signal, the pid file goes
  process.kill(pidA, "SIGTERM");
  assert.equal(await waitDown(portA, 5000), true, "SIGTERM stops it");
  await sleep(300);
  assert.match(lifecycle(dirA, portA), new RegExp(`exit pid=${pidA} reason=SIGTERM`), "the exit line names the signal");
  assert.equal(existsSync(join(dirA, `hub-${portA}.pid`)), false, "a hub that stopped cleanly removes its pid file");

  // (c) killed outright: nothing can be written then, so the next start says the last run left no exit line
  const dirC = mkdtempSync(join(tmpdir(), "hub-death-c-"));
  const portC = await freePort();
  const boot = () => { const c = spawn("npx", ["tsx", "src/index.ts"], { env: hubEnv(portC, dirC), stdio: "ignore" }); procs.push(c); return c; };
  boot();
  assert.equal(await waitUp(portC), true);
  const pidC = pidOf(dirC, portC);
  started.push(pidC);
  process.kill(pidC, "SIGKILL");
  assert.equal(await waitDown(portC, 5000), true);
  boot();
  assert.equal(await waitUp(portC), true);
  started.push(pidOf(dirC, portC));
  assert.match(lifecycle(dirC, portC), new RegExp(`previous pid=${pidC} left no exit line`), "an unlogged death is named at the next start");

  // (d) a crash: the error is in the log before the process goes, and node's own crash handling is unchanged (exit 1)
  const dirD = mkdtempSync(join(tmpdir(), "hub-death-d-"));
  const crash = spawn("npx", ["tsx", "-e", `import { installLifecycle } from "./src/lifecycle.ts"; installLifecycle({ port: 1, dir: ${JSON.stringify(dirD)} }); setTimeout(() => { throw new Error("boom from the regression"); }, 200);`], { stdio: "ignore" });
  procs.push(crash);
  const code = await new Promise((r) => crash.on("exit", r));
  assert.equal(code, 1, "a crash still exits 1");
  assert.match(lifecycle(dirD, 1), /reason=uncaughtException: boom from the regression code=1/, "a crash is logged with its message");
  assert.match(lifecycle(dirD, 1), /at Timeout/, "and with its stack");
} finally {
  for (const pid of started) if (alive(pid)) process.kill(pid, "SIGKILL");
  for (const p of procs) if (p.exitCode === null && p.signalCode === null) p.kill("SIGKILL");
}
console.log("HUB DEATH LOG REGRESSION OK");
process.exit(0);
