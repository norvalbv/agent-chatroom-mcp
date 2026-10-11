/**
 * The call that puts a reconnecting seat back in its seat is recorded as that seat's call. The guard around every tool
 * worked out who was calling, and whether the caller was an outsider, before the tool ran; the reseat happens inside
 * the tool (pid() in src/server.ts), so the first call after a hub restart or a dropped session was written to the room
 * record with participant null and outsider "(no seat)", and the room's stats listed "(no seat): <tool>" under outside_calls
 * for every seat that came back (merge-review backlog B4, docs/self-improvement-swarm-003601-tky5.md).
 * Run: npx tsx scripts/reseat-telemetry-regression.ts
 */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Hub } from "../src/hub.js";
import { createSessionServer } from "../src/server.js";

const cases: [string, () => Promise<void> | void][] = [];
const test = (name: string, run: () => Promise<void> | void) => cases.push([name, run]);

Hub.DEFAULT_NUDGE_MS = 0;
const dirs: string[] = [];
/** One MCP connection, as a launcher starts it: its seat key is bound to the connection before any call. */
async function connect(h: Hub, seatKey?: string) {
  const session = createSessionServer(h);
  if (seatKey) h.bindSeat(seatKey, session.sessionKey);
  const client = new Client({ name: seatKey ?? "walk-in", version: "1" });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await session.server.connect(st); await client.connect(ct);
  const call = async (tool: string, args: Record<string, unknown>) => {
    const r = await client.callTool({ name: tool, arguments: args });
    const text = (r.content as { text: string }[])[0]?.text ?? "";
    let data: Record<string, unknown> = {};
    try { data = JSON.parse(text); } catch { /* a refusal is prose */ }
    return { error: !!r.isError, text, data };
  };
  return { call, session };
}
type Completion = { type: string; tool: string; outcome: string; participant: string | null; outsider?: string };
let serial = 0;
/** A room with two launched seats, and an outsider seated in another room. */
async function room() {
  const dir = mkdtempSync(join(tmpdir(), "reseat-telemetry-"));
  dirs.push(dir);
  const h = new Hub({ dataDir: dir });
  const name = `reseat-telemetry-${++serial}`;
  const a = await connect(h, "key-a"), b = await connect(h, "key-b"), x = await connect(h, "key-x");
  const aId = (await a.call("join_room", { room: name, name: "a", agent: "claude", topic: "t" })).data.participant_id as string;
  await b.call("join_room", { room: name, name: "b", agent: "claude" });
  await x.call("join_room", { room: `${name}-other`, name: "x", agent: "claude", topic: "t" });
  /** the room's call_completion lines since the last look */
  let seen = 0;
  const completions = (): Completion[] => {
    const all = readFileSync(join(dir, `${name}.jsonl`), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as Completion).filter((e) => e.type === "call_completion");
    const fresh = all.slice(seen);
    seen = all.length;
    return fresh;
  };
  completions();
  return { h, dir, name, a, x, aId, completions };
}
const outside = (h: Hub, name: string) => (h.stats(h.getRoom(name)) as { outside_calls?: Record<string, number> }).outside_calls ?? {};

test("a seat whose session dropped: its next call is recorded as its own, not as an outside call", async () => {
  const { h, name, a, aId, completions } = await room();
  a.session.leaveAll();
  const again = await connect(h, "key-a");
  const r = await again.call("send_message", { room: name, content: "back" });
  assert.equal(r.error, false, r.text);
  assert.deepEqual(completions().map((c) => [c.tool, c.outcome, c.participant, c.outsider]), [["send_message", "success", aId, undefined]]);
  assert.deepEqual(outside(h, name), {}, "the room's stats list no outside call");
  // and the calls after it, as before
  await again.call("board_set", { room: name, key: "findings/a", text: "x" });
  assert.deepEqual(completions().map((c) => [c.participant, c.outsider]), [[aId, undefined]]);
});

test("after a hub restart: the same, for a write and for a wait", async () => {
  for (const [tool, args] of [["wait_for_messages", { timeout_ms: 0 }], ["board_set", { key: "findings/a", text: "x" }]] as const) {
    const { dir, name, aId, completions } = await room();
    const restarted = new Hub({ dataDir: dir });
    assert.equal(restarted.getRoom(name).participants.get(aId)!.active, false, "a restored seat is out until it calls");
    const again = await connect(restarted, "key-a");
    const r = await again.call(tool, { room: name, ...args });
    assert.equal(r.error, false, r.text);
    assert.deepEqual(completions().map((c) => [c.tool, c.participant, c.outsider]), [[tool, aId, undefined]], tool);
    assert.deepEqual(outside(restarted, name), {}, tool);
    assert.equal(restarted.getRoom(name).participants.get(aId)!.active, true);
  }
});

test("a seat that moves to a newer connection while the older one is still open: the same", async () => {
  const { h, name, aId, completions } = await room();
  const newer = await connect(h, "key-a");
  assert.equal((await newer.call("send_message", { room: name, content: "moved" })).error, false);
  assert.deepEqual(completions().map((c) => [c.participant, c.outsider]), [[aId, undefined]]);
});

test("a reseated call that is then refused is the seat's refusal", async () => {
  const { h, name, a, aId, completions } = await room();
  a.session.leaveAll();
  const again = await connect(h, "key-a");
  const r = await again.call("board_set", { room: name, key: "not a key!", text: "x" });
  assert.equal(r.error, true);
  assert.deepEqual(completions().map((c) => [c.outcome, c.participant, c.outsider]), [["hub_refusal", aId, undefined]]);
  assert.equal(h.recentRefusals(h.getRoom(name), 1)[0]?.name, "a", "the refusal names the seat, not unknown");
});

test("control: a seat of another room is still an outsider here, and a connection with no key is still nobody", async () => {
  const { h, name, a, x, aId, completions } = await room();
  await x.call("board_get", { room: name });
  assert.deepEqual(completions().map((c) => [c.participant, c.outsider]), [[null, `x@${name}-other`]]);
  a.session.leaveAll();
  const walkIn = await connect(h);
  const r = await walkIn.call("send_message", { room: name, content: "me again", participant_id: aId });
  assert.equal(r.error, true, "no key, no seat");
  assert.deepEqual(completions().map((c) => [c.outcome, c.participant, c.outsider]), [["hub_refusal", null, "(no seat)"]]);
  assert.deepEqual(outside(h, name), { [`x@${name}-other: board_get`]: 1, "(no seat): send_message": 1 });
});

let failed = 0;
for (const [name, run] of cases) {
  try {
    await run();
    console.log(`ok   ${name}`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${name}\n     ${(e as Error).message.split("\n").slice(0, 12).join("\n     ")}`);
  }
}
for (const d of dirs) rmSync(d, { recursive: true, force: true });
console.log(failed ? `\n${failed} of ${cases.length} failed` : `\nRESEAT TELEMETRY OK (${cases.length} cases)`);
process.exit(failed ? 1 : 0);
