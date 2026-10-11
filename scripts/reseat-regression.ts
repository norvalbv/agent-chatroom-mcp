/** A launched seat that reconnects after a hub restart is put back in its seat by the hub, by the seat key in its MCP
 * URL. In a drill (swarm-003601-tky5, evidence/reconnect-drill) both seats' clients reconnected by themselves within a
 * minute of the restart, and the hub then refused their next call ("That participant_id was not issued to this
 * connection"); they got back only by working out that join_room with the old id was the way. The key is the proof:
 * a connection with another key, or none, is still refused. PORT=<port> npx tsx scripts/reseat-regression.ts */
import assert from "node:assert/strict";
import { type ChildProcess, spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

let nextPort = Number(process.env.PORT) || 0;
const freePort = () => new Promise<number>((done) => { const s = createServer(); s.listen(nextPort ? nextPort++ : 0, "127.0.0.1", () => { const p = (s.address() as { port: number }).port; s.close(() => done(p)); }); });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const port = await freePort();
const dir = mkdtempSync(join(tmpdir(), "reseat-"));
const procs: ChildProcess[] = [];
async function boot(): Promise<ChildProcess> {
  const { CHATROOM_SEAT_KEY: _k, CHATROOM_HEARTBEAT_URL: _h, ...rest } = process.env;
  const child = spawn(process.execPath, ["--import", "tsx", "src/index.ts"], { env: { ...rest, PORT: String(port), CHATROOM_DATA_DIR: dir, CHATROOM_INSECURE_LOCAL: "1", CHATROOM_SPAWN_DRY: "1", CHATROOM_LOG_DIR: join(dir, "spawned") }, stdio: "ignore" });
  procs.push(child);
  for (let i = 0; i < 150; i++) { try { await fetch(`http://127.0.0.1:${port}/`); return child; } catch { await sleep(200); } }
  throw new Error("hub did not start");
}
async function stop(child: ChildProcess): Promise<void> {
  const gone = new Promise((r) => child.on("exit", r));
  child.kill("SIGKILL");
  await gone;
  for (let i = 0; i < 50; i++) { try { await fetch(`http://127.0.0.1:${port}/`); await sleep(200); } catch { return; } }
}
const connect = async (seat?: string) => {
  const c = new Client({ name: "seat", version: "0" });
  await c.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp${seat ? `?seat=${seat}` : ""}`)));
  return c;
};
type Result = { isError?: boolean; content: { text: string }[] };
const call = async (c: Client, name: string, args: Record<string, unknown>) => {
  const r = (await c.callTool({ name, arguments: args })) as Result;
  const text = r.content[0]?.text ?? "";
  let data: Record<string, unknown> = {};
  try { data = JSON.parse(text); } catch {}
  return { error: !!r.isError, text, data };
};
const log = async () => (await (await fetch(`http://127.0.0.1:${port}/rooms/r/messages?since=0`)).json()) as { messages?: { from: { name: string }; content: string }[] } | { from: { name: string }; content: string }[];
const messages = async () => { const l = await log(); return Array.isArray(l) ? l : l.messages ?? []; };

try {
  let hub = await boot();
  const a = await connect("key-a");
  const b = await connect("key-b");
  const walkIn = await connect(); // joined by hand, no launcher and no seat key
  const aId = (await call(a, "join_room", { room: "r", name: "a", topic: "t" })).data.participant_id as string;
  const bId = (await call(b, "join_room", { room: "r", name: "b" })).data.participant_id as string;
  const wId = (await call(walkIn, "join_room", { room: "r", name: "walk-in" })).data.participant_id as string;
  const c = await connect("key-c");
  const cId = (await call(c, "join_room", { room: "r", name: "c" })).data.participant_id as string;
  assert.match(aId, /^p_/);
  assert.equal((await call(a, "send_message", { room: "r", content: "before the restart" })).error, false);
  // b says goodbye itself: a seat that left on purpose is not brought back by a later connection
  const left = await call(b, "leave_room", { room: "r", reason: "done with my part, nothing left undone" });
  if (left.error) assert.equal((await call(b, "leave_room", { room: "r", reason: "done with my part, nothing left undone" })).error, false, left.text);

  // (0) the connection drops and the client reconnects while the hub stays up: the hub still holds the old session and
  // the seat is still active under it. The same key moves the seat to the new connection, and the old session's end
  // (its DELETE, or the idle sweep) does not then take the seat out of the room.
  const d = await connect("key-d");
  await call(d, "join_room", { room: "r", name: "d" });
  const d2 = await connect("key-d");
  const moved = await call(d2, "send_message", { room: "r", content: "d on a second connection", force: true });
  assert.equal(moved.error, false, `a second connection with the same seat key is the same seat: ${moved.text}`);
  await (d.transport as StreamableHTTPClientTransport).terminateSession();
  await sleep(300);
  const still = await call(d2, "send_message", { room: "r", content: "d after the old session ended", force: true });
  assert.equal(still.error, false, `the old session ending does not remove the seat: ${still.text}`);
  assert.ok(!(await messages()).some((m) => /^d left the room/.test(m.content)), "and the room is not told d left");

  await stop(hub);
  hub = await boot();

  // (1) the same seat key on a new connection: the call it was making just works, as the same participant
  const a2 = await connect("key-a");
  const sent = await call(a2, "send_message", { room: "r", content: "after the restart, no join_room", force: true });
  assert.equal(sent.error, false, `a reconnecting seat's first call is served: ${sent.text}`);
  const after = await messages();
  assert.equal(after.find((m) => m.content === "after the restart, no join_room")?.from.name, "a", "and it speaks as its old self");
  assert.ok(after.some((m) => /a rejoined the room/.test(m.content)), "the room is told it is back");
  // ...also when the model passes the id it remembers
  const c2 = await connect("key-c");
  assert.equal((await call(c2, "send_message", { room: "r", participant_id: cId, content: "with my old id", force: true })).error, false);

  // (2) the key is the proof: another seat's key, or none, does not get a's seat
  const thief = await connect("key-b");
  const stolen = await call(thief, "send_message", { room: "r", participant_id: aId, content: "as a?" });
  assert.equal(stolen.error, true, "another seat's key with a's participant_id is refused");
  const anon = await connect();
  assert.equal((await call(anon, "send_message", { room: "r", content: "as whom?" })).error, true, "no key, no seat");

  // (3) b left on purpose: its key does not bring it back
  const b2 = await connect("key-b");
  const bBack = await call(b2, "send_message", { room: "r", content: "b again?" });
  assert.equal(bBack.error, true, "a seat that called leave_room is not re-seated");
  assert.match(bBack.text, /join_room/);
  assert.ok(bId);

  // (3b) b came back by join_room after leaving: it is a seat again, and its old goodbye does not stop the next re-seat
  assert.equal((await call(b2, "join_room", { room: "r", name: "b", participant_id: bId })).error, false);
  await stop(hub);
  hub = await boot();
  const b3 = await connect("key-b");
  const bAgain = await call(b3, "send_message", { room: "r", content: "b after a second restart", force: true });
  assert.equal(bAgain.error, false, `a seat that rejoined after leaving is re-seated like any other: ${bAgain.text}`);

  // (4) a seat with no key is told how to get back, in the refusal itself
  const walkIn2 = await connect();
  const refused = await call(walkIn2, "send_message", { room: "r", participant_id: wId, content: "walk-in after the restart" });
  assert.equal(refused.error, true);
  assert.match(refused.text, /join_room.*participant_id/s, "the refusal says join_room with the old participant_id takes the seat back");
  assert.equal((await call(walkIn2, "join_room", { room: "r", name: "walk-in", participant_id: wId })).error, false);
  assert.equal((await call(walkIn2, "send_message", { room: "r", participant_id: wId, content: "walk-in is back" })).error, false);
} finally {
  for (const p of procs) if (p.exitCode === null && p.signalCode === null) p.kill("SIGKILL");
}
console.log("RESEAT REGRESSION OK");
process.exit(0);
