/**
 * The launcher notices seats that never reached their room (evidence-pack item 11, bugs.md 2; claim/launcher-bugs).
 * Run: npx tsx scripts/join-check-regression.ts
 *
 * swarm-100737-qx7g: the hub refused every MCP connection, the launcher created the room anyway and five seats worked
 * alone in one checkout. Checked against a real hub over HTTP: seats that joined, one that never did, one that left.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { readFileSync } from "node:fs";

const freePort = () => new Promise<number>((done) => { const s = createServer(); s.listen(0, "127.0.0.1", () => { const { port } = s.address() as { port: number }; s.close(() => done(port)); }); });
const PORT = process.env.PORT ? Number(process.env.PORT) : await freePort();
const URL_ = `http://127.0.0.1:${PORT}`;
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("CHATROOM_")));
const hub = spawn(process.execPath, ["--import", "tsx", "src/index.ts"], { env: { ...env, PORT: String(PORT), CHATROOM_SPAWN_DRY: "1", CHATROOM_INSECURE_LOCAL: "1", CHATROOM_HUMAN_TOKEN: "t" }, stdio: "ignore" });
process.on("exit", () => hub.kill());
for (let i = 0; i < 60; i++) { try { await fetch(`${URL_}/`); break; } catch { await new Promise((r) => setTimeout(r, 250)); } }

/** One MCP session that joins `room` as `name` (and optionally leaves), over the same HTTP endpoint a seat uses. */
async function seat(room: string, name: string, leave = false) {
  const headers: Record<string, string> = { "content-type": "application/json", accept: "application/json, text/event-stream" };
  const call = async (body: unknown) => {
    const r = await fetch(`${URL_}/mcp`, { method: "POST", headers, body: JSON.stringify(body) });
    const sid = r.headers.get("mcp-session-id");
    if (sid) headers["mcp-session-id"] = sid;
    return r.text();
  };
  await call({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name, version: "1" } } });
  await call({ jsonrpc: "2.0", method: "notifications/initialized" });
  const joined = await call({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "join_room", arguments: { room, name, agent: "claude" } } });
  assert.match(joined, /participant_id/, `${name} joined`);
  if (leave) await call({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "leave_room", arguments: { room, reason: "done: nothing left on the board for this seat to do" } } });
}

let failed = 0;
const check = async (name: string, fn: () => Promise<void>) => {
  try { await fn(); console.log(`PASS ${name}`); }
  catch (e) { failed++; console.error(`FAIL ${name}: ${e instanceof Error ? e.message.split("\n")[0] : e}`); }
};

await check("a seat that never joined is named; one that joined, or joined and left, is not", async () => {
  const { checkJoined, roomNames, joinLines } = await import("../src/join-check.js");
  await seat("jc-room", "seat-1");
  await seat("jc-room", "seat-2", true);
  const launched = [{ name: "seat-1", room: "jc-room" }, { name: "seat-2", room: "jc-room" }, { name: "seat-3", room: "jc-room" }, { name: "verifier", room: "jc-room" }];
  const c = await checkJoined(launched, roomNames(URL_));
  assert.deepEqual(c.missing.map((s: { name: string }) => s.name), ["seat-3", "verifier"]);
  assert.equal(c.none, false);
  assert.match(joinLines(c, 180).join("\n"), /2 seat\(s\) had not joined 180 s after launch: seat-3 \(jc-room\), verifier \(jc-room\)/);
});
await check("when no seat arrived the check says the hub is not accepting connections", async () => {
  const { checkJoined, roomNames, joinLines } = await import("../src/join-check.js");
  await seat("jc-empty", "someone-else");
  const c = await checkJoined([{ name: "seat-1", room: "jc-empty" }, { name: "verifier", room: "jc-empty" }], roomNames(URL_));
  assert.equal(c.none, true);
  assert.match(joinLines(c, 180)[0], /NO SEAT JOINED its room within 180 s \(seat-1, verifier\)/);
});
await check("a room the hub never created is a room nobody joined; a hub that cannot be asked is unknown", async () => {
  const { checkJoined, roomNames } = await import("../src/join-check.js");
  const c = await checkJoined([{ name: "seat-1", room: "jc-no-such-room" }], roomNames(URL_));
  assert.deepEqual(c, { missing: [{ name: "seat-1", room: "jc-no-such-room" }], unknown: [], none: true });
  const down = await checkJoined([{ name: "seat-1", room: "jc-room" }], roomNames("http://127.0.0.1:9"));
  assert.deepEqual(down, { missing: [], unknown: ["jc-room"], none: false });
});
await check("the launcher runs the check on the seats it started", async () => {
  const src = readFileSync("src/swarm.ts", "utf8");
  assert.match(src, /checkJoined\(launched/, "swarm.ts calls checkJoined with its launched seats");
  assert.match(src, /launched\.push\(\{ name, room \}\)/, "worker seats are recorded as launched");
  // seats that cannot connect exit within seconds (dev run swarm-183014-ukd6: both gone 8 s after launch), before any timer
  assert.match(src, /await joinCheck\("final"\)/, "the check also runs as the run ends");
});

hub.kill();
if (failed) { console.error(`JOIN CHECK: ${failed}/4 failed`); process.exitCode = 1; } else console.log("JOIN CHECK OK (4 cases)");
process.exit();
