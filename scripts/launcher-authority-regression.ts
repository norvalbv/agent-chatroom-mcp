/** The launcher's own calls to a hub (seed --resources, post the run deadline) were taken only on the human token or the
 * loopback opt-in, so a hub started the way kit/HUB.md says (npm run hubd: a launcher token, no human token, no
 * CHATROOM_INSECURE_LOCAL) refused the resources with 403 and the launcher exited before any seat started (dress
 * rehearsal, swarm-003601-tky5 #266). The launcher token is the authority for what the launcher does.
 * PORT=<first of free ports> npx tsx scripts/launcher-authority-regression.ts */
import assert from "node:assert/strict";
import { type ChildProcess, spawn } from "node:child_process";
import { createServer } from "node:net";
import { seedResources } from "../src/resources.js";

let nextPort = Number(process.env.PORT) || 0;
const freePort = () => new Promise<number>((done) => { const s = createServer(); s.listen(nextPort ? nextPort++ : 0, "127.0.0.1", () => { const p = (s.address() as { port: number }).port; s.close(() => done(p)); }); });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const procs: ChildProcess[] = [];
async function hub(token?: string): Promise<string> {
  const port = await freePort();
  const { CHATROOM_SEAT_KEY: _k, CHATROOM_HEARTBEAT_URL: _h, CHATROOM_DATA_DIR: _d, CHATROOM_LAUNCHER_TOKEN: _t, CHATROOM_HUMAN_TOKEN: _u, CHATROOM_INSECURE_LOCAL: _i, ...rest } = process.env;
  procs.push(spawn(process.execPath, ["--import", "tsx", "src/index.ts"], { env: { ...rest, PORT: String(port), CHATROOM_SPAWN_DRY: "1", ...(token ? { CHATROOM_LAUNCHER_TOKEN: token } : {}) }, stdio: "ignore" }));
  const url = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 150; i++) { try { await fetch(url); return url; } catch { await sleep(200); } }
  throw new Error("hub did not start");
}
const entries = [{ key: "resource/x", text: "x is at /tmp/x" }];
const post = (url: string, path: string, body: unknown, headers: Record<string, string> = {}) =>
  fetch(`${url}${path}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });

try {
  const url = await hub("launch-secret");
  // what the dress rehearsal hit: the launcher, holding the hub's launcher token, seeds resources and posts the deadline
  const lines = await seedResources(url, ["r1"], entries, { launcherToken: "launch-secret" }).catch((e) => [String(e)]);
  assert.match(lines.join("\n"), /r1: 1 resource held until the room is created/, `the launcher token seeds resources: ${lines.join(" ")}`);
  const deadline = await post(url, "/rooms/r1/deadline", { at: new Date(Date.now() + 3600_000).toISOString() }, { "x-chatroom-launcher-token": "launch-secret" });
  assert.ok(deadline.ok, `the launcher token posts the run deadline (${deadline.status})`);
  // and nothing else gets in with it
  assert.equal((await post(url, "/rooms/r1/resources", { entries }, { "x-chatroom-launcher-token": "wrong" })).ok, false, "a wrong launcher token is refused");
  assert.equal((await post(url, "/rooms/r1/resources", { entries })).ok, false, "no token is refused");
  assert.equal((await post(url, "/rooms/r1/close", {}, { "x-chatroom-launcher-token": "launch-secret" })).ok, false, "the launcher token is not the human's: it cannot close a room");
  // a hub with no launcher token takes no launcher header at all
  const bare = await hub();
  assert.equal((await post(bare, "/rooms/r1/resources", { entries }, { "x-chatroom-launcher-token": "" })).ok, false, "an empty token matches nothing");
} finally {
  for (const p of procs) if (p.exitCode === null && p.signalCode === null) p.kill("SIGKILL");
}
console.log("LAUNCHER AUTHORITY REGRESSION OK");
process.exit(0);
