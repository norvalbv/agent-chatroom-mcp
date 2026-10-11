#!/usr/bin/env node
/**
 * Hub supervisor: keeps one hub running.
 *
 *   node dist/hubd.js [--port 7717] [--always]        (npm run hubd)
 *
 * Starts the hub as a child in its own session, with its output appended to logs/hub-<port>.log and its rooms in
 * CHATROOM_DATA_DIR (default <checkout>/data, as the launcher's hub), and starts it again
 * whenever it dies. Every exit is logged with its UTC time, exit code and signal. SIGHUP is ignored, so closing the
 * terminal this was started from stops nothing. The launcher token (CHATROOM_LAUNCHER_TOKEN, generated when unset) is
 * handed to the hub and written to logs/hub-<port>-token (0600), where a launcher that attaches to the hub reads it.
 *
 * Stopping: SIGTERM or SIGINT to this process stops the hub and then this process. A hub that exits with code 0 (its
 * idle exit, or SIGTERM to the hub's own PID) also ends the supervision, so a dev hub is still stopped by
 * `kill $(lsof -ti:<port> -sTCP:LISTEN)`; with --always even that is restarted and only stopping this process stops the hub.
 */
import { type ChildProcess, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { appendFileSync, mkdirSync, openSync, rmSync } from "node:fs";
import { connect } from "node:net";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { hubLogDir, hubLogFile, launcherTokenFile } from "./env.js";
import { restartDelay, writeLauncherToken } from "./hub-supervisor.js";

const self = fileURLToPath(import.meta.url);
const root = resolve(dirname(self), "..");
const argv = process.argv.slice(2);
const PORT = Number(argv.includes("--port") ? argv[argv.indexOf("--port") + 1] : (process.env.PORT ?? 7717));
const ALWAYS = argv.includes("--always");
if (!Number.isInteger(PORT) || PORT <= 0) {
  console.error("hubd: --port <number> (or PORT) is required");
  process.exit(2);
}

mkdirSync(hubLogDir(root), { recursive: true });
const logFile = hubLogFile(root, PORT);
const tokenFile = launcherTokenFile(root, PORT);
/** To the hub's own log, so the reason a hub went away sits next to its last lines; never to a terminal that may be gone. */
const log = (line: string) => { try { appendFileSync(logFile, `${new Date().toISOString()} hubd: ${line}\n`); } catch {} };

const listening = await new Promise<boolean>((done) => {
  const s = connect(PORT, "127.0.0.1").once("connect", () => { s.destroy(); done(true); }).once("error", () => done(false));
});
if (listening) {
  console.error(`hubd: something is already listening on :${PORT}; not starting a second hub`);
  process.exit(2);
}

const token = process.env.CHATROOM_LAUNCHER_TOKEN || randomBytes(16).toString("hex");
writeLauncherToken(tokenFile, token);

let hub: ChildProcess | undefined;
let stopping = false;
let delay = 0;
let timer: NodeJS.Timeout | undefined;

function finish(code: number): never {
  rmSync(tokenFile, { force: true }); // a later launcher must not read the token of a hub that is gone
  process.exit(code);
}

function start() {
  const startedAt = Date.now();
  const out = openSync(logFile, "a");
  // run the hub the way this file is being run: node on dist/index.js, or tsx on src/index.ts
  hub = spawn(process.execPath, [...process.execArgv, resolve(dirname(self), `index${extname(self)}`)], {
    // rooms on disk unless told otherwise, as the launcher's hub has them: a restart of an in-memory hub would wipe them
    env: { ...process.env, PORT: String(PORT), CHATROOM_LAUNCHER_TOKEN: token, CHATROOM_DATA_DIR: process.env.CHATROOM_DATA_DIR || resolve(root, "data") },
    detached: true, // its own session: no controlling terminal to take it down
    stdio: ["ignore", out, out],
  });
  const pid = hub.pid;
  log(`started hub pid ${pid} on :${PORT} (supervisor pid ${process.pid})`);
  hub.once("error", (e) => log(`hub could not be started: ${e.message}`));
  hub.once("close", (code, signal) => {
    hub = undefined;
    const up = Date.now() - startedAt;
    log(`hub pid ${pid} exited: code ${code}, signal ${signal}, after ${Math.round(up / 1000)} s`);
    if (stopping) finish(0);
    if (code === 0 && !ALWAYS) {
      log("the hub exited by itself with code 0 (idle exit or a deliberate stop); not restarting it (--always would)");
      finish(0);
    }
    delay = restartDelay(delay, up);
    log(`restarting the hub in ${delay} ms`);
    timer = setTimeout(start, delay);
  });
}

function stop(signal: NodeJS.Signals) {
  if (stopping) return;
  stopping = true;
  log(`${signal} received; stopping the hub`);
  clearTimeout(timer);
  if (!hub) finish(0);
  hub.kill("SIGTERM");
  setTimeout(() => { hub?.kill("SIGKILL"); }, 5_000).unref();
}
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
process.on("SIGHUP", () => log("SIGHUP ignored (the terminal closed); the hub keeps running"));

console.log(`hubd: supervising the hub on :${PORT}; log ${logFile}; stop with kill ${process.pid}`);
start();
