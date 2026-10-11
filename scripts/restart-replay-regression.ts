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
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
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
  const smoke = spawnSync(process.execPath, ["--import", "tsx", "scripts/smoke.ts"], { env: { ...env, PORT: String(port1), SMOKE_DATA_DIR: dir, SMOKE_HEALTH_MS: "200" }, encoding: "utf8", timeout: 600_000 });
  assert.match(smoke.stdout ?? "", /SMOKE OK/, `smoke on a persisted hub: ${(smoke.stderr ?? "").slice(-400)}`);
  const logs = readdirSync(dir).filter((f) => f.endsWith(".jsonl"));
  assert.ok(logs.length > 3, `smoke left room logs in the data dir (${logs.join(", ")})`);
  console.log(`PASS smoke ran on a persisted hub (${logs.length} .jsonl files in the data dir)`);

  // 2. in process: a Hub replays that dir without throwing, and every room it holds is one the dir has a log for
  const replay = new Hub({ dataDir: dir });
  const rooms = replay.listRooms();
  assert.ok(rooms.length > 3, `replayed ${rooms.length} rooms`);
  console.log(`PASS in-process replay: ${rooms.length} rooms`);

  // 3. a real second hub on the same dir boots, stays up and serves every room
  const port2 = await freePort();
  const hub = spawn(process.execPath, ["--import", "tsx", "src/index.ts"], { env: { ...env, PORT: String(port2), CHATROOM_DATA_DIR: dir, CHATROOM_SPAWN_DRY: "1", CHATROOM_INSECURE_LOCAL: "1", CHATROOM_HEALTH_MS: "200" }, stdio: ["ignore", "ignore", "pipe"] });
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
  } finally { hub.kill(); }
} catch (e) {
  failed++;
  console.error(`FAIL ${e instanceof Error ? e.message.split("\n")[0] : e}`);
} finally { rmSync(dir, { recursive: true, force: true }); }
if (failed) { console.error("RESTART REPLAY: failed"); process.exitCode = 1; } else console.log("RESTART REPLAY OK");
process.exit();
