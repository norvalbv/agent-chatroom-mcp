/**
 * A hub that dies while it is sending the room is a hub that did not answer (merge-review backlog B7, from
 * docs/self-improvement-swarm-003601-tky5.md). fetchRespawnRoom guarded the request but read the body outside its try,
 * so a connection cut after the headers threw a plain TypeError; respawnChain's room check swallowed every error that
 * was not HubUnreachable, the room read as null, and the launcher logged "not respawning: room missing" for a room that
 * was back seconds later: the same wrong line the outage fix (scripts/respawn-outage-regression.ts) removed for a
 * refused connection.
 * Run: npx tsx scripts/respawn-cut-body-regression.ts
 */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { HubUnreachable, fetchRespawnRoom, respawnChain, type RespawnRoom } from "../src/respawn.js";

const cases: [string, () => Promise<void> | void][] = [];
const test = (name: string, run: () => Promise<void> | void) => cases.push([name, run]);

const open: RespawnRoom = { state: "open", participants: [{ name: "w1", agent: "claude", role: "worker", active: false }], board: {} };
const body = JSON.stringify(open);

/** How the next /rooms/* request is answered: "cut" sends the headers and half the body, then drops the connection. */
let mode: "cut" | "ok" | "garbage" = "ok";
let asked = 0;
const server = createServer((req, res) => {
  asked++;
  if (mode === "garbage") { res.setHeader("content-type", "application/json"); res.end(body.slice(0, body.length >> 1)); return; }
  res.writeHead(200, { "content-type": "application/json", "content-length": String(Buffer.byteLength(body)) });
  if (mode === "ok") { res.end(body); return; }
  res.write(body.slice(0, body.length >> 1), () => req.socket.destroy());
});
await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;

async function chain(over: Partial<Parameters<typeof respawnChain<string>>[0]>) {
  const lines: string[] = [];
  const slept: number[] = [];
  const result = await respawnChain<string>({
    name: "w1", maxAttempts: 1, stop: () => false, room: async () => open, exitCode: () => 1, register: async () => "", run: async (name) => name,
    log: (line) => lines.push(line), sleep: async (ms) => { slept.push(ms); }, ...over,
  });
  return { result, lines, slept };
}

test("a connection cut after the headers is HubUnreachable, not a plain error", async () => {
  mode = "cut";
  await assert.rejects(fetchRespawnRoom(url, "here"), (e: Error) => {
    assert.ok(e instanceof HubUnreachable, `threw ${e.constructor.name}: ${e.message}`);
    assert.match(e.message, /cut off/);
    return true;
  });
});

test("a body that ends early but closes cleanly is the same: nothing is known about the room", async () => {
  mode = "garbage";
  await assert.rejects(fetchRespawnRoom(url, "here"), (e: Error) => e instanceof HubUnreachable || assert.fail(`threw ${e.constructor.name}: ${e.message}`));
});

test("a whole answer and a 404 still read as before", async () => {
  mode = "ok";
  assert.deepEqual(await fetchRespawnRoom(url, "here"), open);
  const none = createServer((_req, res) => { res.statusCode = 404; res.end("No such room"); });
  await new Promise<void>((done) => none.listen(0, "127.0.0.1", done));
  try {
    assert.equal(await fetchRespawnRoom(`http://127.0.0.1:${(none.address() as { port: number }).port}`, "gone"), null);
  } finally { none.close(); }
});

test("the launcher's chain waits out a hub that died mid-answer and replaces the seat when it answers", async () => {
  mode = "cut";
  asked = 0;
  const r = await chain({ room: () => { if (asked >= 2) mode = "ok"; return fetchRespawnRoom(url, "here"); } });
  assert.equal(r.result.lastName, "w1-r1", r.lines.join("\n"));
  assert.deepEqual(r.slept, [5_000, 5_000], "asked again every 5 s while the answer was cut");
  assert.ok(!r.lines.some((l) => /room missing/.test(l)), r.lines.join("\n"));
  assert.equal(r.lines.filter((l) => /hub is unreachable \(.*cut off/.test(l)).length, 1, "the log names the cut answer once");
});

test("an error the chain does not know is never reported as a missing room", async () => {
  const r = await chain({ room: async () => { throw new TypeError("terminated"); } });
  assert.equal(r.result.replaced.length, 0);
  assert.ok(!r.lines.some((l) => /room missing/.test(l)), r.lines.join("\n"));
  assert.match(r.lines.join("\n"), /w1 exited; not respawning: the room could not be read \(TypeError: terminated\)/);
});

test("a hub that answers with no such room is still final", async () => {
  const r = await chain({ room: async () => null });
  assert.match(r.lines.join("\n"), /not respawning: room missing/);
  assert.deepEqual(r.slept, []);
});

let failed = 0;
for (const [name, run] of cases) {
  try {
    await run();
    console.log(`ok   ${name}`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${name}\n     ${e instanceof Error ? e.message.split("\n").join("\n     ") : String(e)}`);
  }
}
server.close();
server.closeAllConnections();
console.log(`${cases.length - failed}/${cases.length} passed`);
process.exit(failed ? 1 : 0);
