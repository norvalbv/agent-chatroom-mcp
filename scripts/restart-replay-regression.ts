/**
 * A hub restarts on the data its predecessor wrote: everything smoke.ts drives (rooms, breakouts, notes and acks, board
 * writes, proposals, challenges, votes, last calls, kick votes, human routes, late writes) is persisted with health
 * sampling on, then a second hub boots on the same data dir and must serve every room it finds.
 * Run: npx tsx scripts/restart-replay-regression.ts (PORT= to pin; about two minutes under load)
 *
 * Why: smoke runs in memory, so nothing exercised "busy hub, stop, start again". On integration 57459091 the hub-health
 * file (0feee53b) sat in the data dir, replay read it as a room log, and the next start crashed at uptime 0 every 30 s
 * under hubd (found by claude-opus-5-5-2 in an A/B arm; a one-boot replay check on a copy of 7717's data could not see it).
 */
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hub } from "../src/hub.js";

const freePort = () => new Promise<number>((done) => { const s = createServer(); s.listen(0, "127.0.0.1", () => { const { port } = s.address() as { port: number }; s.close(() => done(port)); }); });
const dir = mkdtempSync(join(tmpdir(), "restart-replay-"));
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("CHATROOM_") && !k.startsWith("SMOKE_")));
let failed = 0;
try {
  // 1. the whole smoke against a persisted hub that samples its health every 200 ms
  const port1 = process.env.PORT ? Number(process.env.PORT) : await freePort();
  // RESTART_HEALTH_MS=0 runs it with health sampling off (to check everything else while the health file is the known breaker)
  const HEALTH = process.env.RESTART_HEALTH_MS ?? "200";
  const smoke = spawnSync(process.execPath, ["--import", "tsx", "scripts/smoke.ts"], { env: { ...env, PORT: String(port1), SMOKE_DATA_DIR: dir, SMOKE_HEALTH_MS: HEALTH }, encoding: "utf8", timeout: 600_000 });
  assert.match(smoke.stdout ?? "", /SMOKE OK/, `smoke on a persisted hub: ${(smoke.stderr ?? "").slice(-400)}`);
  const logs = readdirSync(dir).filter((f) => f.endsWith(".jsonl"));
  assert.ok(logs.length > 3, `smoke left room logs in the data dir (${logs.join(", ")})`);
  console.log(`PASS smoke ran on a persisted hub (${logs.length} .jsonl files in the data dir)`);

  // 1b. what smoke never writes (claude-opus-5-5-5's list, #875), on a hub over the same dir: a seat that joins with a
  // seat key and exits on a usage limit (seat_exit), a reclaim of a seat from a second session and the close of the
  // first (session events), a key the board refuses (key_rejected) and a typed refusal, the launcher's run_end and the
  // owner's verdict, a token-checked human message and a named chair (speaker identity)
  {
    const portA = await freePort();
    const TOKEN = "restart-replay-token";
    const hubA = spawn(process.execPath, ["--import", "tsx", "src/index.ts"], { env: { ...env, PORT: String(portA), CHATROOM_DATA_DIR: dir, CHATROOM_SPAWN_DRY: "1", CHATROOM_INSECURE_LOCAL: "1", CHATROOM_HEALTH_MS: HEALTH, CHATROOM_HUMAN_TOKEN: TOKEN }, stdio: ["ignore", "ignore", "pipe"] });
    let errA = "";
    hubA.stderr.on("data", (d) => (errA += d));
    try {
      const base = `http://127.0.0.1:${portA}`;
      let upA = false;
      for (let i = 0; i < 450 && hubA.exitCode === null; i++) { try { await fetch(`${base}/`); upA = true; break; } catch { await new Promise((r) => setTimeout(r, 200)); } }
      assert.ok(upA, `a hub restarted on smoke's data did not come up (exit ${hubA.exitCode}): ${errA.split("\n").filter((l) => /exit|Error|Cannot/.test(l)).slice(-2).join(" | ").slice(0, 300)}`);
      const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
      const { StreamableHTTPClientTransport } = await import("@modelcontextprotocol/sdk/client/streamableHttp.js");
      const seat = async (name: string, key?: string, extra: Record<string, unknown> = {}) => {
        const client = new Client({ name, version: "0" });
        const transport = new StreamableHTTPClientTransport(new URL(`${base}/mcp${key ? `?seat=${key}` : ""}`));
        await client.connect(transport);
        const r = (await client.callTool({ name: "join_room", arguments: { room: "extras", name, agent: "claude", ...extra } })) as { content: { text: string }[] };
        return { client, transport, joined: JSON.parse(r.content[0]!.text) as { participant_id: string } };
      };
      const post = (path: string, body: object, token = true) => fetch(`${base}${path}`, { method: "POST", headers: { "content-type": "application/json", ...(token ? { "x-chatroom-token": TOKEN } : {}) }, body: JSON.stringify(body) });
      assert.equal((await post("/rooms/extras/create", { topic: "restart extras", chair: "chair-x" })).status < 300, true);
      const KEY = "restart-replay-seat-key-0001";
      const s1 = await seat("seat-1", KEY);
      const s2 = await seat("seat-2");
      await seat("chair-x", undefined, { role: "chair" });
      await s1.client.callTool({ name: "board_set", arguments: { room: "extras", key: "digest/a@b", text: "refused key" } });
      await s2.client.callTool({ name: "vote", arguments: { room: "extras", proposal_id: "prop_none", vote: "agree" } });
      assert.equal((await post("/rooms/extras/messages", { name: "benji", content: "owner line", source: "orchestrator" })).status, 200);
      // a reclaim of seat-2 from a second session, then the first session closes
      const again = new Client({ name: "seat-2b", version: "0" });
      await again.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`)));
      await again.callTool({ name: "join_room", arguments: { room: "extras", name: "seat-2", agent: "claude", participant_id: s2.joined.participant_id } });
      await s2.transport.terminateSession().catch(() => {});
      await s2.client.close().catch(() => {});
      assert.equal((await post("/heartbeat", { seat_key: KEY, exited: true, detail: "exit 1: usage limit, resets 14:00 UTC" }, false)).status, 200);
      assert.equal((await post("/rooms/extras/run-end", { cause: "operator_stop", detail: "restart check" })).status, 200);
      assert.equal((await post("/rooms/extras/verdict", { verdict: "partial", note: "restart check" })).status, 200);
      await new Promise((r) => setTimeout(r, 600)); // health samples
      // the events are in the log, so the restart below replays them rather than nothing
      const types = new Set(readFileSync(join(dir, "extras.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => (JSON.parse(l) as { type: string }).type));
      for (const t of ["seat_exit", "run_end", "owner_verdict", "refusal", "call_completion", "session"]) assert.ok(types.has(t), `extras.jsonl has a ${t} event (types: ${[...types].join(", ")})`);
      const msgs = readFileSync(join(dir, "extras.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as { type: string; msg?: { via?: string; source?: string; chair?: string } });
      assert.ok(msgs.some((e) => e.type === "message" && e.msg?.via === "human-token" && e.msg?.source === "orchestrator"), "a token-checked human message with its script label is in the log");
      assert.ok(readFileSync(join(dir, "extras.jsonl"), "utf8").includes('"key_rejected"'), "the refused key is logged by its shape (key_rejected)");
      console.log("PASS drove the events smoke never writes (seat_exit, session, key_rejected, typed refusal, run_end, owner_verdict, speaker identity)");
    } finally {
      hubA.kill("SIGTERM");
      for (let i = 0; i < 40 && hubA.exitCode === null && hubA.signalCode === null; i++) await new Promise((r) => setTimeout(r, 250));
    }
  }

  // 2. in process: a Hub replays that dir without throwing, and every room it holds is one the dir has a log for
  const replay = new Hub({ dataDir: dir });
  const rooms = replay.listRooms();
  assert.ok(rooms.length > 3, `replayed ${rooms.length} rooms`);
  console.log(`PASS in-process replay: ${rooms.length} rooms`);

  // 3. a real second hub on the same dir boots, stays up and serves every room
  const port2 = await freePort();
  const hub = spawn(process.execPath, ["--import", "tsx", "src/index.ts"], { env: { ...env, PORT: String(port2), CHATROOM_DATA_DIR: dir, CHATROOM_SPAWN_DRY: "1", CHATROOM_INSECURE_LOCAL: "1", CHATROOM_HEALTH_MS: HEALTH }, stdio: ["ignore", "ignore", "pipe"] });
  let err = "";
  hub.stderr.on("data", (d) => (err += d));
  let exited: number | null = null;
  hub.on("exit", (code) => (exited = code ?? -1));
  try {
    let up = false;
    for (let i = 0; i < 450 && exited === null; i++) { try { await fetch(`http://127.0.0.1:${port2}/`); up = true; break; } catch { await new Promise((r) => setTimeout(r, 200)); } }
    assert.ok(up, `the second hub did not come up (exit ${exited}): ${err.slice(-400)}`);
    await new Promise((r) => setTimeout(r, 1500)); // a health sample or two, then still up
    assert.equal(exited, null, `the second hub exited: ${err.slice(-400)}`);
    const served = (await (await fetch(`http://127.0.0.1:${port2}/rooms`)).json()) as { name: string }[];
    assert.equal(served.length, rooms.length, "the served hub holds the rooms the in-process replay holds");
    for (const r of served) {
      const res = await fetch(`http://127.0.0.1:${port2}/rooms/${encodeURIComponent(r.name)}`);
      assert.equal(res.status, 200, `GET /rooms/${r.name}`);
    }
    console.log(`PASS a second hub booted on the same data dir and served all ${served.length} rooms`);
    const extras = (await (await fetch(`http://127.0.0.1:${port2}/rooms/extras`)).json()) as { messages?: unknown; participants: { name: string }[]; chair?: string | null };
    assert.equal(extras.chair, "chair-x", "the creation-named chair survived the restart");
    assert.ok(extras.participants.some((p) => p.name === "seat-1"), "the room with the exited seat replays");
  } finally { hub.kill(); }
} catch (e) {
  failed++;
  console.error(`FAIL ${e instanceof Error ? e.message.split("\n")[0] : e}`);
} finally { rmSync(dir, { recursive: true, force: true }); }
if (failed) { console.error("RESTART REPLAY: failed"); process.exitCode = 1; } else console.log("RESTART REPLAY OK");
process.exit();
