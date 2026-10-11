/**
 * A hub restarts on its own data directory (found by claude-opus-5-5-2's A/B on integration 57459091). 0feee53b writes
 * the hub's health samples to <data>/hub-<port>.health.jsonl, beside the room logs, and replay read every *.jsonl in the
 * directory as a room log: a health line has no type and no room, so the next start of any hub that had sampled once
 * threw in replay (recordReplyMetricEvent: "Cannot read properties of undefined (reading 'room')") and hubd restarted it
 * into the same crash every 30 s. Replay now reads only files named like a room (Hub.ROOM_NAME: no dots), and skips a
 * line that is not an event instead of throwing; and the sampler writes hub-<port>.health.log, outside the room logs'
 * extension. The second test restarts a real served hub that has sampled health.
 * Run: npx tsx --test scripts/replay-skips-non-room-files-regression.ts
 */
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Hub } from "../src/hub.js";

test("a health file and a stray line in the data dir do not stop a restart, and the rooms still load", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "replay-skip-"));
  const h1 = new Hub({ dataDir: dir });
  const a = h1.join("live-room", "A", "claude", { nudgeAfterMs: 0 }, undefined, "s1").participant;
  h1.send("live-room", a.id, "working on it", undefined, true);
  const r1 = h1.getRoom("live-room");
  clearTimeout(r1.nudgeTimer); clearTimeout(r1.openingsTimer);
  // what 0feee53b's sampler writes, once a minute
  writeFileSync(join(dir, "hub-7999.health.jsonl"), `${JSON.stringify({ ts: new Date().toISOString(), pid: 1, uptime_s: 60, rss_mb: 80, loop_lag_ms: { p50: 1, p99: 3, max: 9 }, sessions: 2, requests: 40, rooms_open: 1, participants_active: 1, waiting: 1 })}\n`);
  writeFileSync(join(dir, "hub-7999.health.jsonl.1"), "{}\n");
  // and a line in a room log that is JSON but not an event
  writeFileSync(join(dir, "other-room.jsonl"), `{"note":"not an event"}\n`);
  let h2: Hub | undefined;
  assert.doesNotThrow(() => { h2 = new Hub({ dataDir: dir }); }, "the restarted hub replays its own data dir");
  const r2 = h2!.getRoom("live-room");
  t.after(() => { clearTimeout(r2.nudgeTimer); clearTimeout(r2.openingsTimer); });
  assert.ok(r2.messages.some((m) => m.content === "working on it"), "the room log is replayed");
  assert.equal(h2!.rooms.has("hub-7999.health"), false, "the health file is not a room");
});

test("a served hub that has sampled its health starts again on the same data dir", { timeout: 180_000 }, async () => {
  const { spawn } = await import("node:child_process");
  const PORT = Number(process.env.PORT ?? 20_000 + Math.floor(Math.random() * 20_000));
  assert.notEqual(PORT, 7717);
  const dir = mkdtempSync(join(tmpdir(), "replay-restart-"));
  const env = { ...process.env, PORT: String(PORT), CHATROOM_DATA_DIR: dir, CHATROOM_HEALTH_MS: "300", CHATROOM_INSECURE_LOCAL: "1", CHATROOM_SPAWN_DRY: "1" };
  const up = async () => { for (let i = 0; i < 450; i++) { try { await fetch(`http://127.0.0.1:${PORT}/`); return true; } catch { await new Promise((r) => setTimeout(r, 200)); } } return false; };
  const start = () => spawn(process.execPath, ["--import", "tsx", "src/index.ts"], { env, stdio: "ignore" });
  const first = start();
  assert.ok(await up(), "first start");
  await fetch(`http://127.0.0.1:${PORT}/rooms/r1/create`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }).catch(() => {});
  await new Promise((r) => setTimeout(r, 1200)); // several health samples
  const { readdirSync } = await import("node:fs");
  assert.ok(readdirSync(dir).some((f) => f.endsWith(".health.log")), `health is sampled to a .log file: ${readdirSync(dir).join(", ")}`);
  assert.ok(!readdirSync(dir).some((f) => f.endsWith(".health.jsonl")), "not to a .jsonl the room-log readers would take");
  first.kill();
  await new Promise<void>((done) => first.on("exit", () => done()));
  const second = start();
  let exited: number | null | undefined;
  second.on("exit", (c) => { exited = c; });
  const ok = await up();
  second.kill();
  assert.ok(ok && exited === undefined, `the second start serves (exit ${exited})`);
});
