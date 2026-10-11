/**
 * The hub samples its own health while it runs, so a death can be attributed afterwards (bugs.md, "Telemetry that would
 * have made these easier to diagnose" 3: "Nothing samples RSS, heap, event-loop lag, open sessions or request rate
 * before an exit, and nothing at all was recorded for the 2026-09-19 and 2026-10-10 deaths").
 * - data/hub-<port>.health.log: one JSON line per CHATROOM_HEALTH_MS (default 60 s): memory, event-loop lag, MCP
 *   sessions, HTTP requests since the last line, rooms open, active participants, long-polls waiting.
 * - the lifecycle log's exit line carries the last sample, so "how did it look just before" is one line to read.
 * A served hub on its own port (never 7717), stopped by pid. Run: npx tsx scripts/hub-health-regression.ts
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { ownHubPort } from "./lib/own-hub.js";

const PORT = await ownHubPort(Number(process.env.PORT ?? 20_000 + Math.floor(Math.random() * 20_000)));
assert.notEqual(PORT, 7717, "never the live hub");
const HTTP = `http://127.0.0.1:${PORT}`;
const dir = mkdtempSync(join(tmpdir(), "hub-health-"));
const server = spawn(process.execPath, ["--import", "tsx", "src/index.ts"], { env: { ...process.env, PORT: String(PORT), CHATROOM_DATA_DIR: dir, CHATROOM_HEALTH_MS: "300", CHATROOM_INSECURE_LOCAL: "1", CHATROOM_SPAWN_DRY: "1" }, stdio: "ignore" });
process.on("exit", () => { server.kill(); rmSync(dir, { recursive: true, force: true }); });
for (let i = 0; ; i++) {
  try { await fetch(`${HTTP}/`); break; } catch { if (i > 150) throw new Error("hub did not start"); await new Promise((r) => setTimeout(r, 200)); }
}
const client = new Client({ name: "health", version: "1" });
await client.connect(new StreamableHTTPClientTransport(new URL(`${HTTP}/mcp`)));
await client.callTool({ name: "join_room", arguments: { room: "health-room", name: "a", agent: "test" } });
const waiting = client.callTool({ name: "wait_for_messages", arguments: { room: "health-room", timeout_ms: 2000 } });
await new Promise((r) => setTimeout(r, 1200));

const file = join(dir, `hub-${PORT}.health.log`);
assert.ok(existsSync(file), "the health file exists");
const samples = readFileSync(file, "utf8").trim().split("\n").map((l) => JSON.parse(l));
assert.ok(samples.length >= 2, `a line per interval (${samples.length})`);
const s = samples.at(-1);
for (const k of ["ts", "pid", "uptime_s", "rss_mb", "heap_used_mb", "heap_total_mb", "loop_lag_ms", "sessions", "requests", "rooms_open", "participants_active", "waiting"]) assert.ok(k in s, `${k} in ${JSON.stringify(s)}`);
assert.equal(s.pid, server.pid);
assert.ok(s.rss_mb > 10 && s.rss_mb < 4000, `rss_mb ${s.rss_mb}`);
assert.equal(s.sessions, 1, "the one MCP session");
assert.equal(s.rooms_open, 1);
assert.equal(s.participants_active, 1);
assert.equal(s.waiting, 1, "the long-poll in flight");
assert.ok(typeof s.loop_lag_ms.p99 === "number" && typeof s.loop_lag_ms.max === "number");
// every request is counted, MCP tool calls included: this script made at least 5 (initialize, initialized, tools list
// or join, wait) before reading, plus GET / while starting
const counted = samples.reduce((n, x) => n + x.requests, 0);
assert.ok(counted >= 5, `HTTP requests counted across samples: ${counted}`);
await waiting;
await client.close();

// a stop: the exit line carries the last sample
server.kill("SIGTERM");
await new Promise((r) => server.once("exit", r));
const life = readFileSync(join(dir, `hub-${PORT}.lifecycle.log`), "utf8").trim().split("\n");
const exit = life.at(-1)!;
assert.match(exit, /exit pid=\d+ reason=SIGTERM/);
assert.match(exit, / last_health=\{"ts":"[^"]+","pid":\d+,.*"rss_mb":\d+/, exit);
console.log("hub-health-regression: ok");
process.exit(0);
