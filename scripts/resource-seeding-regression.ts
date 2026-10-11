/** Resources a run is launched with reach every room's board before any seat joins. In the devkit room
 * (swarm-234901-pmyh) nine seats made 553 tool calls over 44 minutes without once opening the project's own telemetry
 * file, because the brief's data list did not name it; first use came 9 s after the chair relayed the path. In the
 * Polymarket room (swarm-094251-5y46) 10 of 24 "this exists at path P / this limit applies" announcements stayed in
 * chat, all three rate limits among them (evidence/data-not-found). The next rooms run as sibling group rooms that do
 * not read each other's chat and are launched with --no-carry, so nothing but the board each seat is handed reaches
 * all of them.
 * `swarm --resources <file>`: each `## <name>` heading in the file is one resource, written as resource/<slug> to the
 * board of every room of the run before a seat is started. A room nobody has created yet (a group room is created by
 * its first join) holds them and gets them at creation. A missing file, or one with no `## ` entry, stops the launch.
 * resource/ is a reserved board prefix, and the hub names a room's resource/* keys to every seat when it joins (one
 * line, its own field in the join_room reply) and in a recruit's orientation, so nobody has to know to look. A
 * break-out room starts with its parent's resource/* entries. No prompt file is changed.
 * The record says who read what: call_completion for board_get carries the key (it did not, so no record could say
 * which seat ever read a resource entry; seats made 5 to 69 board_get calls each against 216 keys).
 * npx tsx scripts/resource-seeding-regression.ts */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Hub, HubError } from "../src/hub.js";
import { createSessionServer } from "../src/server.js";
import { loadResources, parseResources, seedResources } from "../src/resources.js";
import { Spawner } from "../src/spawner.js";

Hub.DEFAULT_NUDGE_MS = 0;
const dir = mkdtempSync(join(tmpdir(), "resource-seeding-"));
const hub = new Hub({ dataDir: dir });
async function seat(name: string, h: Hub = hub) {
  const session = createSessionServer(h);
  const client = new Client({ name, version: "1" });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await session.server.connect(st); await client.connect(ct);
  const call = async (tool: string, args: Record<string, unknown>) => {
    const r = await client.callTool({ name: tool, arguments: args });
    return { error: !!r.isError, text: (r.content as { text: string }[])[0]?.text ?? "" };
  };
  return { call };
}

// 1. the file: one resource per "## " heading; the preamble above the first heading is not a resource
const MD = [
  "# Data, tools and limits already on this machine",
  "",
  "Not a complete list.",
  "",
  "## Shared request budget",
  "Every seat is behind one IP address.",
  "Use `/tmp/kit/netbudget.py`.",
  "",
  "### a sub-heading stays inside its entry",
  "",
  "## polymarket API limits (per IP)",
  "data-api: /trades 200 per 10 s.",
  "## empty one",
  "",
  "## Shared request budget",
  "a second entry of the same name",
].join("\n");
const parsed = parseResources(MD);
assert.deepEqual(parsed.map((r) => r.key), ["resource/shared-request-budget", "resource/polymarket-api-limits-per-ip", "resource/shared-request-budget-2"], "keys are resource/<slug of the heading>; a heading with no text is dropped; a repeated name is numbered");
assert.equal(parsed[0]!.text, "Shared request budget\nEvery seat is behind one IP address.\nUse `/tmp/kit/netbudget.py`.\n\n### a sub-heading stays inside its entry", "an entry is its name, then the text under the heading");
assert.deepEqual(parseResources("# title\n\nno entries here\n"), [], "no ## heading, no resources");
assert.equal(parseResources(`## ${"x".repeat(200)}\nbody`)[0]!.key.length <= 80, true, "a long name still makes a valid board key");
assert.equal(parseResources(`## big\n${"y".repeat(9000)}`)[0]!.text.length <= 8000, true, "an entry over the board cap is cut to it");
assert.match(parseResources(`## big\n${"y".repeat(9000)}`)[0]!.text, /cut at the board cap/, "and says it was cut");

// a missing or empty file is an error at launch, never a silent no-op
assert.throws(() => loadResources(join(dir, "absent.md")), /--resources.*absent\.md.*cannot be read/s, "a missing file is refused, naming it");
writeFileSync(join(dir, "empty.md"), "# only a title\n\nand prose\n");
assert.throws(() => loadResources(join(dir, "empty.md")), /--resources.*empty\.md.*no "## <name>" entry/s, "a file with no entry is refused");
writeFileSync(join(dir, "ok.md"), MD);
assert.equal(loadResources(join(dir, "ok.md")).length, 3, "a good file loads");

// 2. the hub: an existing room gets them at once, with no chat line per entry (a seat is told on joining, part 2)
const a = await seat("a");
const joined = JSON.parse((await a.call("join_room", { room: "res-flat", name: "A", agent: "test" })).text) as { participant_id: string };
const before = hub.getRoom("res-flat").messages.length;
const set = hub.seedResources("res-flat", parsed);
assert.deepEqual(set, { room: "res-flat", keys: parsed.map((r) => r.key), pending: false });
assert.equal(hub.getRoom("res-flat").messages.length, before, "seeding posts nothing to chat");
const got = JSON.parse((await a.call("board_get", { room: "res-flat", key: "resource/shared-request-budget", participant_id: joined.participant_id })).text) as { text: string; by: string };
assert.equal(got.text, parsed[0]!.text);
assert.equal(got.by, "launcher", "the entry is the launcher's, not a seat's");

// a room nobody has created yet: held, then on its board the moment it is created, before the first seat's join returns
assert.deepEqual(hub.seedResources("res-group", parsed), { room: "res-group", keys: parsed.map((r) => r.key), pending: true });
assert.equal(hub.listRooms().some((r) => r.name === "res-group"), false, "seeding does not create the room: its first join decides its policy");
const b = await seat("b");
await b.call("join_room", { room: "res-group", name: "B", agent: "test" });
assert.deepEqual([...hub.getRoom("res-group").board.keys()].filter((k) => k.startsWith("resource/")), parsed.map((r) => r.key), "held resources are on the board at creation");

// refused, not half-applied: a key outside resource/, an empty list, a finished room
assert.throws(() => hub.seedResources("res-flat", [{ key: "claim/x", text: "mine" }]), HubError, "only resource/* keys");
assert.throws(() => hub.seedResources("res-flat", []), HubError, "an empty list is refused");
assert.throws(() => hub.seedResources("res-flat", [{ key: "resource/ok", text: "fine" }, { key: "resource/too-big", text: "z".repeat(8001) }]), HubError);
assert.equal(hub.getRoom("res-flat").board.has("resource/ok"), false, "one bad entry writes none");
hub.closeRoom("res-flat", "human");
assert.throws(() => hub.seedResources("res-flat", parsed), HubError, "a closed room takes no resources");

// they survive a hub restart (a long room's hub was restarted once already)
const replayed = new Hub({ dataDir: dir });
assert.equal(replayed.getRoom("res-group").board.get("resource/shared-request-budget")?.text, parsed[0]!.text, "seeded entries replay from the room log");

// 3. the launcher's call: every room of the run, awaited; a hub that refuses is an error, not a shrug
const posted: { url: string; body: unknown; token: string | null }[] = [];
const okFetch = (async (url: string | URL | Request, init?: RequestInit) => {
  posted.push({ url: String(url), body: JSON.parse(String(init?.body)), token: new Headers(init?.headers).get("x-chatroom-token") });
  return new Response(JSON.stringify({ pending: String(url).includes("-g1") }), { status: String(url).includes("-g1") ? 202 : 200 });
}) as typeof fetch;
const lines = await seedResources("http://127.0.0.1:1", ["run-g1", "run-leads"], parsed, { token: "t0k", fetch: okFetch });
assert.deepEqual(posted.map((p) => p.url), ["http://127.0.0.1:1/rooms/run-g1/resources", "http://127.0.0.1:1/rooms/run-leads/resources"]);
assert.deepEqual(posted[0]!.body, { entries: parsed });
assert.equal(posted[0]!.token, "t0k");
assert.equal(lines.length, 2, "one log line per room");
assert.match(lines[0]!, /run-g1.*3 resource.*held until/);
const oldHub = (async () => new Response("Cannot POST", { status: 404 })) as typeof fetch;
await assert.rejects(seedResources("http://127.0.0.1:1", ["run-leads"], parsed, { fetch: oldHub }), /run-leads.*404.*--resources/s, "a hub without the route stops the launch and says why");

// 4. a seat is told on joining: the keys, one line, in a field of its own (the hint is replaced when a human is waiting)
const told = (text: string) => (JSON.parse(text) as { resources?: string }).resources;
const KEYS = parsed.map((r) => r.key);
const c = await seat("c");
const cJoin = await c.call("join_room", { room: "res-group", name: "C", agent: "test" });
assert.equal(typeof told(cJoin.text), "string", "join_room names the room's resources");
for (const k of KEYS) assert.ok(told(cJoin.text)!.includes(k), `the line names ${k}`);
assert.equal(told(cJoin.text)!.includes("\n"), false, "one line");
assert.match(told(cJoin.text)!, /board_get/, "and says how to read one");
assert.match(told(cJoin.text)!, /board_set.*resource\/<name>/, "and where to put the next one a seat finds");
assert.equal(cJoin.text.indexOf('"resources"') < cJoin.text.indexOf('"room"'), true, "ahead of the room summary, not after it");
// the first seat of a held room is told too: the entries are written before its join returns
const d = await seat("d");
hub.seedResources("res-late", parsed);
assert.ok(told((await d.call("join_room", { room: "res-late", name: "D", agent: "test" })).text)?.includes(KEYS[0]!), "the seat whose join creates the room is told");
// a room with none says nothing, and a cleared entry is no longer named
const e = await seat("e");
const eJoin = JSON.parse((await e.call("join_room", { room: "res-none", name: "E", agent: "test" })).text) as { participant_id: string; resources?: string };
assert.equal(eJoin.resources, undefined, "no resources, no line");
// a seat's own resource/* write is named to the next seat to join: the prefix is the registry, not only the launcher's
await e.call("board_set", { room: "res-none", key: "resource/found-by-e", text: "gateway.example refuses above 5 requests a second from this IP", participant_id: eJoin.participant_id });
const f = await seat("f");
assert.ok(told((await f.call("join_room", { room: "res-none", name: "F", agent: "test" })).text)?.includes("resource/found-by-e"), "a seat-written resource is named to later joiners");
await e.call("board_set", { room: "res-none", key: "resource/found-by-e", text: "", participant_id: eJoin.participant_id });
const g = await seat("g");
assert.equal(told((await g.call("join_room", { room: "res-none", name: "G", agent: "test" })).text), undefined, "a deleted resource is not named");
// many resources: the line stays short and says how many it left out
hub.seedResources("res-many", Array.from({ length: 30 }, (_, i) => ({ key: `resource/item-${String(i).padStart(2, "0")}`, text: `thing ${i}` })));
const h = await seat("h");
const many = told((await h.call("join_room", { room: "res-many", name: "H", agent: "test" })).text)!;
assert.ok(many.includes("resource/item-00") && !many.includes("resource/item-29"), "the first keys are named");
assert.match(many, /and 10 more/, "the rest are counted");

// the tool description says what the prefix is for (the prompts are not changed)
const tools = await (async () => { const session = createSessionServer(hub); const client = new Client({ name: "t", version: "1" }); const [ct, st] = InMemoryTransport.createLinkedPair(); await session.server.connect(st); await client.connect(ct); return (await client.listTools()).tools; })();
const keyDesc = (tools.find((t) => t.name === "board_set")!.inputSchema as unknown as { properties: { key: { description: string } } }).properties.key.description;
assert.ok(keyDesc.includes("resource/<name> (data, a tool or a limit that exists on this machine, with where it is and who shares it"), "board_set names the resource/ prefix");

// 5. a break-out starts with its parent's resources (chat and briefs do not cross a room wall; the machine is the same)
const child = JSON.parse((await c.call("join_room", { room: "res-group-brk", name: "C", agent: "test", parent: "res-group" })).text) as { resources?: string };
assert.deepEqual([...hub.getRoom("res-group-brk").board.keys()].filter((k) => k.startsWith("resource/")), KEYS, "a break-out's board starts with the parent's resource/* entries");
assert.ok(child.resources?.includes(KEYS[0]!), "and its opener is told");
assert.equal(hub.getRoom("res-group-brk").board.get(KEYS[0]!)?.by, "launcher", "authorship is kept");

// 6. a recruit's orientation names them: its brief is written by a seat, not by the launcher
const logDir = mkdtempSync(join(tmpdir(), "resource-recruit-"));
const sp = new Spawner({ logDir, dryRun: true, mcpUrl: "http://127.0.0.1:0/mcp", defaultCwd: logDir });
const carried: string[] = [];
sp.attach({ isHeld: () => false, claimArea: () => {}, ensureRoom: (room, topic) => { hub.createRoom(room, { topic }); }, announce: () => {}, liveAgents: () => 0,
  resourceNote: (room) => hub.resourceNote(room), carryResources: (from, to) => { carried.push(`${from}>${to}`); hub.carryResources(from, to); } });
const [rec] = sp.request({ room: "res-group", requestedBy: "C", brief: "Count the rows in the fills archive and report the number on the board.", count: 1, name: "probe" });
const recruitPrompt = readFileSync(rec!.log, "utf8"); // a dry run writes the prompt it would have sent
for (const k of KEYS) assert.ok(recruitPrompt.includes(k), `the recruit's prompt names ${k}`);
// recruits sent to a new room: the room gets the requester room's resources, and the recruit is told of them
const [rec2] = sp.request({ room: "res-group", requestedBy: "C", brief: "Open a sub-room and split the fills archive count between two of you.", newRoom: "res-sub", count: 1, name: "probe2" });
assert.deepEqual(carried, [`res-group>${rec2!.room}`]);
assert.deepEqual([...hub.getRoom(rec2!.room).board.keys()].filter((k) => k.startsWith("resource/")), KEYS, "a recruits' new room starts with the requester room's resources");
assert.ok(readFileSync(rec2!.log, "utf8").includes(KEYS[0]!), "and its recruit's prompt names them");
// a fresh challenger is told nothing of the board
const [rec3] = sp.request({ room: "res-group", requestedBy: "C", brief: "Check one claim of the open proposal against the repository.", count: 1, name: "probe3", fresh: true });
assert.equal(readFileSync(rec3!.log, "utf8").includes(KEYS[0]!), false, "a fresh challenger's prompt names no board key");

// 7. the room record says which key a board_get read; a manifest read and every other tool carry none
const reader = await seat("reader");
const rJoin = JSON.parse((await reader.call("join_room", { room: "res-read", name: "R", agent: "test" })).text) as { participant_id: string };
hub.seedResources("res-read", parsed);
await reader.call("board_get", { room: "res-read", key: KEYS[1], participant_id: rJoin.participant_id });
await reader.call("board_get", { room: "res-read", participant_id: rJoin.participant_id });
await reader.call("board_get", { room: "res-read", key: "resource/not-there", participant_id: rJoin.participant_id });
await reader.call("board_set", { room: "res-read", key: "notes", text: "a note", participant_id: rJoin.participant_id });
const completions = readFileSync(join(dir, "res-read.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l) as { type: string; tool?: string; key?: string; participant?: string; outcome?: string })
  .filter((ev) => ev.type === "call_completion");
const gets = completions.filter((ev) => ev.tool === "board_get");
assert.deepEqual(gets.map((ev) => ev.key), [KEYS[1], undefined, "resource/not-there"], "board_get records the key asked for, found or not; the manifest read has none");
assert.equal(gets[0]!.participant, rJoin.participant_id, "with the seat that read it");
assert.equal(completions.filter((ev) => ev.tool !== "board_get").some((ev) => "key" in ev), false, "no other tool's completion carries a key");
// and the hub still replays its own log
assert.doesNotThrow(() => new Hub({ dataDir: dir }));

console.log("RESOURCE SEEDING REGRESSION OK");
process.exit(0);
