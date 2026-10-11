/** The hub keeps an idle keep-alive connection open longer than a seat's pause between two chatroom calls. With node's
 * default (5 s) the hub closed every connection a seat had been quiet on for 5 s, and a client that reused it in the
 * same instant got "ECONNRESET: The socket connection was closed unexpectedly": 7 of 582 chatroom calls across this
 * room's seat transcripts in its first 45 minutes (swarm-003601-tky5, friction/econnreset). The call is lost and the
 * model has to notice and resend. PORT=<free port> npx tsx scripts/keepalive-regression.ts */
import assert from "node:assert/strict";
import { type ChildProcess, spawn } from "node:child_process";
import { createServer, connect, type Socket } from "node:net";

let nextPort = Number(process.env.PORT) || 0;
const freePort = () => new Promise<number>((done) => { const s = createServer(); s.listen(nextPort ? nextPort++ : 0, "127.0.0.1", () => { const p = (s.address() as { port: number }).port; s.close(() => done(p)); }); });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const port = await freePort();
const { CHATROOM_SEAT_KEY: _k, CHATROOM_HEARTBEAT_URL: _h, CHATROOM_DATA_DIR: _d, ...rest } = process.env;
const hub: ChildProcess = spawn(process.execPath, ["--import", "tsx", "src/index.ts"], { env: { ...rest, PORT: String(port), CHATROOM_INSECURE_LOCAL: "1", CHATROOM_SPAWN_DRY: "1" }, stdio: "ignore" });

/** One raw keep-alive connection, so the test sees exactly what a pooled client sees: the same socket, reused. */
function rawClient(): Promise<{ get: (path: string) => Promise<string>; closed: () => boolean; sock: Socket }> {
  return new Promise((done, fail) => {
    const sock = connect(port, "127.0.0.1");
    let buf = "";
    let closed = false;
    let waiter: ((s: string) => void) | undefined;
    sock.on("data", (d) => {
      buf += d.toString();
      const m = /\r\n\r\n/.exec(buf);
      const len = Number(/content-length: (\d+)/i.exec(buf)?.[1] ?? -1);
      if (m && len >= 0 && buf.length >= m.index + 4 + len) { const out = buf; buf = ""; waiter?.(out); }
    });
    sock.on("close", () => { closed = true; waiter?.("CLOSED"); });
    sock.on("error", () => { closed = true; });
    sock.on("connect", () => done({
      sock,
      closed: () => closed,
      get: (path) => new Promise((r) => { waiter = r; if (closed) return r("CLOSED"); sock.write(`GET ${path} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: keep-alive\r\n\r\n`); }),
    }));
    sock.on("error", fail);
  });
}

try {
  for (let i = 0; i < 150; i++) { try { await fetch(`http://127.0.0.1:${port}/`); break; } catch { await sleep(200); } }
  const c = await rawClient();
  const first = await c.get("/");
  assert.match(first, /^HTTP\/1\.1 200/, "first request served");
  const advertised = Number(/keep-alive: timeout=(\d+)/i.exec(first)?.[1] ?? 0);
  assert.ok(advertised >= 60, `the hub advertises a keep-alive of at least 60 s (got ${advertised || "none"})`);
  // a seat thinks for a few seconds between two calls: the connection must still be there
  await sleep(7_000);
  assert.equal(c.closed(), false, "a connection idle for 7 s is still open");
  const second = await c.get("/");
  assert.match(second, /^HTTP\/1\.1 200/, "and the second request on it is served");
  c.sock.destroy();
} finally {
  if (hub.exitCode === null && hub.signalCode === null) hub.kill("SIGKILL");
}
console.log("KEEPALIVE REGRESSION OK");
process.exit(0);
