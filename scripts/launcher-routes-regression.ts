/** The launcher's room-create call (the run's quorum and verification policy, fixed before any seat joins) carries the
 * launcher token and the hub accepts it, as d493cbce made it do for resources and the run deadline. A supervised hub (hubd) has a launcher token and no
 * human token; those three routes took only the human token, so on it the launcher could not seed --resources (it
 * exits 2: "403 controller authority closed"), the group rooms started without the run's quorum, and the run's end was
 * never announced (swarm-003601-tky5, seat 5's rehearsal #266). The workaround, CHATROOM_INSECURE_LOCAL=1, opens every
 * human route to any local process. PORT=<free port> npx tsx scripts/launcher-routes-regression.ts */
import assert from "node:assert/strict";
import { type ChildProcess, spawn } from "node:child_process";
import { createServer } from "node:net";
import * as env from "../src/env.js";

let nextPort = Number(process.env.PORT) || 0;
const freePort = () => new Promise<number>((done) => { const s = createServer(); s.listen(nextPort ? nextPort++ : 0, "127.0.0.1", () => { const p = (s.address() as { port: number }).port; s.close(() => done(p)); }); });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const port = await freePort();
const url = `http://127.0.0.1:${port}`;
const { CHATROOM_SEAT_KEY: _k, CHATROOM_HEARTBEAT_URL: _h, CHATROOM_DATA_DIR: _d, CHATROOM_HUMAN_TOKEN: _ht, CHATROOM_INSECURE_LOCAL: _il, CHATROOM_LAUNCHER_TOKEN: _lt, ...rest } = process.env;
// as hubd starts it: a launcher token, no human token, no loopback opt-in
const hub: ChildProcess = spawn(process.execPath, ["--import", "tsx", "src/index.ts"], { env: { ...rest, PORT: String(port), CHATROOM_SPAWN_DRY: "1", CHATROOM_LAUNCHER_TOKEN: "launch-secret" }, stdio: "ignore" });
const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  fetch(`${url}${path}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });

try {
  for (let i = 0; i < 150; i++) { try { await fetch(url); break; } catch { await sleep(200); } }
  // the launcher builds its headers in one place, so every call it makes carries what it holds
  assert.equal(typeof (env as Record<string, unknown>).launcherHeaders, "function", "env.ts exports launcherHeaders");
  assert.deepEqual(env.launcherHeaders("launch-secret", undefined), { "content-type": "application/json", "x-chatroom-launcher-token": "launch-secret" });
  assert.deepEqual(env.launcherHeaders(undefined, "human"), { "content-type": "application/json", "x-chatroom-token": "human" });
  const as = env.launcherHeaders("launch-secret", undefined);
  // src/swarm.ts sends no hand-built token headers any more: every launcher call goes through launcherHeaders
  const { readFileSync } = await import("node:fs");
  assert.equal((readFileSync("src/swarm.ts", "utf8").match(/"x-chatroom-token"/g) ?? []).length, 0, "the launcher builds no token header by hand");

  // the three launcher routes take the launcher token
  const created = await post("/rooms/run-1-room/create", { topic: "t", quorum: "supermajority", expected_participants: 4 }, as);
  assert.equal(created.status, 201, `room create with the launcher token: ${created.status} ${await created.clone().text()}`);
  assert.equal(((await created.json()) as { quorum?: string }).quorum, "supermajority", "with the run's policy");
  const seeded = await post("/rooms/run-1-room/resources", { entries: [{ key: "resource/budget", text: "kit/netbudget.py" }] }, as);
  assert.equal(seeded.status, 200, `resources with the launcher token: ${seeded.status}`);
  const deadline = await post("/rooms/run-1-room/deadline", { at: new Date(Date.now() + 3_600_000).toISOString() }, as);
  assert.equal(deadline.status, 200, `deadline with the launcher token: ${deadline.status}`);

  // a wrong token, or none, is refused as before
  const wrong = await post("/rooms/run-2-room/create", { topic: "t" }, { "x-chatroom-launcher-token": "guess" });
  assert.ok(wrong.status === 401 || wrong.status === 403, `a wrong launcher token is refused (${wrong.status})`);
  assert.equal((await post("/rooms/run-2-room/create", { topic: "t" })).status, 403, "no token: refused");
  // and the launcher token opens nothing else: the human routes stay the human's
  assert.equal((await post("/rooms/run-1-room/close", { reason: "x" }, as)).status, 403, "close is not a launcher route");
  assert.equal((await post("/rooms/run-1-room/messages", { name: "benji", content: "hi" }, as)).status, 403, "speaking as a human is not a launcher route");
} finally {
  if (hub.exitCode === null && hub.signalCode === null) hub.kill("SIGKILL");
}
console.log("LAUNCHER ROUTES REGRESSION OK");
process.exit(0);
