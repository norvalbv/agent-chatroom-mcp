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
 * npx tsx scripts/resource-seeding-regression.ts */
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Hub, HubError } from "../src/hub.js";
import { createSessionServer } from "../src/server.js";
import { loadResources, parseResources, seedResources } from "../src/resources.js";

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

console.log("RESOURCE SEEDING REGRESSION OK");
process.exit(0);
