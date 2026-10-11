/**
 * Before a new build serves a shared hub's rooms: does it start on that hub's data, keep serving it, and start AGAIN
 * after it has written what it writes, plain and under its supervisor? (swarm-180216-182a, evidence/deploy-replay-check:
 * a one-boot check on a copy of hub 7717's data passed, and missed that the build's health file, written into the data
 * dir, crashed every later start in replay, so hubd would have restarted 7717 into the same crash every 30 s.)
 *
 *   npm run build && npx tsx scripts/deploy-check.ts --data <the hub's data dir> [--port 7846] [--run-s 5]
 *
 * Works on a copy (the source dir is only read). Boot 1 and boot 2 are plain `node dist/index.js`, each run for
 * --run-s with health sampled every 500 ms, then stopped with SIGTERM; boot 3 is `node dist/hubd.js --always`, whose
 * hub is then killed by PID once so the supervisor restarts it. After each start every room log is read back over
 * HTTP. Prints what each boot did, which files the build wrote or changed, and exits 1 on the first failure.
 */
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const argv = process.argv.slice(2);
const opt = (name: string, dflt?: string) => (argv.includes(`--${name}`) ? argv[argv.indexOf(`--${name}`) + 1] : dflt);
const SRC = opt("data");
const PORT = Number(opt("port", "7846"));
const RUN_S = Number(opt("run-s", "5"));
const root = resolve(process.cwd());
if (!SRC || !existsSync(SRC)) { console.error("deploy-check: --data <dir> is required and must exist"); process.exit(2); }
if (!existsSync(join(root, "dist", "index.js"))) { console.error("deploy-check: run `npm run build` first (no dist/index.js here)"); process.exit(2); }
if ([7717, 7719, 7750].includes(PORT)) { console.error(`deploy-check: port ${PORT} is a live hub's; pick another`); process.exit(2); }

const work = mkdtempSync(join(tmpdir(), "deploy-check-"));
const data = join(work, "data");
cpSync(SRC, data, { recursive: true });
const URL_ = `http://127.0.0.1:${PORT}`;
const env = { ...process.env, PORT: String(PORT), CHATROOM_DATA_DIR: data, CHATROOM_SPAWN_DRY: "1", CHATROOM_INSECURE_LOCAL: "1", CHATROOM_HEALTH_MS: "500", CHATROOM_LOG_DIR: join(work, "spawn-logs") };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const files = () => Object.fromEntries(readdirSync(data).filter((f) => statSync(join(data, f)).isFile()).map((f) => [f, createHash("sha256").update(readFileSync(join(data, f))).digest("hex")]));
const before = files();
const rooms = Object.keys(before).filter((f) => f.endsWith(".jsonl") && !f.startsWith("hub-")).map((f) => f.slice(0, -".jsonl".length));
let failed = false;
const fail = (why: string) => { failed = true; console.log(`FAIL ${why}`); };
const listening = () => (spawnSync("lsof", ["-ti", `:${PORT}`, "-sTCP:LISTEN"], { encoding: "utf8" }).stdout ?? "").trim().split("\n").filter(Boolean).map(Number);
if (listening().length) { console.error(`deploy-check: something already listens on :${PORT}`); process.exit(2); }

async function up(proc: ChildProcess | undefined, what: string, ms = 90_000): Promise<boolean> {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (proc && proc.exitCode !== null) { fail(`${what}: exited with code ${proc.exitCode} before answering`); return false; }
    try { if ((await fetch(`${URL_}/`, { signal: AbortSignal.timeout(3000) })).ok) { console.log(`${what}: answering after ${((Date.now() - t0) / 1000).toFixed(1)} s`); return true; } } catch {}
    await sleep(500);
  }
  fail(`${what}: not answering after ${ms / 1000} s`);
  return false;
}
async function readBack(what: string) {
  let bad = 0;
  for (const r of rooms) {
    const res = await fetch(`${URL_}/rooms/${encodeURIComponent(r)}`, { signal: AbortSignal.timeout(30_000) }).catch(() => undefined);
    if (!res || res.status !== 200) bad++;
  }
  if (bad) fail(`${what}: ${bad} of ${rooms.length} room logs did not read back`);
  else console.log(`${what}: all ${rooms.length} room logs read back`);
}
async function stays(proc: ChildProcess, what: string) {
  await sleep(RUN_S * 1000);
  if (proc.exitCode !== null) fail(`${what}: exited with code ${proc.exitCode} while serving`);
  else console.log(`${what}: still serving after ${RUN_S} s`);
}
async function stop(proc: ChildProcess, what: string) {
  proc.kill("SIGTERM");
  for (let i = 0; i < 40 && proc.exitCode === null && proc.signalCode === null; i++) await sleep(250);
  if (proc.exitCode === null && proc.signalCode === null) { proc.kill("SIGKILL"); fail(`${what}: did not stop on SIGTERM`); }
}
try {
  for (const n of [1, 2]) {
    const what = `boot ${n} (node dist/index.js)`;
    const hub = spawn(process.execPath, ["dist/index.js"], { cwd: root, env, stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    hub.stderr?.on("data", (d) => { err += String(d); });
    if (await up(hub, what)) { await readBack(what); await stays(hub, what); }
    await stop(hub, what);
    const crash = err.split("\n").find((l) => /unhandled|TypeError|Cannot read|Error:/.test(l));
    if (crash) fail(`${what}: its log says "${crash.slice(0, 200)}"`);
    if (failed) break;
  }
  if (!failed) {
    const what = "boot 3 (node dist/hubd.js --always)";
    const sup = spawn(process.execPath, ["dist/hubd.js", "--port", String(PORT), "--always"], { cwd: root, env, stdio: "ignore" });
    if (await up(undefined, what)) {
      const [pid] = listening();
      process.kill(pid!, "SIGKILL"); // a crash, as far as the supervisor can tell
      console.log(`${what}: killed the hub (pid ${pid}); the supervisor should start it again`);
      await sleep(1000);
      if (await up(undefined, `${what}, after the kill`)) await readBack(`${what}, after the kill`);
    }
    sup.kill("SIGTERM");
    for (let i = 0; i < 40 && listening().length; i++) await sleep(250);
    if (listening().length) fail(`${what}: the hub is still listening after SIGTERM to the supervisor`);
  }
  const after = files();
  const added = Object.keys(after).filter((f) => !(f in before));
  const changed = Object.keys(after).filter((f) => f in before && after[f] !== before[f]);
  const parseErrors = Object.keys(after).filter((f) => f.endsWith(".jsonl")).filter((f) => readFileSync(join(data, f), "utf8").split("\n").filter(Boolean).some((l) => { try { JSON.parse(l); return false; } catch { return true; } }));
  console.log(`files the build added to the data dir: ${added.join(", ") || "none"}`);
  console.log(`files it changed: ${changed.length} (${changed.slice(0, 8).join(", ")}${changed.length > 8 ? ", ..." : ""})`);
  if (parseErrors.length) fail(`unparseable lines in ${parseErrors.join(", ")}`);
} finally {
  for (const pid of listening()) { try { process.kill(pid, "SIGKILL"); } catch {} }
  rmSync(work, { recursive: true, force: true });
}
console.log(failed ? "DEPLOY CHECK FAILED" : "DEPLOY CHECK OK");
process.exit(failed ? 1 : 0);
