/** A supervised hub comes back by itself: on 2026-10-10 hub 7717 died with its terminal at 16:28:54 UTC, nothing
 * restarted it for 8 minutes, and a launcher that had attached to it held no launcher token, so every respawn was
 * refused (board evidence/hub-death-cause, room swarm-003601-tky5-room). src/hubd.ts keeps a hub running, logs every
 * exit and shares the launcher token through a 0600 file. PORT=<free port> npx tsx scripts/hub-supervisor-regression.ts */
import assert from "node:assert/strict";
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import * as sup from "../src/hub-supervisor.js";

// PORT=<first of your range> makes the hubs take PORT, PORT+1 (seats on a shared machine keep to their own ports)
let nextPort = Number(process.env.PORT) || 0;
const freePort = () => new Promise<number>((done) => { const s = createServer(); s.listen(nextPort ? nextPort++ : 0, "127.0.0.1", () => { const p = (s.address() as { port: number }).port; s.close(() => done(p)); }); });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const until = async (ok: () => boolean | Promise<boolean>, ms: number) => { for (const end = Date.now() + ms; Date.now() < end; await sleep(150)) if (await ok()) return true; return false; };
/** The hub's PID the way an operator finds it. */
const listener = (port: number) => Number(spawnSync("lsof", [`-ti:${port}`, "-sTCP:LISTEN"], { encoding: "utf8" }).stdout.trim().split("\n")[0]) || 0;
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const answers = (port: number) => fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(1_000) }).then(() => true, () => false);

// ---- the pure parts ----
const dir = mkdtempSync(resolve(tmpdir(), "hubd-"));
const logs = resolve(dir, "logs");
const env = { CHATROOM_HUBD_LOG_DIR: logs };
assert.equal(sup.launcherTokenFile("/repo", 7717, {}), "/repo/logs/hub-7717-token", "next to the hub's log, the name the main checkout already uses");
assert.equal(sup.launcherTokenFile("/repo", 7901, env), resolve(logs, "hub-7901-token"));
assert.equal(sup.readLauncherToken("/repo", 7901, env), undefined, "no file: no token");
// a first death restarts after a second; dying again within the minute doubles the wait up to 30 s; a minute up resets it
assert.equal(sup.restartDelay(0, 500), 1_000);
assert.equal(sup.restartDelay(1_000, 2_000), 2_000);
assert.equal(sup.restartDelay(16_000, 2_000), 30_000);
assert.equal(sup.restartDelay(30_000, 2_000), 30_000);
assert.equal(sup.restartDelay(30_000, 61_000), 1_000);
// --respawn without a token is said at launch, not seven hours later when the first seat dies
assert.equal(sup.respawnTokenProblem(false, undefined, 7717), null, "no --respawn: nothing to warn about");
assert.equal(sup.respawnTokenProblem(true, "t", 7717), null);
assert.match(sup.respawnTokenProblem(true, undefined, 7717) ?? "", /--respawn.*CHATROOM_LAUNCHER_TOKEN/s);

// ---- a real supervisor, a real hub ----
const { CHATROOM_SEAT_KEY: _k, CHATROOM_HEARTBEAT_URL: _h, CHATROOM_LAUNCHER_TOKEN: _t, CHATROOM_IDLE_EXIT_MIN: _i, ...rest } = process.env;
const started: ChildProcess[] = [];
function supervisor(port: number, args: string[] = []) {
  const child = spawn(process.execPath, ["--import", "tsx", "src/hubd.ts", "--port", String(port), ...args], {
    env: { ...rest, ...env, CHATROOM_DATA_DIR: resolve(dir, `data-${port}`), CHATROOM_INSECURE_LOCAL: "1", CHATROOM_SPAWN_DRY: "1", CHATROOM_LOG_DIR: resolve(dir, "spawned") },
    stdio: "ignore",
  });
  started.push(child);
  return child;
}
const register = (port: number, room: string, token: string) =>
  fetch(`http://127.0.0.1:${port}/rooms/${room}/replacements`, { method: "POST", headers: { "content-type": "application/json", "x-chatroom-launcher-token": token }, body: JSON.stringify({ replacement_of: "nobody", name: "nobody-r1" }) }).then((r) => r.status);

const hubPids: number[] = [];
try {
  const port = await freePort();
  const d = supervisor(port);
  assert.ok(await until(() => answers(port), 20_000), "the supervised hub listens");
  const first = listener(port); hubPids.push(first);
  assert.ok(first && first !== d.pid, "the hub is the supervisor's child, not the supervisor");
  // its own session: the terminal that started the supervisor cannot take the hub with it
  assert.equal(spawnSync("ps", ["-o", "tty=", "-p", String(first)], { encoding: "utf8" }).stdout.trim().replace(/^\?+$/, ""), "", "the hub has no controlling terminal");
  assert.equal(Number(spawnSync("ps", ["-o", "pgid=", "-p", String(first)], { encoding: "utf8" }).stdout.trim()), first, "the hub leads its own process group");

  // the launcher token: generated, handed to the hub, and readable by this user only
  const file = sup.launcherTokenFile(process.cwd(), port, env);
  const token = sup.readLauncherToken(process.cwd(), port, env);
  assert.match(token ?? "", /^[0-9a-f]{32,}$/, "a token is generated when none is set");
  assert.equal(statSync(file).mode & 0o777, 0o600, "the token file is 0600");
  await fetch(`http://127.0.0.1:${port}/rooms/kept/create`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ topic: "survives a restart" }) });
  assert.equal(await register(port, "kept", "wrong"), 401, "the hub asks for the launcher token");
  assert.notEqual(await register(port, "kept", token!), 401, "and takes the one in the file");

  // the hub is killed outright: it is listening again within seconds, as a new process, with the room and the token intact
  const killedAt = Date.now();
  process.kill(first, "SIGKILL");
  assert.ok(await until(async () => { const p = listener(port); return p !== 0 && p !== first && await answers(port); }, 10_000), "a killed hub is listening again within 10 s");
  const second = listener(port); hubPids.push(second);
  console.log(`hub back ${Date.now() - killedAt} ms after SIGKILL (pid ${first} -> ${second})`);
  const room = await fetch(`http://127.0.0.1:${port}/rooms/kept`).then((r) => r.json()) as { topic?: string };
  assert.equal(room.topic, "survives a restart", "the room is still there");
  assert.notEqual(await register(port, "kept", token!), 401, "the restarted hub takes the same token");
  const log = readFileSync(resolve(logs, `hub-${port}.log`), "utf8");
  assert.match(log, new RegExp(`\\d{4}-\\d\\d-\\d\\dT[\\d:.]+Z hubd: hub pid ${first} exited: code null, signal SIGKILL`), "the exit is logged with UTC time, code and signal");

  // SIGHUP (a closing terminal) stops neither the supervisor nor, for longer than a restart, the hub
  process.kill(d.pid!, "SIGHUP");
  await sleep(1_500);
  assert.ok(d.exitCode === null && d.signalCode === null, "SIGHUP does not stop the supervisor");
  assert.equal(listener(port), second, "nor its hub");
  process.kill(second, "SIGHUP");
  await sleep(500);
  assert.ok(await until(async () => listener(port) !== 0 && await answers(port), 10_000), "a hub sent SIGHUP is listening within 10 s (ignored, or restarted)");
  const third = listener(port); hubPids.push(third);

  // a hub that exits cleanly (its idle exit, or `kill <pid from lsof>`, both exit 0) ends the supervision: a dev hub stays stoppable by PID
  process.kill(third, "SIGTERM");
  assert.ok(await until(() => d.exitCode !== null, 10_000), "the supervisor ends when the hub exits with code 0");
  assert.equal(await answers(port), false, "and nothing is restarted");
  assert.equal(existsSync(file), false, "the token file goes with the hub, so a later launcher does not read a dead token");

  // --always (the operator's hub): even a clean exit is restarted; stopping the supervisor stops both. A token given in the environment is the one written.
  const port2 = await freePort();
  rest.CHATROOM_LAUNCHER_TOKEN = "given-by-the-operator";
  const a = supervisor(port2, ["--always"]);
  assert.ok(await until(() => answers(port2), 20_000));
  const h1 = listener(port2); hubPids.push(h1);
  assert.equal(sup.readLauncherToken(process.cwd(), port2, env), "given-by-the-operator");
  process.kill(h1, "SIGTERM");
  assert.ok(await until(async () => { const p = listener(port2); return p !== 0 && p !== h1 && await answers(port2); }, 10_000), "--always restarts a hub that exited 0");
  const h2 = listener(port2); hubPids.push(h2);
  process.kill(a.pid!, "SIGTERM");
  assert.ok(await until(() => a.exitCode !== null, 10_000), "SIGTERM stops the supervisor");
  assert.ok(await until(() => !alive(h2), 5_000), "and its hub");
  assert.equal(existsSync(sup.launcherTokenFile(process.cwd(), port2, env)), false);

  // a port something already listens on is refused rather than fought over
  const port3 = await freePort();
  const holder = createServer().listen(port3, "127.0.0.1");
  const refused = supervisor(port3);
  assert.ok(await until(() => refused.exitCode !== null, 10_000), "a supervisor on a busy port exits");
  assert.equal(refused.exitCode, 2);
  holder.close();
} finally {
  // only what this test started, by PID: a supervisor told to stop takes its hub with it
  for (const c of started) if (c.exitCode === null && c.signalCode === null) c.kill("SIGTERM");
  await until(() => hubPids.every((pid) => !alive(pid)), 6_000);
}
console.log("HUB SUPERVISOR REGRESSION OK");
process.exit(0);
