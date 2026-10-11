/** A respawn decision taken while the hub is down waits for the hub: on 2026-10-10 the hub died at 16:28:54 UTC, a seat
 * exited at 16:29:39, and the launcher logged "not respawning: room missing" for a room that was back eight minutes
 * later (board evidence/hub-death-cause, room swarm-003601-tky5-room). "room missing" is for a hub that answers and
 * has no such room. PORT=<free port> npx tsx scripts/respawn-outage-regression.ts */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import * as respawn from "../src/respawn.js";

const { respawnChain } = respawn;
const open: respawn.RespawnRoom = { state: "open", participants: [{ name: "w1", agent: "claude", role: "worker", active: false }], board: {} };
// at a commit without HubUnreachable this is a plain Error, so case 1 fails on what the launcher did then: "room missing"
const Unreachable: new (message: string) => Error = (respawn as Record<string, unknown>).HubUnreachable as typeof respawn.HubUnreachable ?? Error;
const down = () => new Unreachable("connect ECONNREFUSED");

async function chain(over: Partial<Parameters<typeof respawnChain<string>>[0]>) {
  const lines: string[] = [];
  const slept: number[] = [];
  const result = await respawnChain<string>({
    name: "w1", maxAttempts: 1, stop: () => false, room: async () => open, exitCode: () => 1, register: async () => "", run: async (name) => name,
    log: (line) => lines.push(line), sleep: async (ms) => { slept.push(ms); }, ...over,
  });
  return { result, lines, slept };
}

// 1. The hub is down for three polls, then answers: the seat is replaced, and the log says what was waited for.
let calls = 0;
let r = await chain({ room: async () => { if (++calls <= 3) throw down(); return open; } });
assert.equal(r.result.lastName, "w1-r1", r.lines.join("\n"));
assert.deepEqual(r.slept, [5_000, 5_000, 5_000], "polled every 5 s");
assert.equal(r.lines.filter((l) => /hub.*unreachable/i.test(l)).length, 1, "said once, not on every poll");
assert.ok(!r.lines.some((l) => /room missing/.test(l)));

// 2. A hub that answers and has no such room is still final, at once.
r = await chain({ room: async () => null });
assert.equal(r.result.replaced.length, 0);
assert.match(r.lines.join("\n"), /not respawning: room missing/);
assert.deepEqual(r.slept, []);

// 3. A hub that never comes back is given about ten minutes, then the reason is the hub, not the room.
calls = 0;
r = await chain({ room: async () => { calls++; throw down(); } });
assert.equal(r.result.replaced.length, 0);
assert.equal(r.slept.reduce((a, b) => a + b, 0), 600_000, "waits ten minutes in all");
assert.match(r.lines.join("\n"), /not respawning: the hub was unreachable for 10 min/);
assert.ok(!/room missing/.test(r.lines.join("\n")));
r = await chain({ unreachableWaitMs: 20_000, pollMs: 2_000, room: async () => { throw down(); } });
assert.equal(r.slept.length, 10, "both the wait and the poll interval can be set");

// 4. The launcher stopping ends the wait.
calls = 0;
r = await chain({ stop: () => calls >= 2, room: async () => { calls++; throw down(); } });
assert.equal(r.result.replaced.length, 0);
assert.equal(calls, 2);

// 5. The hub goes down between the room check and the registration: that waits too, and a refusal still ends the chain.
calls = 0;
r = await chain({ register: async () => { if (++calls <= 2) throw down(); return " note"; } });
assert.equal(r.result.lastName, "w1-r1", r.lines.join("\n"));
r = await chain({ register: async () => { throw new Error("Replacement registration failed (401)"); } });
assert.equal(r.result.replaced.length, 0);
assert.deepEqual(r.slept, []);

// 6. The launcher's room fetch tells the two apart against real sockets.
const server = createServer((req, res) => {
  if (req.url === "/rooms/here") { res.setHeader("content-type", "application/json"); res.end(JSON.stringify(open)); }
  else if (req.url === "/rooms/broken") { res.statusCode = 500; res.end("error"); }
  else { res.statusCode = 404; res.end("No such room"); }
});
await new Promise<void>((done) => server.listen(Number(process.env.PORT) || 0, "127.0.0.1", done));
const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
assert.equal((await respawn.fetchRespawnRoom(url, "here"))?.state, "open");
assert.equal(await respawn.fetchRespawnRoom(url, "gone"), null, "404: the hub answers and has no such room");
await assert.rejects(respawn.fetchRespawnRoom(url, "broken"), respawn.HubUnreachable, "a hub that answers 500 is not a missing room");
await new Promise((done) => server.close(done));
await assert.rejects(respawn.fetchRespawnRoom(url, "here"), respawn.HubUnreachable, "connection refused is an unreachable hub");
// registration: a refused connection is an unreachable hub, a refusal by the hub is not
await assert.rejects(respawn.registerRespawn(url, "here", "w1", "w1-r1", "token"), respawn.HubUnreachable);
await assert.rejects(respawn.registerRespawn(url, "here", "w1", "w1-r1", "token", async () => new Response("{}", { status: 401 })), (e: Error) => !(e instanceof respawn.HubUnreachable) && /401/.test(e.message));

console.log("RESPAWN OUTAGE REGRESSION OK");
