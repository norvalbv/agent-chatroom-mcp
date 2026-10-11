/** A launcher asked to --respawn asks the hub, at launch, whether it will accept a replacement, instead of inferring it
 * from holding a token. Hub 7717 was started with no CHATROOM_LAUNCHER_TOKEN and answers every replacement with 503;
 * MAIN/logs/hub-7717-token is a file left by an earlier hub. Two rooms found out when the first seat died: the
 * Polymarket room at 16:37 UTC on 2026-10-10, and swarm-003601-tky5 at 00:57 UTC on 2026-10-11 ("Not respawning
 * claude-opus-5-5-4"). PORT=<first of two free ports> npx tsx scripts/respawn-probe-regression.ts */
import assert from "node:assert/strict";
import { type ChildProcess, spawn } from "node:child_process";
import { createServer } from "node:net";
import * as respawn from "../src/respawn.js";

let nextPort = Number(process.env.PORT) || 0;
const freePort = () => new Promise<number>((done) => { const s = createServer(); s.listen(nextPort ? nextPort++ : 0, "127.0.0.1", () => { const p = (s.address() as { port: number }).port; s.close(() => done(p)); }); });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const procs: ChildProcess[] = [];
async function hub(token?: string): Promise<string> {
  const port = await freePort();
  const { CHATROOM_SEAT_KEY: _k, CHATROOM_HEARTBEAT_URL: _h, CHATROOM_DATA_DIR: _d, CHATROOM_LAUNCHER_TOKEN: _t, ...rest } = process.env;
  procs.push(spawn(process.execPath, ["--import", "tsx", "src/index.ts"], { env: { ...rest, PORT: String(port), CHATROOM_INSECURE_LOCAL: "1", CHATROOM_SPAWN_DRY: "1", ...(token ? { CHATROOM_LAUNCHER_TOKEN: token } : {}) }, stdio: "ignore" }));
  const url = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 150; i++) { try { await fetch(url); return url; } catch { await sleep(200); } }
  throw new Error("hub did not start");
}

try {
  assert.equal(typeof (respawn as Record<string, unknown>).respawnProbe, "function", "respawn.ts exports respawnProbe");
  const probe = respawn.respawnProbe;
  // a hub started with no launcher token (hub 7717 today): no token can work, whatever file the launcher found
  const bare = await hub();
  assert.match((await probe(bare, "from-a-stale-file")) ?? "", /WILL NOT WORK.*no launcher token.*restart/s, "a hub with no token is named, with what to do");
  assert.match((await probe(bare, undefined)) ?? "", /WILL NOT WORK/);
  // a hub with a token
  const keyed = await hub("right");
  assert.equal(await probe(keyed, "right"), null, "the hub's own token: respawn will work, nothing to say");
  assert.match((await probe(keyed, "wrong")) ?? "", /WILL NOT WORK.*does not accept this launcher's token/s);
  assert.match((await probe(keyed, undefined)) ?? "", /WILL NOT WORK.*no CHATROOM_LAUNCHER_TOKEN/s);
  // the probe leaves nothing behind
  const rooms = (await (await fetch(`${keyed}/rooms`)).json()) as unknown[] | { rooms?: unknown[] };
  assert.equal((Array.isArray(rooms) ? rooms : rooms.rooms ?? []).length, 0, "the probe creates no room");
  // a hub that does not answer is not a verdict
  assert.equal(await probe("http://127.0.0.1:1", "t"), null, "an unreachable hub says nothing about its token");
} finally {
  for (const p of procs) if (p.exitCode === null && p.signalCode === null) p.kill("SIGKILL");
}
console.log("RESPAWN PROBE REGRESSION OK");
process.exit(0);
