/** Real launcher, private hub, fake agent binaries: a registered catalogue reaches the board without --resources.
 * PORT=<free port> node --import tsx scripts/source-feed-launch-regression.ts (build first). */
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { freePort, writeFakeBins } from "./seat-launch-fixture.ts";

const port = Number(process.env.PORT) || await freePort();
const base = mkdtempSync(join(tmpdir(), "source-feed-launch-"));
const bin = join(base, "bin"), records = join(base, "records"), project = join(base, "project");
for (const dir of [bin, records, project]) mkdirSync(dir, { recursive: true });
writeFakeBins(bin);
writeFileSync(join(project, "swarm.sources.json"), JSON.stringify({ version: 1, sources: [{ id: "case", path: "index.json" }] }));
const index = join(project, "index.json");
const put = (summary: string) => writeFileSync(index, JSON.stringify({ count: 1, entries: [{ id: "facts/window", path: "facts/window.md", title: "Trial profit window", kind: "fact", status: "provisional", summary, measured: "2026-10-27", superseded_by: [] }] }));
put("Positive point estimate does not establish profit.");
if (process.env.SOURCE_FEED_INDEX) writeFileSync(index, readFileSync(process.env.SOURCE_FEED_INDEX));
const original = JSON.parse(readFileSync(index, "utf8")).entries as Record<string, unknown>[];
const { CHATROOM_SEAT_KEY: _k, CHATROOM_HEARTBEAT_URL: _h, ...rest } = process.env;
const dataDir = `/tmp/hub-${port}`;
const hub = spawn(process.execPath, [resolve("dist/index.js")], {
  env: { ...rest, PORT: String(port), HOST: "127.0.0.1", CHATROOM_INSECURE_LOCAL: "1", CHATROOM_NO_RECRUIT: "1", CHATROOM_DATA_DIR: dataDir },
  stdio: "ignore",
});
try {
  let ready = false;
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(`http://127.0.0.1:${port}/`)).ok) { ready = true; break; } } catch {}
    if (hub.exitCode !== null) throw new Error(`private hub exited ${hub.exitCode}`);
    await new Promise((done) => setTimeout(done, 100));
  }
  assert.ok(ready, "private hub must start");
  function launch(tag: string) {
    const file = join(base, `${tag}.json`);
    const run = spawnSync(process.execPath, [resolve("dist/swarm.js"), "Audit the registered trial evidence", "--cwd", project, "--flat", "--agents", "2", "--quorum", "majority", "--no-carry", "--reuse-hub", "--timeout", "1", "--port", String(port), "--result-path", file], {
      encoding: "utf8", timeout: 90_000,
      env: { ...rest, PATH: `${bin}:${rest.PATH}`, FAKE_RECORD_DIR: records, CHATROOM_INSECURE_LOCAL: "1", CHATROOM_NO_RECRUIT: "1" },
    });
    assert.ok(!run.error, `launcher completed: ${run.error?.message}; ${run.stderr}`);
    return JSON.parse(readFileSync(file, "utf8"));
  }
  const first = launch("first");
  const board = first.rooms.find((r: { name: string }) => r.name === first.leadRoom).payload.board;
  const delivered = Object.values(board).flatMap((entry: any) => {
    try { const p = JSON.parse(entry.text); return p.schema === "swarm-source-page/v1" ? p.records : []; } catch { return []; }
  }) as Record<string, unknown>[];
  const fields = ["id", "path", "title", "kind", "status", "summary", "measured", "superseded_by"];
  const projectRow = (row: Record<string, unknown>) => Object.fromEntries(fields.filter(f => row[f] !== undefined).map(f => [f, row[f]]));
  console.log(JSON.stringify({ measure: "registered-records-delivered", n: original.length, delivered: delivered.length }));
  assert.ok(board["resource/source-case"], "default project registry must reach the real room board without --resources");
  assert.equal(first.sourceFeed.sources[0].records, original.length);
  assert.deepEqual(delivered.map(projectRow), original.map(projectRow), "every projected field, including the full summary and status, reaches the actual room");
  put("Fresh correction: outcome remains unestablished.");
  const second = launch("second");
  assert.notEqual(second.sourceFeed.sources[0].sha256, first.sourceFeed.sources[0].sha256);
  const fresh = second.rooms.find((r: { name: string }) => r.name === second.leadRoom).payload.board;
  assert.ok(Object.values(fresh).some((e: any) => e.text.includes("Fresh correction")));
  assert.ok(!Object.values(fresh).some((e: any) => e.text.includes("Positive point estimate")));
  console.log("SOURCE FEED LAUNCH REGRESSION OK");
} finally {
  if (hub.exitCode === null && hub.signalCode === null) { hub.kill("SIGTERM"); await new Promise((done) => hub.once("exit", done)); }
  rmSync(base, { recursive: true, force: true });
}
