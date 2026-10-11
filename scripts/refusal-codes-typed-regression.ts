/** Every hub guard refuses with a typed code, never the hub_guard catch-all (evidence pack item 3, telemetry gap 4/G6:
 * 357 of 489 refusals in 21 room logs were hub_guard, so nobody could say which guard cost the rooms most).
 * Run: npx tsx scripts/refusal-codes-typed-regression.ts
 * Two parts: a source scan (no HubError is constructed without a code argument) and the refusals rooms hit most,
 * driven through the real MCP guard, checked in the persisted refusal events. Isolated tmp data dir, no port.
 */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Hub } from "../src/hub.js";
import { createSessionServer } from "../src/server.js";
import { REFUSAL_CODES } from "../src/hub/types.js";
import { refusalTable } from "../src/refusal-metrics.js";

Hub.DEFAULT_NUDGE_MS = 0;

/** Top-level argument count of each `new HubError(` call, skipping strings, templates (with ${} nesting) and comments. */
function untypedSites(file: string): string[] {
  const src = readFileSync(file, "utf8");
  const out: string[] = [];
  const marker = "new HubError(";
  for (let at = src.indexOf(marker); at !== -1; at = src.indexOf(marker, at + 1)) {
    let i = at + marker.length, args = 1, empty = true, comma = false;
    // each frame is an open bracket in code ("(", "[", "{", or "${" inside a template) or an open template ("`")
    const stack: string[] = ["("];
    while (i < src.length && stack.length) {
      const c = src[i], top = stack.at(-1)!;
      if (top === "`") {
        if (c === "\\") i++;
        else if (c === "`") stack.pop();
        else if (c === "$" && src[i + 1] === "{") { stack.push("${"); i++; }
        i++;
        continue;
      }
      // a comma opens an argument only once something follows it (a trailing comma before ")" does not)
      if (comma && !/[\s)]/.test(c)) { args++; comma = false; }
      if (c === "'" || c === '"') { i++; while (i < src.length && src[i] !== c) { if (src[i] === "\\") i++; i++; } empty = false; }
      else if (c === "`") { stack.push("`"); empty = false; }
      else if (c === "(" || c === "[" || c === "{") stack.push(c);
      else if (c === ")" || c === "]" || c === "}") stack.pop();
      else if (c === "," && stack.length === 1) comma = true;
      else if (!/\s/.test(c)) empty = false;
      i++;
    }
    if (empty) continue;
    if (args < 3) out.push(`${file}:${src.slice(0, at).split("\n").length}`);
  }
  return out;
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith(".ts") ? [p] : [];
  });
}

const untyped = walk("src").flatMap(untypedSites);
assert.deepEqual(untyped, [], `HubError thrown without a RefusalCode (persisted as the hub_guard catch-all):\n${untyped.join("\n")}`);

const dir = mkdtempSync(join(tmpdir(), "refusal-typed-"));
const hub = new Hub({ dataDir: dir });
const clients: Client[] = [];
try {
  for (const name of ["alice", "bob"]) {
    const server = createSessionServer(hub);
    const client = new Client({ name, version: "1" });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await server.server.connect(st);
    await client.connect(ct);
    clients.push(client);
    const r = await client.callTool({ name: "join_room", arguments: { room: "typed", name, agent: "test" } });
    assert.notEqual(r.isError, true, JSON.stringify(r));
  }
  const [a, b] = clients;
  const call = async (c: Client, name: string, args: Record<string, unknown>) =>
    (await c.callTool({ name, arguments: { room: "typed", ...args } })) as { isError?: boolean; content: { text: string }[] };
  // b has not read what a says next: its send is refused as a stale send
  await call(b, "wait_for_messages", { timeout_ms: 0 });
  assert.notEqual((await call(a, "send_message", { content: "a first point for the room to read" })).isError, true);
  assert.equal((await call(b, "send_message", { content: "talking past it" })).isError, true);
  // the refusal delivered what b missed, so the resend goes through: a recovered refusal
  assert.notEqual((await call(b, "send_message", { content: "talking past it, now having read it" })).isError, true);
  await call(a, "wait_for_messages", { timeout_ms: 0 });
  const prop = await call(a, "propose", { text: "We adopt the typed refusal codes for every guard." });
  assert.notEqual(prop.isError, true, prop.content[0].text);
  const id = JSON.parse(prop.content[0].text).id ?? JSON.parse(prop.content[0].text).proposal?.id;
  assert.equal((await call(b, "propose", { text: "A second proposal while one is open." })).isError, true);
  assert.equal((await call(b, "amend", { proposal_id: id, find: "text that is not in it at all", replace: "x" })).isError, true);
  assert.equal((await call(b, "vote", { proposal_id: id, vote: "agree" })).isError, true);
  assert.equal((await call(a, "challenge", { proposal_id: id, objection: "my own proposal is weak somewhere, surely" })).isError, true);
  assert.equal((await call(b, "board_get", { key: "evidence/missing" })).isError, true);

  const events = readFileSync(join(dir, "typed.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const got = events.filter((e) => e.type === "refusal").map((e) => `${e.tool}: ${e.reason}`);
  assert.deepEqual(got, [
    "send_message: unread",
    "propose: proposal-open",
    "amend: amend-find",
    "vote: vote-form",
    "challenge: self-target",
    "board_get: not-found",
  ]);
  for (const e of events.filter((x) => x.type === "refusal")) assert.ok(REFUSAL_CODES.includes(e.reason), `${e.reason} is not in REFUSAL_CODES`);
  // the stats tally a dashboard and runs-table read carries the typed code too
  assert.equal(hub.getRoom("typed").refusals?.["propose: proposal-open"], 1);
  // scripts/refusals-table.ts: per tool and code, refused and recovered (same seat, same tool, success within 5 min)
  const table = refusalTable(events);
  assert.deepEqual(table.find((r) => r.reason === "unread"), { tool: "send_message", reason: "unread", refused: 1, recovered: 1, median_recovery_s: 0 });
  assert.equal(table.find((r) => r.reason === "amend-find")?.recovered, 0);
  console.log("refusal-codes-typed-regression OK");
} finally {
  for (const c of clients) await c.close();
  rmSync(dir, { recursive: true, force: true });
}
