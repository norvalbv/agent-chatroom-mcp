/**
 * Live usage (swarm-082539-kns2, telemetry). A claude seat's tokens and cost were known only from `claude -p
 * --output-format json` at exit, so round 1's crashed launcher left usage coverage "none", and a recruit the hub
 * spawned never reported usage anywhere. Claude Code exports one `claude_code.api_request` OTLP log record per API
 * call, with tokens and cost_usd; a probe summed them to the CLI's exit total_cost_usd exactly (board
 * sources/claude-code-otel). seatBeat now points a seat's OTLP log exporter at the hub with its seat key in a header;
 * the hub keeps cumulative usage per seat, serves it as participants[].usage, and writes it to the room log so a
 * restarted hub or a dead launcher still has it.
 * Throwaway hub on its own port (never 7717), stopped by pid.
 * Run: npx tsx scripts/live-usage-regression.ts (PORT= to pin the throwaway hub's port)
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { seatBeat } from "../src/env.js";
import { collectRoomSnapshot, hubUsageRollup, renderRunReport, seatScorecard, type RunResult } from "../src/result.js";

const PORT = Number(process.env.PORT ?? 20_000 + Math.floor(Math.random() * 20_000));
assert.notEqual(PORT, 7717, "never the live hub");
let HTTP = `http://127.0.0.1:${PORT}`;
const DATA = mkdtempSync(join(tmpdir(), "live-usage-"));
const startHub = (port = PORT) => spawn("npx", ["tsx", "src/index.ts"], { env: { ...process.env, PORT: String(port), CHATROOM_SPAWN_DRY: "1", CHATROOM_LOG_DIR: join(DATA, "spawn"), CHATROOM_INSECURE_LOCAL: "1", CHATROOM_DATA_DIR: DATA }, stdio: ["ignore", "ignore", "inherit"] });
const server = startHub();
process.on("exit", () => server.kill());
const up = async () => {
  for (let i = 0; ; i++) {
    try { await fetch(`${HTTP}/`); return; } catch { if (i > 100) throw new Error("hub did not start"); await new Promise((r) => setTimeout(r, 200)); }
  }
};
await up();

async function connect(url: string) {
  const client = new Client({ name: "lu", version: "0.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(url)));
  return async (tool: string, args: Record<string, unknown> = {}) => {
    const res = (await client.callTool({ name: tool, arguments: args })) as { isError?: boolean; content: { text: string }[] };
    if (res.isError) throw new Error(`${tool}: ${res.content[0]?.text}`);
    try { return JSON.parse(res.content[0]?.text ?? ""); } catch { return res.content[0]?.text; }
  };
}
type Usage = { requests: number; input_tokens: number; output_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number; cost_usd: number; by_model: Record<string, { requests: number; cost_usd: number }> };
type Status = { participants: { name: string; usage?: Usage }[]; usage?: Usage & { seats: number } };
const status = async (room: string) => (await (await fetch(`${HTTP}/rooms/${room}`)).json()) as Status;

// 1. A seat's env sends Claude Code's OTLP logs to its hub, keyed by its seat key (nothing in the URL a peer reads).
const seat = seatBeat(`${HTTP}/mcp`, "seat-key-spender");
const env = seat.env as Record<string, string>;
assert.equal(env.CLAUDE_CODE_ENABLE_TELEMETRY, "1");
assert.equal(env.OTEL_LOGS_EXPORTER, "otlp");
assert.equal(env.OTEL_EXPORTER_OTLP_LOGS_PROTOCOL, "http/json");
assert.equal(env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT, `${HTTP}/otlp/v1/logs`);
assert.equal(env.OTEL_EXPORTER_OTLP_LOGS_HEADERS, "x-chatroom-seat-key=seat-key-spender");
// a killed seat loses its unflushed batch: 1 s, not the 5 s default (probe: 3 of 8 calls lost at 5 s, 0 of 5 at 1 s)
assert.equal(env.OTEL_LOGS_EXPORT_INTERVAL, "1000");

// The shape a real claude 2.1.294 seat posted (probe on :7811): resource, scope, one record per event.
const attr = (key: string, v: string | number) => ({ key, value: typeof v === "number" ? (Number.isInteger(v) ? { intValue: v } : { doubleValue: v }) : { stringValue: v } });
const apiRequest = (id: string, model: string, input: number, output: number, cacheRead: number, cacheCreation: number, cost: number) => ({
  body: { stringValue: "claude_code.api_request" },
  attributes: [attr("event.name", "api_request"), attr("session.id", "s1"), attr("model", model), attr("input_tokens", input), attr("output_tokens", output),
    attr("cache_read_tokens", cacheRead), attr("cache_creation_tokens", cacheCreation), attr("cost_usd", cost), attr("request_id", id), attr("query_source", "sdk")],
});
const other = { body: { stringValue: "claude_code.tool_result" }, attributes: [attr("event.name", "tool_result"), attr("tool_name", "Bash")] };
const batch = (...records: unknown[]) => ({ resourceLogs: [{ resource: { attributes: [attr("service.name", "claude-code")] }, scopeLogs: [{ scope: { name: "com.anthropic.claude_code.events" }, logRecords: records }] }] });
const post = (key: string | undefined, body: unknown) =>
  fetch(env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT, { method: "POST", headers: { "content-type": "application/json", ...(key ? { "x-chatroom-seat-key": key } : {}) }, body: JSON.stringify(body) });

const a = await connect(seat.mcpUrl);
const b = await connect(seatBeat(`${HTTP}/mcp`, "seat-key-quiet").mcpUrl);
await a("join_room", { room: "lu", name: "spender", agent: "claude", expected_participants: 0, require_challenge: false });
await b("join_room", { room: "lu", name: "quiet", agent: "claude" });
await a("join_room", { room: "lu-group", name: "spender", agent: "claude", expected_participants: 0 });

// 2. api_request records add up per seat; other events are ignored; a retried batch (same request_id) counts once.
let res = await post("seat-key-spender", batch(apiRequest("req_1", "claude-haiku-5-5", 1173, 14, 0, 0, 0.0001243), other));
assert.equal(res.status, 200);
res = await post("seat-key-spender", batch(apiRequest("req_2", "claude-sonnet-5-5", 2, 4, 11343, 15890, 0.0658726)));
assert.equal(res.status, 200);
await post("seat-key-spender", batch(apiRequest("req_2", "claude-sonnet-5-5", 2, 4, 11343, 15890, 0.0658726)));
let st = await status("lu");
const u = st.participants.find((p) => p.name === "spender")?.usage;
assert.ok(u, "participants[].usage is served");
assert.equal(u.requests, 2);
assert.equal(u.input_tokens, 1175);
assert.equal(u.output_tokens, 18);
assert.equal(u.cache_read_input_tokens, 11343);
assert.equal(u.cache_creation_input_tokens, 15890);
assert.equal(Math.round(u.cost_usd * 1e7), 659969, "the probe's exit total_cost_usd, 0.0659969");
assert.deepEqual(Object.keys(u.by_model).sort(), ["claude-haiku-5-5", "claude-sonnet-5-5"]);
assert.equal(st.participants.find((p) => p.name === "quiet")?.usage, undefined, "a seat that reported nothing is unknown, not zero");
assert.equal(st.usage?.seats, 1);
assert.equal(Math.round((st.usage?.cost_usd ?? 0) * 1e7), 659969, "room total");
// one process in two rooms: the same cumulative figure in each, never summed twice within a room
assert.equal((await status("lu-group")).participants.find((p) => p.name === "spender")?.usage?.requests, 2);

// 3. No seat key, no record; an unknown key is never shown on anyone.
assert.equal((await post(undefined, batch(apiRequest("req_x", "m", 1, 1, 0, 0, 9)))).status, 401);
await post("seat-key-stranger", batch(apiRequest("req_y", "m", 1, 1, 0, 0, 9)));
st = await status("lu");
assert.equal(st.usage?.seats, 1);
assert.equal(st.participants.find((p) => p.name === "quiet")?.usage, undefined);
// garbage bodies are refused without touching the ledger
assert.equal((await post("seat-key-spender", { nope: true })).status, 200);
assert.equal((await status("lu")).participants.find((p) => p.name === "spender")?.usage?.requests, 2);

// 3b. The model name is the seat's own text: "__proto__" must not reach Object.prototype (review by -2). It is counted
// under its own name in a prototype-free map, and nothing else in the hub process changes.
await post("seat-key-spender", batch(apiRequest("req_p1", "__proto__", 1, 1, 0, 0, 0), apiRequest("req_p2", "constructor", 1, 1, 0, 0, 0)));
assert.equal(({} as Record<string, unknown>).requests, undefined, "Object.prototype untouched in this process");
const hubSide = (await status("lu")).participants.find((p) => p.name === "spender")?.usage;
assert.equal(hubSide?.requests, 4);
assert.equal(hubSide?.by_model?.["__proto__"]?.requests, 1);
assert.equal(hubSide?.by_model?.["constructor"]?.requests, 1);
assert.equal((await status("lu")).usage?.requests, 4, "the hub's own objects still add up (a polluted prototype turns them NaN)");
// in process too, the way the hub calls it, and again after a replay restore
{
  const { UsageLedger, apiRequests } = await import("../src/hub/usage.js");
  const l = new UsageLedger();
  l.add("s", apiRequests(batch(apiRequest("r1", "__proto__", 1, 1, 0, 0, 1))), "t");
  const back = new UsageLedger();
  back.restore("s", JSON.parse(JSON.stringify(l.get("s"))));
  back.add("s", apiRequests(batch(apiRequest("r2", "__proto__", 1, 1, 0, 0, 1))), "t");
  assert.equal(back.get("s")?.by_model["__proto__"]?.requests, 2);
  assert.equal(({} as Record<string, unknown>).requests, undefined, "no pollution after a restore either");
}

// 4. The room log keeps the cumulative figure with its time, keyed by the seat's key hash (never the key itself).
const logged = readFileSync(join(DATA, "lu.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as { type: string; seat?: string; usage?: Usage; ts?: string });
const usageEvents = logged.filter((e) => e.type === "usage");
assert.ok(usageEvents.length >= 1);
assert.equal(usageEvents.at(-1)?.usage?.requests, 4);
assert.ok(usageEvents.every((e) => e.ts && e.seat && !readFileSync(join(DATA, "lu.jsonl"), "utf8").includes("seat-key-spender")));

// 5. A hub started from the log has the usage, and later records add to it rather than restart from zero.
HTTP = `http://127.0.0.1:${PORT + 1}`;
const second = startHub(PORT + 1);
process.on("exit", () => second.kill());
await up();
st = await status("lu");
assert.equal(st.participants.find((p) => p.name === "spender")?.usage?.requests, 4, "usage survives a restart");
await fetch(`${HTTP}/otlp/v1/logs`, { method: "POST", headers: { "content-type": "application/json", "x-chatroom-seat-key": "seat-key-spender" }, body: JSON.stringify(batch(apiRequest("req_3", "claude-sonnet-5-5", 2, 100, 27000, 300, 0.02))) });
st = await status("lu");
assert.equal(st.participants.find((p) => p.name === "spender")?.usage?.requests, 5);
assert.equal(Math.round((st.participants.find((p) => p.name === "spender")?.usage?.cost_usd ?? 0) * 1e7), 859969);

// 6. The run report reads it from the snapshots alone: a seat with no launcher receipt (a recruit, a crashed launcher)
// gets the hub's cost, marked so; a seat in two rooms is one process, counted once.
const snaps = [await collectRoomSnapshot(HTTP, "lu"), await collectRoomSnapshot(HTTP, "lu-group")];
const card = seatScorecard(snaps, { quiet: { cost: 1.5 } });
const spender = card.find((s) => s.name === "spender");
assert.equal(spender?.costSource, "hub");
assert.equal(spender?.requests, 5);
assert.equal(Math.round((spender?.cost ?? 0) * 1e7), 859969);
assert.equal(card.find((s) => s.name === "quiet")?.costSource, "launcher", "the launcher's exit figure wins where it exists");
const rollup = hubUsageRollup(snaps);
assert.equal(rollup?.seats, 1, "one process across two rooms");
assert.equal(rollup?.requests, 5);
const report = renderRunReport({ schemaVersion: 1, run: { id: "r", startedAt: "", completedAt: "", task: "t", doneWhen: "d" }, project: { cwd: "", canonicalPath: "", git: null }, leadRoom: "lu",
  rooms: snaps, verifier: { name: "verifier", output: null }, reportPath: "", artifactPath: "", hubUsage: rollup, scorecard: card } as RunResult);
assert.match(report, /## Usage\n\nSeat-reported to the hub \(live OTLP, every seat incl\. recruits\): \$0\.0860 over 5 model calls by 1 seat\(s\)/);
assert.match(report, /\| spender \|[^\n]*\$0\.09 \(hub\)/);

console.log("LIVE USAGE OK");
process.exit(0);
