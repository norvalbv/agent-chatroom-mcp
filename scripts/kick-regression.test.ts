/**
 * Human-kick regression: POST /rooms/:room/kick — the dashboard human kick that reuses the leave path.
 * Server level (replacement-route.test.ts pattern; isolated hub with PORT + CHATROOM_DATA_DIR +
 * CHATROOM_HUMAN_TOKEN) covers the route contract; in-process Hub tests (challenge-session-regression.ts
 * pattern) cover hub.kick semantics: force-past-block, claim release, breadcrumb, replay.
 * Run: npx tsx --test scripts/kick-regression.test.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Hub, HubError } from "../src/hub.js";

const ROOM = "kick-regression";
const TOKEN = "human-token-secret";
const CLAIM_JSON = (owner: string) => JSON.stringify({ area: "kick-things", owner, team: [owner], status: "open" });

// ---------- server level ----------
let seq = 0;
async function withHub(humanToken: string | null, fn: (base: string) => Promise<void>) {
  const port = 19100 + Math.floor(Math.random() * 9000);
  const dir = mkdtempSync(join(tmpdir(), `kick-regression-${seq++}-`));
  const env: Record<string, string> = {
    ...process.env, PORT: String(port), CHATROOM_DATA_DIR: dir,
    CHATROOM_LAUNCHER_TOKEN: TOKEN, CHATROOM_SPAWN_DRY: "1",
  };
  if (humanToken !== null) env.CHATROOM_HUMAN_TOKEN = humanToken;
  const child: ChildProcess = spawn(process.execPath, ["node_modules/tsx/dist/cli.mjs", "src/index.ts"], { env, stdio: "ignore" });
  const base = `http://localhost:${port}`;
  try {
    let ready = false;
    for (let i = 0; i < 100; i++) {
      try { if ((await fetch(base)).ok) { ready = true; break; } } catch {}
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.ok(ready, "isolated hub started");
    await fn(base);
  } finally {
    child.kill("SIGTERM");
    await new Promise<void>((r) => (child.exitCode !== null ? r() : child.once("exit", () => r())));
    rmSync(dir, { recursive: true, force: true });
  }
}

async function connect(base: string, name: string) {
  const client = new Client({ name, version: "0.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`)));
  const call = async (tool: string, args: Record<string, unknown> = {}) => {
    const res = (await client.callTool({ name: tool, arguments: args })) as { isError?: boolean; content: { text: string }[] };
    const text = res.content[0]?.text ?? "";
    if (res.isError) throw new Error(`${name}.${tool}: ${text}`);
    try { return JSON.parse(text); } catch { return text; }
  };
  return { client, call };
}

/** A single non-human active seat owning claim/kick-things, plus a human observer seat. */
async function seedSeat(base: string) {
  const a = await connect(base, `kick-client-${seq++}`);
  await a.call("join_room", { room: ROOM, name: "kick-target", agent: "codex" });
  await a.call("board_set", { room: ROOM, key: "claim/kick-things", text: CLAIM_JSON("kick-target") });
  await fetch(`${base}/rooms/${ROOM}/messages`, {
    method: "POST", headers: { "content-type": "application/json", "x-chatroom-token": TOKEN },
    body: JSON.stringify({ name: "observer", content: "hi" }),
  });
}

const kickReq = (base: string, token?: string, body: unknown = { name: "kick-target", reason: "sleeping" }) =>
  fetch(`${base}/rooms/${ROOM}/kick`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { "x-chatroom-token": token } : {}) },
    body: JSON.stringify(body),
  });

test("kick route fails closed with 503 when CHATROOM_HUMAN_TOKEN is unset, even with a token header", () =>
  withHub(null, async (base) => {
    assert.equal((await kickReq(base, TOKEN)).status, 503);
    assert.equal((await kickReq(base)).status, 503);
  }));

test("kick route rejects absent and wrong x-chatroom-token with 401 when configured", () =>
  withHub(TOKEN, async (base) => {
    await seedSeat(base);
    assert.equal((await kickReq(base)).status, 401);
    assert.equal((await kickReq(base, "wrong")).status, 401);
  }));

test("kick route: 400 bad payload, 404 unknown room/participant, 400 human seat", () =>
  withHub(TOKEN, async (base) => {
    await seedSeat(base);
    assert.equal((await kickReq(base, TOKEN, { name: "", reason: "x" })).status, 400);
    assert.equal((await kickReq(base, TOKEN, { name: "ghost", reason: "x" })).status, 404);
    const unknown = await fetch(`${base}/rooms/not-a-room/kick`, {
      method: "POST", headers: { "content-type": "application/json", "x-chatroom-token": TOKEN },
      body: JSON.stringify({ name: "kick-target", reason: "x" }),
    });
    assert.equal(unknown.status, 404);
    assert.equal((await kickReq(base, TOKEN, { name: "observer", reason: "x" })).status, 400, "human seats are not kickable");
  }));

test("valid token kicks the named participant: inactive, leaveReason 'kicked by human', claim handed, handoff breadcrumb", () =>
  withHub(TOKEN, async (base) => {
    await seedSeat(base);
    const res = await kickReq(base, TOKEN, { name: "kick-target", reason: "sleeping on the job" });
    assert.equal(res.status, 200);
    const sum = (await (await fetch(`${base}/rooms/${ROOM}`)).json()) as {
      participants: { name: string; active: boolean; left_reason: string | null }[];
      board: Record<string, { by: string; text: string }>;
    };
    const p = sum.participants.find((x) => x.name === "kick-target")!;
    assert.equal(p.active, false);
    assert.match(p.left_reason ?? "", /kicked by human: sleeping/);
    const handoff = sum.board["handoff/kick-kick-target"];
    assert.ok(handoff, "handoff/kick-<name> breadcrumb written");
    assert.equal(handoff.by, "kick-target", "authored as the kicked seat so the launcher sees a handoff (no respawn)");
    const claim = JSON.parse(sum.board["claim/kick-things"].text);
    assert.equal(claim.status, "handed");
    assert.match(JSON.stringify(claim.note ?? ""), /kicked-by-human/);
  }));

test("dashboard people pane renders a kick button (data-kick) per participant row", () =>
  withHub(TOKEN, async (base) => {
    const html = await (await fetch(`${base}/ui`)).text();
    assert.match(html, /data-kick/);
  }));

// ---------- in-process hub.kick semantics ----------
const TEXT = "Kick must reuse the leave path with force semantics.";
const QUOTE = "reuse the leave path";

test("hub.kick forces leave past an open-proposal block that plain leave refuses once", () => {
  const hub = new Hub({});
  const { room, participant: a } = hub.join(ROOM, "A", "codex", { requireChallenge: true }, undefined, "s1");
  const { participant: b } = hub.join(ROOM, "B", "codex", {}, undefined, "s2");
  const proposal = hub.propose(ROOM, a.id, TEXT);
  hub.vote(ROOM, a.id, proposal.id, "agree", "agreed", undefined, QUOTE);
  hub.vote(ROOM, b.id, proposal.id, "agree", "agreed", undefined, QUOTE);
  assert.throws(() => hub.leave(ROOM, b.id, "bye"), HubError, "plain leave is double-refused here");
  hub.kick(ROOM, b.id, "sleeping");
  const p = hub.getRoom(ROOM).participants.get(b.id)!;
  assert.equal(p.active, false);
  assert.match(p.leaveReason ?? "", /kicked by human: sleeping/);
  assert.equal(room.state, "open", "kick must not conclude the room");
});

test("hub.kick releases the kicked seat's claims and writes handoff/kick-<name>", () => {
  const hub = new Hub({});
  const { participant: a } = hub.join(ROOM, "A", "codex", {}, undefined, "s1");
  hub.setBoard(ROOM, a.id, "claim/kick-things", CLAIM_JSON("A"));
  hub.kick(ROOM, a.id, "gone");
  const room = hub.getRoom(ROOM);
  const claim = JSON.parse(room.board.get("claim/kick-things")!.text);
  assert.equal(claim.status, "handed");
  assert.match(JSON.stringify(claim.note ?? ""), /kicked-by-human/);
  const handoff = room.board.get("handoff/kick-A");
  assert.ok(handoff, "handoff/kick-<name> breadcrumb exists");
  assert.equal(handoff?.by, "A", "authored as the kicked seat");
});

test("hub.kick refuses human and chair seats", () => {
  const hub = new Hub({});
  const { participant: h } = hub.join(ROOM, "human-observer", "human", {}, undefined, "s1");
  const { participant: c } = hub.join(ROOM, "Chair", "codex", {}, undefined, "s2", "chair" as never);
  assert.throws(() => hub.kick(ROOM, h.id, "x"), /human|chair/i);
  assert.throws(() => hub.kick(ROOM, c.id, "x"), /human|chair/i);
});

test("kick leave event persists and replays replay-safe (kicked state survives reload)", () => {
  const dataDir = mkdtempSync(join(tmpdir(), "kick-replay-"));
  try {
    const hub = new Hub({ dataDir });
    const { participant: a } = hub.join(ROOM, "A", "codex", {}, undefined, "s1");
    hub.kick(ROOM, a.id, "sleeping");
    const revived = new Hub({ dataDir });
    const p = revived.getRoom(ROOM).participants.get(a.id)!;
    assert.equal(p.active, false, "leave event restores the seat inactive on replay");
    assert.match(p.leaveReason ?? "", /kicked by human: sleeping/);
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});
