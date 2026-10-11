/**
 * Why the hub stopped, written down by the hub itself. Hub 7717 died on 2026-10-10 the second its terminal app was
 * quit; nothing handled SIGHUP and nothing wrote a line on the way out, so a seven-hour room lost its conclusion to a
 * cause that had to be dug out of the macOS system log (swarm-003601-tky5, evidence/hub-death-cause).
 *
 * In the data directory: hub-<port>.lifecycle.log (one line per start, per ignored hang-up and per exit) and
 * hub-<port>.pid (removed on a clean stop). A hub killed outright can write nothing, so the next start names it.
 * An in-memory hub (no data directory) gets the same behaviour with the lines on stderr only.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, utimesSync, writeFileSync } from "node:fs";
import { monitorEventLoopDelay } from "node:perf_hooks";
import { resolve } from "node:path";

export interface Lifecycle {
  /** The reason the coming process.exit is for, when it is not a signal or a crash (the idle exit). */
  exiting(reason: string): void;
  /**
   * Sample the hub's health every CHATROOM_HEALTH_MS (default 60 s; 0 = off) into hub-<port>.health.jsonl, and put the last
   * sample on the exit line. Nothing sampled the hub before a death (bugs.md telemetry 3: none was recorded for the
   * 2026-09-19 and 2026-10-10 deaths). `counts` is read at each sample: what the hub has open right now.
   */
  health(counts: () => Record<string, number>): void;
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
  let exit: RegExpExecArray | null = null;
  try {
    const last = logFile && existsSync(logFile) ? readFileSync(logFile, "utf8").trimEnd().split("\n").at(-1) ?? "" : "";
    exit = /^(\S+) exit pid=(\d+) reason=(.*?) code=/.exec(last);
    if (exit) { previous = `the last hub (pid ${exit[2]}) stopped: ${exit[3]}`; lastAlive = Date.parse(exit[1]); }
  } catch {}
  let ownsPidFile = !!pidFile;
  if (pidFile && existsSync(pidFile)) {
    const prevPid = readFileSync(pidFile, "utf8").trim();
    let running = false;
    try { process.kill(Number(prevPid), 0); running = true; } catch {}
    // a second hub on a port that is taken dies at listen; the pid file stays the first one's
    if (running) { ownsPidFile = false; line(`pid=${prevPid} already holds ${pidFile} and is running`); }
    else if (exit?.[2] !== prevPid) {
      // ...and that second hub's exit line stays the last line of the log while the first serves on. Only the hub that
      // held the port owns the pid file, so an exit line under another pid is not how the last hub stopped, and its time
      // is not when the last hub was alive: a restart notice once counted the outage from it
      if (exit) { line(`stale exit line of pid=${exit[2]} ignored: pid=${prevPid} held ${pidFile} after it (the line is from ${exit[1]})`); lastAlive = undefined; }
      line(`previous pid=${prevPid} left no exit line: it was killed outright (SIGKILL, out of memory, power loss)`);
      previous = `the last hub (pid ${prevPid}) left no exit line: it was killed outright (SIGKILL, out of memory, power loss)`;
    }
  }
  try { if (lastAlive === undefined && aliveFile && existsSync(aliveFile)) lastAlive = statSync(aliveFile).mtimeMs; } catch {}
  if (pidFile && ownsPidFile) writeFileSync(pidFile, `${process.pid}\n`);
  line(`start pid=${process.pid} ppid=${process.ppid} port=${opts.port} tty=${process.stdout.isTTY || process.stderr.isTTY ? "yes" : "no"}${opts.head ? ` head=${opts.head}` : ""}`);

  if (aliveFile) {
    try { writeFileSync(aliveFile, `${process.pid}\n`); } catch {}
    setInterval(() => { try { const t = new Date(); utimesSync(aliveFile, t, t); } catch {} }, ALIVE_MS).unref();
  }

  let reason: string | undefined;
  const exiting = (why: string) => { reason ??= why; };
  let lastHealth: Record<string, unknown> | undefined;
  const healthFile = opts.dir ? resolve(opts.dir, `hub-${opts.port}.health.jsonl`) : undefined;
  const HEALTH_MS = process.env.CHATROOM_HEALTH_MS === undefined ? 60_000 : Number(process.env.CHATROOM_HEALTH_MS);
  const health = (counts: () => Record<string, number>) => {
    if (!(HEALTH_MS > 0)) return;
    // event-loop lag over each interval: a hub that is alive but stuck shows here before it shows anywhere else
    const lag = monitorEventLoopDelay({ resolution: 20 });
    lag.enable();
    const ms = (ns: number) => Math.round(ns / 1e5) / 10;
    setInterval(() => {
      const m = process.memoryUsage();
      let c: Record<string, number> = {};
      try { c = counts(); } catch {}
      lastHealth = {
        ts: new Date().toISOString(), pid: process.pid, uptime_s: Math.round((Date.now() - started) / 1000),
        rss_mb: Math.round(m.rss / 1048576), heap_used_mb: Math.round(m.heapUsed / 1048576), heap_total_mb: Math.round(m.heapTotal / 1048576), external_mb: Math.round(m.external / 1048576),
        loop_lag_ms: { p50: ms(lag.percentile(50)), p99: ms(lag.percentile(99)), max: ms(lag.max) },
        ...c,
      };
      lag.reset();
      // one line a minute is about 300 KB a day; past 20 MB the file starts again beside a .1 copy
      try {
        if (healthFile) {
          if (existsSync(healthFile) && statSync(healthFile).size > 20 * 1048576) renameSync(healthFile, `${healthFile}.1`);
          appendFileSync(healthFile, `${JSON.stringify(lastHealth)}\n`);
        }
      } catch {}
    }, HEALTH_MS).unref();
  };
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
    // the last health sample rides on the exit line: how the hub looked just before it stopped, in the line that says why
    line(`exit pid=${process.pid} reason=${reason ?? `process.exit(${code})`} code=${code} uptime_s=${Math.round((Date.now() - started) / 1000)}${lastHealth ? ` last_health=${JSON.stringify(lastHealth)}` : ""}`);
    try { if (pidFile && ownsPidFile && readFileSync(pidFile, "utf8").trim() === String(process.pid)) unlinkSync(pidFile); } catch {}
  });
  return { exiting, health, ...(previous ? { previous } : {}), ...(lastAlive !== undefined && Number.isFinite(lastAlive) ? { lastAlive } : {}) };
}
