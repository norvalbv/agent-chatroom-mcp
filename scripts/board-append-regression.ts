/**
 * Shared logs on the board (swarm-180216-182a, board evidence/item5-who-took-what and decision/board-append). Across the
 * room records 22 keys in 12 rooms were co-written by 2-5 seats (ledger, benchqueue, ranked-list, position). Each append
 * was a read-merge-overwrite, so on the new build 0btz's ledger drew 15 ownership and 5 size refusals; the 8000-char cap
 * split it by hand into ledger-2..ledger-7 and seats stopped sharing it ("kept separate to avoid write conflicts").
 * board_set(append=true) adds one block "[HH:MMZ name] text" to the entry: never refused for ownership or a stale read
 * (an append discards nothing), stamped with the real UTC time and author, rolled to <key>/2, /3... at the cap, refused
 * on prefixes with their own write rules, and logged as a board_append record.
 * Run: npx tsx scripts/board-append-regression.ts (PORT= to pin the hub the last case starts)
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { join } from "node:path";
import { Hub } from "../src/hub.js";
import { boardContinuation } from "../src/hub/board.js";
import { parseRoomLog, renderMetrics, runMetrics } from "../src/run-metrics.js";

const cases: [string, () => Promise<void> | void][] = [];
const test = (name: string, run: () => Promise<void> | void) => cases.push([name, run]);

let serial = 0;
function room(opts: { dataDir?: string } = {}) {
  const h = new Hub({ dataDir: opts.dataDir });
  const name = `append-${++serial}`;
  const [a, b, c] = ["alice", "bob", "carol"].map((n) => h.join(name, n, "test", {}, undefined, `sess-${n}`).participant);
  return { h, name, a, b, c };
}
const throws = (run: () => unknown, re: RegExp) => assert.throws(run, (e: Error) => re.test(e.message) || assert.fail(`unexpected message: ${e.message}`));
const STAMP = /^\[\d\d:\d\dZ (\w+)\] /;

test("two seats append to one ledger: neither is refused and both lines are kept, each stamped with time and author", () => {
  const { h, name, a, b } = room();
  h.setBoard(name, a.id, "ledger", "LEDGER (every test, passed or failed; append a line)");
  const e1 = h.setBoard(name, b.id, "ledger", "T-B2-1 | o1 pre-registered", { append: true })!;
  const e2 = h.setBoard(name, a.id, "ledger", "T-B1-1 | escrow check failed", { append: true })!;
  const lines = e2.text.split("\n");
  assert.equal(lines[0], "LEDGER (every test, passed or failed; append a line)", "the header is kept");
  assert.match(lines[1]!, /^\[\d\d:\d\dZ bob\] T-B2-1 \| o1 pre-registered$/);
  assert.match(lines[2]!, /^\[\d\d:\d\dZ alice\] T-B1-1 \| escrow check failed$/);
  assert.equal(e1.by, "alice", "the entry keeps its creator; appending does not take it over");
  const stamped = Date.parse(`${new Date().toISOString().slice(0, 11)}${lines[2]!.slice(1, 6)}:00Z`);
  assert.ok(Math.abs(Date.now() - stamped) < 2 * 60_000, "the stamp is the hub's clock, not a guessed time");
  assert.match(h.getRoom(name).messages.at(-1)!.content, /appended to "ledger"/);
});

test("an append from a seat that never read the entry is not a lost update, so the stale-read guard does not apply", () => {
  const { h, name, a, b, c } = room();
  h.setBoard(name, a.id, "benchqueue", "queue for the shared bench");
  h.setBoard(name, b.id, "benchqueue", "bob: run 3", { append: true });
  // carol has read nothing; a plain overwrite would be refused, an append is not
  throws(() => h.setBoard(name, c.id, "benchqueue", "carol", { overwrite: true }), /have not read|changed since/);
  const e = h.setBoard(name, c.id, "benchqueue", "carol: run 4", { append: true })!;
  assert.equal(e.text.split("\n").length, 3);
});

test("append creates the entry when it is absent", () => {
  const { h, name, b } = room();
  const e = h.setBoard(name, b.id, "log/runs", "first run started", { append: true })!;
  assert.match(e.text, STAMP);
  assert.equal(e.by, "bob");
});

test("past the 8000-char cap an append lands in <key>/2, and later appends to <key> go straight there", () => {
  const { h, name, a, b } = room();
  h.setBoard(name, a.id, "ledger", "LEDGER\n" + "x".repeat(7990));
  const r = h.setBoard(name, b.id, "ledger", "T-9 | the line that does not fit", { append: true })!;
  assert.equal(h.getRoom(name).board.get("ledger")!.text.length <= 8000, true, "the head is not grown past the cap");
  const cont = h.getRoom(name).board.get("ledger/2")!;
  assert.ok(cont, "continuation created");
  assert.match(cont.text.split("\n")[0]!, /^continued from "ledger"/);
  assert.match(cont.text, /\[\d\d:\d\dZ bob\] T-9 \| the line that does not fit/);
  assert.equal(r, cont, "the result is the entry the line landed in");
  assert.equal(h.getRoom(name).board.get("ledger")!.continuedAt, "ledger/2");
  h.setBoard(name, a.id, "ledger", "T-10 | next", { append: true });
  assert.match(h.getRoom(name).board.get("ledger/2")!.text, /T-10 \| next/);
  assert.match(h.getRoom(name).messages.at(-1)!.content, /appended to "ledger\/2"/);
  // the continuation fills up too: /3
  h.setBoard(name, a.id, "ledger", "y".repeat(7700), { append: true });
  h.setBoard(name, b.id, "ledger", "y".repeat(7700), { append: true });
  h.setBoard(name, b.id, "ledger", "T-11", { append: true });
  assert.match(h.getRoom(name).board.get("ledger/3")!.text, /T-11/);
  assert.equal(h.getRoom(name).board.get("ledger")!.continuedAt, "ledger/3");
});

test("a reader of the head after a rollover gets the newest lines in the same read (attack/decision/board-append)", () => {
  const { h, name, a, b } = room();
  h.setBoard(name, a.id, "benchqueue", "QUEUE\n" + "x".repeat(7990));
  const r = h.getRoom(name);
  assert.equal(boardContinuation(r, "benchqueue", r.board.get("benchqueue")!), undefined, "nothing extra before a rollover");
  h.setBoard(name, a.id, "benchqueue", "alice holds the bench until 12:40", { append: true });
  h.setBoard(name, b.id, "benchqueue", "bob queued behind alice", { append: true });
  const c = boardContinuation(r, "benchqueue", r.board.get("benchqueue")!)!;
  assert.deepEqual(c.continued_in, ["benchqueue/2"]);
  assert.equal(c.newest_key, "benchqueue/2");
  assert.equal(c.newest_lines.length, 2);
  assert.match(c.newest_lines.at(-1)!, /\[\d\d:\d\dZ bob\] bob queued behind alice/);
  assert.match(c.hint, /OLDEST part of the log.*"benchqueue\/2"/);
  // the room hears where each line landed, so a seat following the key learns of the continuation
  assert.match(r.messages.at(-1)!.content, /appended to "benchqueue\/2" \(continuation of "benchqueue"\)/);
});

test("an append by another seat does not answer an attack on the entry; the author's own append can (review/abf7c25c)", () => {
  const { h, name, a, b, c } = room();
  h.setBoard(name, a.id, "evidence/queue-wait", "Seats wait a median 16 minutes for the shared bench, measured over three rooms.");
  h.setBoard(name, c.id, "attack/evidence/queue-wait", 'The clause "a median 16 minutes for the shared bench" counts one room twice.');
  assert.deepEqual(h.scrutiny(name).open_attacks, ["attack/evidence/queue-wait"]);
  h.setBoard(name, b.id, "evidence/queue-wait", "bob: my own run waited 3 minutes today, unrelated to the objection above, just logging it here.", { append: true });
  assert.deepEqual(h.scrutiny(name).open_attacks, ["attack/evidence/queue-wait"], "a bystander's line is not the author's reply");
  h.setBoard(name, a.id, "evidence/queue-wait", "Reply: recounted without the duplicate room; the median is 14 minutes, see evidence/queue-recount.", { append: true });
  assert.deepEqual(h.scrutiny(name).open_attacks, [], "the author's appended reply answers it");
});

test("a single append that could not fit even a fresh continuation is refused with the limit", () => {
  const { h, name, a } = room();
  throws(() => h.setBoard(name, a.id, "ledger", "z".repeat(7801), { append: true }), /7800/);
});

test("prefixes with their own write rules refuse append", () => {
  const { h, name, a, b } = room();
  for (const key of ["claim/x", "take/x", "verify/x", "review/abc1234", "attack/ledger", "draft/x", `hold/${name}`, "inbox/r/x.ack"]) {
    throws(() => h.setBoard(name, a.id, key, "line", { append: true }), /append/);
  }
  h.setBoard(name, b.id, "ledger", "ok", { append: true });
});

test("every append is a board_append record, and a restart rebuilds the entry and its continuation pointer", () => {
  const dataDir = mkdtempSync(join(tmpdir(), "board-append-"));
  const { h, name, a, b } = room({ dataDir });
  h.setBoard(name, a.id, "ledger", "LEDGER\n" + "x".repeat(7990));
  h.setBoard(name, b.id, "ledger", "T-1", { append: true });
  h.setBoard(name, a.id, "ledger", "T-2", { append: true });
  const log = readdirSync(dataDir).filter((f) => f.endsWith(".jsonl")).flatMap((f) => readFileSync(join(dataDir, f), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>));
  const appends = log.filter((e) => e.type === "board_append");
  assert.deepEqual(appends.map((e) => [e.key, e.landed_key, e.by]), [["ledger", "ledger/2", "bob"], ["ledger", "ledger/2", "alice"]]);
  assert.ok(appends.every((e) => typeof e.chars === "number" && typeof e.ts === "string"));
  // the run report counts them per shared key
  const file = readdirSync(dataDir).find((f) => f.endsWith(".jsonl"))!;
  const m = runMetrics(parseRoomLog(readFileSync(join(dataDir, file), "utf8")));
  assert.deepEqual(m.appends, { ledger: { lines: 2, seats: 2, continuations: 1 } });
  assert.match(renderMetrics(m), /Shared logs \(board_set append\): ledger 2 lines from 2 seats, 1 continuation\./);
  const again = new Hub({ dataDir });
  assert.equal(again.getRoom(name).board.get("ledger")!.continuedAt, "ledger/2");
  assert.match(again.getRoom(name).board.get("ledger/2")!.text, /T-1[\s\S]*T-2/);
});

test("over MCP: the tool takes append, answers where the line landed, and board_get of a full head carries the newest lines", async () => {
  const PORT = Number(process.env.PORT ?? 20_000 + Math.floor(Math.random() * 20_000));
  assert.ok(![7717, 7719, 7750].includes(PORT), "never a live hub");
  const server = spawn("npx", ["tsx", "src/index.ts"], { env: { ...process.env, PORT: String(PORT), CHATROOM_SPAWN_DRY: "1", CHATROOM_LOG_DIR: "/tmp/chatroom-board-append-spawn", CHATROOM_INSECURE_LOCAL: "1", CHATROOM_DATA_DIR: "" }, stdio: ["ignore", "ignore", "inherit"] });
  try {
    for (let i = 0; ; i++) {
      try { await fetch(`http://127.0.0.1:${PORT}/`); break; } catch { if (i > 75) throw new Error("hub did not start"); await new Promise((r) => setTimeout(r, 200)); }
    }
    const seat = async (name: string) => {
      const client = new Client({ name, version: "0.0.0" });
      await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${PORT}/mcp`)));
      const call = async (tool: string, args: Record<string, unknown> = {}) => {
        const res = (await client.callTool({ name: tool, arguments: { room: "append-mcp", ...args } })) as { isError?: boolean; content: { text: string }[] };
        const text = res.content[0]?.text ?? "";
        if (res.isError) throw new Error(`${name}.${tool}: ${text}`);
        return JSON.parse(text) as Record<string, unknown>;
      };
      await call("join_room", { name, agent: "test" });
      return { call, close: () => client.close() };
    };
    const a = await seat("alice"), b = await seat("bob");
    await a.call("board_set", { key: "ledger", text: "LEDGER\n" + "x".repeat(7990) });
    const r1 = await b.call("board_set", { key: "ledger", text: "T-1 | passed", append: true });
    assert.equal(r1.landed_key, "ledger/2");
    assert.match(String(r1.hint), /your line is in "ledger\/2"/);
    const r2 = await a.call("board_set", { key: "ledger", text: "T-2 | failed", append: true });
    assert.deepEqual([r2.landed_key, r2.lines], ["ledger/2", 3]);
    const head = await b.call("board_get", { key: "ledger" });
    assert.equal(head.newest_key, "ledger/2");
    assert.match((head.newest_lines as string[]).at(-1)!, /alice\] T-2 \| failed/);
    const manifest = await b.call("board_get") as Record<string, { continued_at?: string }>;
    assert.equal(manifest.ledger!.continued_at, "ledger/2");
    await a.close(); await b.close();
  } finally { server.kill(); }
});

let failed = 0;
for (const [name, run] of cases) {
  try {
    await run();
    console.log(`ok   ${name}`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${name}\n     ${(e as Error).message.split("\n")[0]}`);
  }
}
console.log(failed ? `\n${failed} of ${cases.length} failed` : `\nBOARD APPEND OK (${cases.length} cases)`);
process.exit(failed ? 1 : 0);
