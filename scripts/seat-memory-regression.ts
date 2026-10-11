/**
 * Seat memory (swarm-003601-tky5, board evidence/seat-memory): in swarm-094251-5y46 three seats' scripts held 45.6, 22
 * and 8.9 GB on a 24 GB machine and nothing measured it. Now the hub samples what each seat's processes hold
 * (room_status memory, "memory" events in the room log) and, under CHATROOM_SEAT_MEMORY_MB, stops an over-budget
 * seat's largest process by PID and tells the seat (src/hub/memory.ts).
 * Part 1 is the rule on a made-up process table; part 2 is a real hub and real processes (a 400 MB one is stopped).
 * Throwaway hub on its own port (never 7717), stopped by pid; every process started here is stopped by pid.
 * Run: npx tsx scripts/seat-memory-regression.ts (PORT= to pin the throwaway hub's port)
 */
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { seatBeat } from "../src/env.js";
import { seatHash } from "../src/hub/liveness.js";
import { MemoryWatch, elapsedSeconds, memoryNotice, parseFootprints, parseTable, seatUsage, type MemoryEvent, type Proc } from "../src/hub/memory.js";
import { ownHubPort } from "./lib/own-hub.js";

// ---------- 1. the rule, on a made-up table ----------
assert.equal(elapsedSeconds("01:05"), 65);
assert.equal(elapsedSeconds("02:01:05"), 7265);
assert.equal(elapsedSeconds("3-02:01:05"), 3 * 86_400 + 7265);

const plain = [
  "  100     1 800000    02:00:00 claude -p brief",
  "  101   100  20000       10:00 /bin/zsh -c python3 pull.py",
  "  102     1 3000000      09:00 python3 pull.py --all",
  "  103   100 1000000      05:00 python3 small.py",
  "  200     1 500000    02:00:00 claude -p other",
  "  201     1 9000000      01:00 python3 theirs.py",
  "  300     1 9000000      01:00 Google Chrome Helper",
].join("\n");
const withEnv = [
  "  100 claude -p brief HOME=/x CHATROOM_SEAT_KEY=seat-key-AAAA PATH=/bin",
  "  102 python3 pull.py --all CHATROOM_SEAT_KEY=seat-key-AAAA",
  "  103 python3 small.py CHATROOM_SEAT_KEY=seat-key-AAAA",
  "  200 claude -p other CHATROOM_SEAT_KEY=seat-key-BBBB",
  "  201 python3 theirs.py CHATROOM_SEAT_KEY=seat-key-BBBB",
  "  300 Google Chrome Helper",
].join("\n");
const table = parseTable(plain, withEnv);
assert.equal(table.length, 7);
assert.equal(table.find((p) => p.pid === 102)!.key, "seat-key-AAAA", "a nohup child (parent 1) keeps its seat's key");
assert.equal(table.find((p) => p.pid === 101)!.key, null, "a system shell hides its env: not attributed");
assert.equal(table.find((p) => p.pid === 300)!.key, null);

const usage = seatUsage(table);
assert.equal(usage.get("seat-key-AAAA")!.agent.pid, 100, "the agent is the oldest process carrying the key");
assert.deepEqual(usage.get("seat-key-AAAA")!.own.map((p) => p.pid), [102, 103], "largest first, the agent excluded");
assert.equal(usage.get("seat-key-AAAA")!.kb, 4_000_000);
// footprint replaces resident size where it is larger (compressed or swapped pages)
assert.equal(seatUsage(table, new Map([[103, 6_000_000]])).get("seat-key-AAAA")!.own[0]!.pid, 103);
assert.deepEqual([...parseFootprints("PID    MEM  \n37096  2288K\n1      24M+ \n77     45G  \n78     512B\n")], [[37096, 2288], [1, 24 * 1024], [77, 45 * 1024 * 1024], [78, 1]]);

const A = seatHash("seat-key-AAAA"), B = seatHash("seat-key-BBBB");
const kills: [number, string][] = [];
const events: MemoryEvent[] = [];
let current: Proc[] = table;
let footprint = new Map<number, number>();
const watch = (budgetMb: number | undefined, watched = (s: string) => s === A || s === B) =>
  new MemoryWatch({ budgetMb, watched, table: async () => current, footprints: async () => footprint, kill: (pid, signal) => { kills.push([pid, signal]); }, onEvent: (e) => events.push(e) });

// no budget: measured, nothing stopped
const measuring = watch(undefined);
assert.deepEqual(await measuring.tick(), []);
assert.equal(measuring.get(A)!.mb, 3906);
assert.equal(measuring.get(A)!.agent_mb, 781);
assert.equal(measuring.get(A)!.top!.pid, 102);
assert.equal(measuring.get(A)!.budget_mb, null);
assert.deepEqual(kills, []);

// budget 5000 MB: seat A (3906 MB) is past 70% -> warned once; seat B (8789 MB) is over -> told first, stopped on the
// next sample if still over, and only its largest process
const w = watch(5000);
await w.tick();
assert.deepEqual(kills, [], "one sample over the budget is a warning with the number, not a stop");
assert.deepEqual(events.map((e) => [e.kind, e.seat === A ? "A" : "B"]), [["warn", "A"], ["over", "B"]]);
await w.tick();
assert.deepEqual(kills, [[201, "SIGTERM"]], "only the over-budget seat's own largest process; never Chrome (no key), never seat A's");
assert.deepEqual(events.map((e) => e.kind), ["warn", "over", "stop"]);
const [warn, over, stop] = events as [MemoryEvent, MemoryEvent, MemoryEvent];
await w.tick();
assert.deepEqual(kills, [[201, "SIGTERM"], [201, "SIGKILL"]], "still there a tick later: it ignored SIGTERM");
assert.equal(events.filter((e) => e.kind === "warn").length, 1, "one warning per episode, not one per tick");
// the process is gone: nothing more is stopped, and the seat reads as what is left
current = table.filter((p) => p.pid !== 201);
kills.length = 0;
await w.tick();
assert.deepEqual(kills, []);
assert.equal(w.get(B)!.mb, 0);
assert.equal(w.get(B)!.peak_mb, 8789, "the peak is kept");

// the agent itself is never stopped or counted, even when it is the seat's largest process
current = parseTable("  100     1 9000000    02:00:00 claude -p brief\n  103   100 600000       05:00 python3 small.py", withEnv);
kills.length = 0;
const tight = watch(500);
await tight.tick(); await tight.tick();
assert.deepEqual(kills, [[103, "SIGTERM"]]);
const agentOnly = watch(500);
current = parseTable("  100     1 9000000    02:00:00 claude -p brief", withEnv);
kills.length = 0; events.length = 0;
await agentOnly.tick(); await agentOnly.tick();
assert.deepEqual([kills, events], [[], []], "a seat whose only large process is its own agent is neither warned nor stopped");
assert.equal(agentOnly.get(A)!.agent_mb, 8789, "but its agent's size is reported");
// an idle process's pages are compressed or swapped within a minute: 11 MB resident, 2.9 GB footprint. It is still seen.
current = parseTable("  100     1 800000    02:00:00 claude -p brief\n  102     1 11008      09:00 python3 pull.py --all", withEnv);
footprint = new Map([[102, 3_000_000]]);
kills.length = 0; events.length = 0;
const idle = watch(1000);
await idle.tick();
assert.equal(idle.get(A)!.mb, 2930, "the footprint, not the 11 MB that is resident");
assert.deepEqual(events.map((e) => e.kind), ["over"]);
await idle.tick();
assert.deepEqual(kills, [[102, "SIGTERM"]]);
const measuringIdle = watch(undefined);
await measuringIdle.tick();
assert.equal(measuringIdle.get(A)!.mb, 2930, "with no budget the footprint is still read (every fourth tick, the first included)");
footprint = new Map();
// a warned process that ends by itself before the next check: the seat is told it ended, nothing is stopped
current = parseTable("  100     1 800000    02:00:00 claude -p brief\n  102     1 3000000      09:00 python3 pull.py --all", withEnv);
kills.length = 0; events.length = 0;
const nearMiss = watch(1000);
await nearMiss.tick();
current = parseTable("  100     1 800000    02:00:00 claude -p brief", withEnv);
await nearMiss.tick();
await nearMiss.tick();
assert.deepEqual([kills, events.map((e) => e.kind)], [[], ["over", "ended"]], "over, then ended by itself; told once");
assert.match(memoryNotice(events[1]!), /pid 102 .*ended by itself.*Nothing was stopped/);
// the notice names the script, not the interpreter's install path
const longExe = "/opt/homebrew/Cellar/python@3.14/3.14.7/Frameworks/Python.framework/Versions/3.14/Resources/Python.app/Contents/MacOS/Python /tmp/rc5-dev/naive-claude-opus-5-5-2.py --all";
const shown = memoryNotice({ kind: "over", seat: A, mb: 1300, budget_mb: 600, top: { pid: 7, mb: 1208, command: longExe } });
assert.match(shown, /pid 7 \(1208 MB\): Python \/tmp\/rc5-dev\/naive-claude-opus-5-5-2\.py --all\./);
const longArgs = memoryNotice({ kind: "over", seat: A, mb: 1300, budget_mb: 600, top: { pid: 7, mb: 1208, command: `python3 -c ${"x = 1; ".repeat(40)}print(done_marker)` } });
assert.match(longArgs, /python3 -c x = 1;.*….*print\(done_marker\)\./, "a long command keeps its start and its end");
// over budget only through many small processes: no single one is worth stopping (floor: 10% of the budget)
current = parseTable([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((i) => `  ${400 + i}     1  90000      01:00 python3 rec${i}.py`).join("\n") + "\n  100     1 1000    02:00:00 claude -p brief", [...[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((i) => `  ${400 + i} python3 rec${i}.py CHATROOM_SEAT_KEY=seat-key-AAAA`), "  100 claude CHATROOM_SEAT_KEY=seat-key-AAAA"].join("\n"));
kills.length = 0;
const floor = watch(1000);
await floor.tick(); await floor.tick();
assert.deepEqual(kills, [], "twelve 88 MB recorders over a 1000 MB budget: none is stopped");
// a key no active participant of this hub holds (a finished room's recorder, a respawned seat's old script, another
// hub's seat): measured and reported as unattributed, never signalled, however large
current = table;
kills.length = 0;
const orphanWatch = watch(1000, (s) => s === A);
await orphanWatch.tick(); await orphanWatch.tick();
assert.deepEqual(kills, [[102, "SIGTERM"]], "seat A's own largest only; seat B's 8.6 GB script is not this hub's seat");
assert.equal(orphanWatch.unattributed().processes, 2);
assert.equal(orphanWatch.unattributed().top[0]!.pid, 201);
assert.equal(orphanWatch.unattributed().mb, 8789 + 488);

assert.match(memoryNotice(stop), /held 8789 MB, over your 5000 MB budget.*stopped your largest one \(SIGTERM\): pid 201 \(8789 MB\): python3 theirs\.py/);
assert.match(memoryNotice(stop), /SET memory_limit='2816MB'; SET threads=2;/, "the exact setting, sized from the budget");
assert.match(memoryNotice(stop, "Helper: kit/tools/lab_duckdb.py"), /Helper: kit\/tools\/lab_duckdb\.py$/);
assert.match(memoryNotice(over), /hold 8789 MB, over your 5000 MB budget.*will be stopped at the next check/);
assert.match(memoryNotice(warn), /hold 3906 MB of your 5000 MB budget/);

// the budget reaches a seat's env when the hub or launcher has one, and only then
assert.equal(seatBeat("http://127.0.0.1:1/mcp", "seat-key-AAAA").env.CHATROOM_SEAT_MEMORY_MB, undefined);
process.env.CHATROOM_SEAT_MEMORY_MB = "3000";
assert.equal(seatBeat("http://127.0.0.1:1/mcp", "seat-key-AAAA").env.CHATROOM_SEAT_MEMORY_MB, "3000");
delete process.env.CHATROOM_SEAT_MEMORY_MB;
console.log("rule OK");

// ---------- 2. a real hub and real processes ----------
const PORT = await ownHubPort(Number(process.env.PORT ?? 20_000 + Math.floor(Math.random() * 20_000)));
assert.notEqual(PORT, 7717, "never the live hub");
const HTTP = `http://127.0.0.1:${PORT}`;
const DATA = mkdtempSync(join(tmpdir(), "seat-memory-"));
const started: ChildProcess[] = [];
const BUDGET = 300;
const server: ChildProcess = spawn("npx", ["tsx", "src/index.ts"], { env: { ...process.env, PORT: String(PORT), CHATROOM_SPAWN_DRY: "1", CHATROOM_INSECURE_LOCAL: "1", CHATROOM_DATA_DIR: DATA, CHATROOM_SEAT_MEMORY_MB: String(BUDGET), CHATROOM_MEMORY_WATCH_MS: "500" }, stdio: ["ignore", "ignore", "inherit"] });
started.push(server);
// npx forwards SIGTERM to the hub it started and cannot forward SIGKILL
const stopAll = () => { for (const c of started) { try { c.kill(c === server ? "SIGTERM" : "SIGKILL"); } catch { /* gone */ } } };
process.on("exit", stopAll);
for (let i = 0; ; i++) {
  try { await fetch(`${HTTP}/`); break; } catch { if (i > 100) throw new Error("hub did not start"); await new Promise((r) => setTimeout(r, 200)); }
}
async function connect(url: string) {
  const client = new Client({ name: "mem", version: "0.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(url)));
  return async (tool: string, args: Record<string, unknown> = {}) => {
    const res = (await client.callTool({ name: tool, arguments: args })) as { isError?: boolean; content: { text: string }[] };
    if (res.isError) throw new Error(`${tool}: ${res.content[0]?.text}`);
    try { return JSON.parse(res.content[0]?.text ?? ""); } catch { return res.content[0]?.text; }
  };
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const alive = (c: ChildProcess) => c.exitCode === null && c.signalCode === null;
/** A process of one seat: holds `mb` of touched memory and waits. */
const proc = (key: string, mb: number, tag: string) => {
  const c = spawn(process.execPath, ["-e", `const b = Buffer.alloc(${mb} * 1048576, 1); setInterval(() => b[0], 1000); /* ${tag} */`], { env: { PATH: process.env.PATH ?? "", CHATROOM_SEAT_KEY: key }, stdio: "ignore" });
  started.push(c);
  return c;
};

const keyA = `mem-test-${PORT}-AAAA`, keyB = `mem-test-${PORT}-BBBB`;
const a = await connect(seatBeat(`${HTTP}/mcp`, keyA).mcpUrl);
const b = await connect(seatBeat(`${HTTP}/mcp`, keyB).mcpUrl);
const me = await a("join_room", { room: "mem", name: "builder", agent: "claude", expected_participants: 0 });
await b("join_room", { room: "mem", name: "peer", agent: "claude" });

const agentA = proc(keyA, 1, "agent-a"); // the oldest process with the key stands in for the seat's agent
const agentB = proc(keyB, 1, "agent-b");
await sleep(2100); // ps prints elapsed time in whole seconds: the agents must be older than what they "start"
const peerJob = proc(keyB, 60, "peer-job");
const small = proc(keyA, 40, "small-job");
const hog = proc(keyA, 400, "hog");

for (let i = 0; alive(hog); i++) { assert.ok(i < 150, "the over-budget process was not stopped within 30 s"); await sleep(200); }
assert.equal(hog.signalCode, "SIGTERM", "stopped by signal, by the hub");
await sleep(4000); // two more ticks (a tick reads the footprint with top, about a second): nothing else goes
assert.ok(alive(agentA), "the seat's agent process is never stopped");
assert.ok(alive(small), "only the largest process of the over-budget seat");
assert.ok(alive(peerJob) && alive(agentB), "another seat's processes are untouched");

type Person = { name: string; memory?: { mb: number; peak_mb: number; budget_mb: number | null; top?: unknown } };
// the figure after the stop is the next completed tick's; a tick reads top (about a second, more under load)
const builderNow = async () => ((await (await fetch(`${HTTP}/rooms/mem`)).json()) as { participants: Person[] }).participants.find((p) => p.name === "builder")!;
let builder = await builderNow();
for (let i = 0; (builder.memory?.mb ?? 0) >= BUDGET && i < 75; i++) { await sleep(200); builder = await builderNow(); }
assert.ok(builder.memory, "the dashboard shows the seat's memory");
assert.ok(builder.memory.peak_mb >= BUDGET, `peak ${builder.memory.peak_mb} MB`);
assert.ok(builder.memory.mb < BUDGET, `after the stop ${JSON.stringify(builder.memory)}`);
assert.equal(builder.memory.budget_mb, BUDGET);
const mine = ((await a("room_status", { room: "mem" })) as { participants: Person[] }).participants.find((p) => p.name === "builder")!;
assert.deepEqual(Object.keys(mine.memory ?? {}).sort(), ["budget_mb", "mb", "peak_mb"], "a seat's room_status carries the three figures, not the process list");

// said in the room, addressed to the seat, with the number and the process
const log = (await a("read_messages", { room: "mem", participant_id: me.participant_id, since_seq: 0 })) as string[];
const said = log.find((l) => /MEMORY: the processes you started held/.test(l));
assert.ok(said, `no memory notice in the room: ${JSON.stringify(log)}`);
assert.match(said, new RegExp(`@builder MEMORY: .*over your ${BUDGET} MB budget.*pid ${hog.pid} `));
assert.ok(!log.some((l) => /@peer MEMORY/.test(l)), "the peer is told nothing");

// and handed to the seat's tool hook mid-turn; once acked it is not handed over again
const beat = async (key: string) => ((await (await fetch(`${HTTP}/heartbeat`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ seat_key: key, peek: true }) })).json()) as { pending: { id: string; text: string }[] }).pending;
const pending = (await beat(keyA)).filter((m) => /^MEMORY:/.test(m.text));
assert.ok(pending.length >= 1, "the notice is pending for the seat's hook");
assert.equal((await beat(keyB)).filter((m) => /^MEMORY:/.test(m.text)).length, 0);
await fetch(`${HTTP}/steer/ack`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ seat_key: keyA, ids: pending.map((m) => m.id) }) });
assert.equal((await beat(keyA)).filter((m) => /^MEMORY:/.test(m.text)).length, 0);

// a tagged process whose seat has left is reported hub-wide and outlives every tick
const keyGone = `mem-test-${PORT}-GONE`;
const c = await connect(seatBeat(`${HTTP}/mcp`, keyGone).mcpUrl);
await c("join_room", { room: "mem", name: "leaver", agent: "claude" });
await c("leave_room", { room: "mem", reason: "done: nothing left undone here" });
const orphan = proc(keyGone, 400, "orphan");
await sleep(5000);
assert.ok(alive(orphan), "a process of a seat that left is never stopped, even over the budget");
type HubWide = { budget_mb: number; unattributed: { top: { pid: number; mb: number }[] } };
let hubWide = (await (await fetch(`${HTTP}/memory`)).json()) as HubWide;
// other hubs' seats on this machine are unattributed here too: wait for a tick that has seen the orphan
for (let i = 0; !hubWide.unattributed.top.some((p) => p.pid === orphan.pid) && i < 75; i++) { await sleep(200); hubWide = (await (await fetch(`${HTTP}/memory`)).json()) as HubWide; }
assert.equal(hubWide.budget_mb, BUDGET);
assert.match((hubWide as HubWide & { unattributed_is?: string }).unattributed_is ?? "", /not this hub's seats/);
assert.ok(hubWide.unattributed.top.some((p) => p.pid === orphan.pid && p.mb >= 350), JSON.stringify(hubWide));

// telemetry: the room log has the samples and the stop
const events2 = readdirSync(DATA).filter((f) => f.endsWith(".jsonl")).flatMap((f) => readFileSync(join(DATA, f), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as { type: string; event?: string; top?: { pid: number }; memory?: { mb: number } }));
assert.ok(events2.some((e) => e.type === "memory" && e.event === "stop" && e.top?.pid === hog.pid), "the stop is in the room log");
assert.ok(events2.some((e) => e.type === "memory" && e.memory && e.memory.mb >= BUDGET), "so is a sample over the budget");

stopAll();
console.log("seat-memory-regression OK");
process.exit(0);
