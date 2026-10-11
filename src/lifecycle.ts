/**
 * Why the hub stopped, written down by the hub itself. Hub 7717 died on 2026-10-10 the second its terminal app was
 * quit; nothing handled SIGHUP and nothing wrote a line on the way out, so a seven-hour room lost its conclusion to a
 * cause that had to be dug out of the macOS system log (swarm-003601-tky5, evidence/hub-death-cause).
 *
 * In the data directory: hub-<port>.lifecycle.log (one line per start, per ignored hang-up and per exit) and
 * hub-<port>.pid (removed on a clean stop). A hub killed outright can write nothing, so the next start names it.
 * An in-memory hub (no data directory) gets the same behaviour with the lines on stderr only.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, unlinkSync, utimesSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

export interface Lifecycle {
  /** The reason the coming process.exit is for, when it is not a signal or a crash (the idle exit). */
  exiting(reason: string): void;
  /** How the previous hub on this port and data directory stopped, in words, or undefined when there was none. */
  previous?: string;
  /** When the previous hub was last known alive (its alive-stamp, or its exit line), epoch ms; undefined when unknown. */
  lastAlive?: number;
}

export function installLifecycle(opts: { port: number; dir?: string; head?: string }): Lifecycle {
  const started = Date.now();
  const logFile = opts.dir ? resolve(opts.dir, `hub-${opts.port}.lifecycle.log`) : undefined;
  const pidFile = opts.dir ? resolve(opts.dir, `hub-${opts.port}.pid`) : undefined;
  // touched every ALIVE_MS while the hub runs: a hub killed outright writes nothing, and this says when it was last alive
  const aliveFile = opts.dir ? resolve(opts.dir, `hub-${opts.port}.alive`) : undefined;
  const ALIVE_MS = Number(process.env.CHATROOM_ALIVE_MS) || 10_000;
  const line = (text: string) => {
    const entry = `${new Date().toISOString()} ${text}\n`;
    // sync, and never fatal: this runs inside signal and exit handlers, possibly with the terminal already gone
    try { if (logFile) appendFileSync(logFile, entry); } catch {}
    try { process.stderr.write(`agent-chatroom-mcp: ${text}\n`); } catch {}
  };
  // a closed terminal turns every later write to stdout/stderr into EIO; unhandled, that 'error' event is a crash
  process.stdout.on("error", () => {});
  process.stderr.on("error", () => {});

  if (opts.dir) mkdirSync(opts.dir, { recursive: true });
  // how the last hub here stopped: its own exit line if it wrote one (read before this start is logged), and when it was
  // last alive: the exit line's time, else its alive-stamp
  let previous: string | undefined;
  let lastAlive: number | undefined;
  try {
    const last = logFile && existsSync(logFile) ? readFileSync(logFile, "utf8").trimEnd().split("\n").at(-1) ?? "" : "";
    const exit = /^(\S+) exit pid=(\d+) reason=(.*?) code=/.exec(last);
    if (exit) { previous = `the last hub (pid ${exit[2]}) stopped: ${exit[3]}`; lastAlive = Date.parse(exit[1]); }
  } catch {}
  try { if (lastAlive === undefined && aliveFile && existsSync(aliveFile)) lastAlive = statSync(aliveFile).mtimeMs; } catch {}
  let ownsPidFile = !!pidFile;
  if (pidFile && existsSync(pidFile)) {
    const prevPid = readFileSync(pidFile, "utf8").trim();
    let running = false;
    try { process.kill(Number(prevPid), 0); running = true; } catch {}
    // a second hub on a port that is taken dies at listen; the pid file stays the first one's
    if (running) { ownsPidFile = false; line(`pid=${prevPid} already holds ${pidFile} and is running`); }
    else {
      line(`previous pid=${prevPid} left no exit line: it was killed outright (SIGKILL, out of memory, power loss)`);
      previous = `the last hub (pid ${prevPid}) left no exit line: it was killed outright (SIGKILL, out of memory, power loss)`;
    }
  }
  if (pidFile && ownsPidFile) writeFileSync(pidFile, `${process.pid}\n`);
  line(`start pid=${process.pid} ppid=${process.ppid} port=${opts.port} tty=${process.stdout.isTTY || process.stderr.isTTY ? "yes" : "no"}${opts.head ? ` head=${opts.head}` : ""}`);

  if (aliveFile) {
    try { writeFileSync(aliveFile, `${process.pid}\n`); } catch {}
    setInterval(() => { try { const t = new Date(); utimesSync(aliveFile, t, t); } catch {} }, ALIVE_MS).unref();
  }

  let reason: string | undefined;
  const exiting = (why: string) => { reason ??= why; };
  // the terminal this hub was started from closed: rooms outlive it
  process.on("SIGHUP", () => line(`SIGHUP ignored pid=${process.pid} (the terminal that started this hub closed; the hub keeps running, stop it with kill ${process.pid})`));
  for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => { exiting(signal); process.exit(0); });
  // the monitor sees the error and leaves node's own handling (print the stack, exit 1) as it was
  process.on("uncaughtExceptionMonitor", (error, origin) => {
    const e = error as Error;
    exiting(`${origin}: ${String(e?.message ?? e).replace(/\s+/g, " ").slice(0, 300)}`);
    try { if (logFile) appendFileSync(logFile, `${String(e?.stack ?? e)}\n`); } catch {}
  });
  process.on("exit", (code) => {
    line(`exit pid=${process.pid} reason=${reason ?? `process.exit(${code})`} code=${code} uptime_s=${Math.round((Date.now() - started) / 1000)}`);
    try { if (pidFile && ownsPidFile && readFileSync(pidFile, "utf8").trim() === String(process.pid)) unlinkSync(pidFile); } catch {}
  });
  return { exiting, ...(previous ? { previous } : {}), ...(lastAlive !== undefined && Number.isFinite(lastAlive) ? { lastAlive } : {}) };
}
