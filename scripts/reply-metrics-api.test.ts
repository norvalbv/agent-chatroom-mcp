/** HTTP contract in an isolated process. PORT must exceed 8000.
 * PORT=18447 npx tsx scripts/reply-metrics-api.test.ts
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hub } from "../src/hub.js";

const port = Number(process.env.PORT ?? 18447);
assert.ok(Number.isInteger(port) && port > 8000 && port < 65536, "PORT must exceed 8000");
const dir = mkdtempSync(join(tmpdir(), "reply-metric-api-"));
const fixture = new Hub({ dataDir: dir });
fixture.join("api-fixture", "asker", "test", { expectedParticipants: 0 });
// Do not inherit live swarm policy, tokens, data path, dry-run settings or caps.
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("CHATROOM_")));
Object.assign(env, { PORT: String(port), HOST: "127.0.0.1", CHATROOM_DATA_DIR: dir, CHATROOM_SPAWN_DRY: "1", CHATROOM_LOG_DIR: join(dir, "logs") });
const server = spawn(process.execPath, ["--import", "tsx", "src/index.ts"], { env, stdio: ["ignore", "pipe", "pipe"] });
let output = "";
server.stdout.on("data", chunk => { output += chunk; });
server.stderr.on("data", chunk => { output += chunk; });
const base = `http://127.0.0.1:${port}`;
try {
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (server.exitCode !== null) throw new Error(`Server exited ${server.exitCode}: ${output}`);
    try {
      const response = await fetch(`${base}/rooms/api-fixture/stats`);
      if (response.status === 200) { ready = true; break; }
    } catch { /* not started */ }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(ready, `isolated server did not start: ${output}`);
  const query = (suffix = "") => fetch(`${base}/rooms/api-fixture/stats${suffix}`);
  const defaults = await (await query()).json() as any;
  assert.ok(defaults.reply_metrics, "GET stats must add reply_metrics");
  assert.equal(defaults.reply_metrics.window_minutes, 15);
  assert.equal(defaults.reply_metrics.reply_rate, null);
  assert.ok("refusal_rates" in defaults, "preserve existing stats fields");
  for (const value of ["1", "0.5", "1440"]) {
    const response = await query(`?reply_window_minutes=${value}`);
    assert.equal(response.status, 200, value);
    assert.equal(((await response.json()) as any).reply_metrics.window_minutes, Number(value));
  }
  for (const value of ["", "0", "-1", "NaN", "Infinity", "1441", "15x", " "]) {
    assert.equal((await query(`?reply_window_minutes=${encodeURIComponent(value)}`)).status, 400, `reject ${JSON.stringify(value)}`);
  }
  assert.equal((await query("?reply_window_minutes=15&reply_window_minutes=20")).status, 400, "reject repeated query values");
  console.log("REPLY METRICS API OK");
} finally {
  if (server.exitCode === null) {
    server.kill("SIGTERM");
    await new Promise<void>(resolve => {
      const timer = setTimeout(() => { server.kill("SIGKILL"); resolve(); }, 5000);
      server.once("exit", () => { clearTimeout(timer); resolve(); });
    });
  }
  rmSync(dir, { recursive: true, force: true });
}
