/**
 * A check says what it found, in one declared line, and the record carries it (telemetry gap G3's verdict; idea/check-verdict).
 * Read from prose, a verdict is wrong too often to count: of 151 check entries in the records 41% state no verdict word,
 * and "H1 REFUTED ... It confirms -1's verdict" is a check that holds (decision/check-verdict-not-built). So the hub
 * reads only a declared first line, "VERDICT: holds|fails|partial", and asks for it in its reply to a check that has
 * none: hub-carried, no prompt line (minimal-prompt-hub-carries-coordination). The runs table splits "reviewed" by it.
 * Run: npx tsx --test scripts/check-verdict-regression.ts
 */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Hub } from "../src/hub.js";
import { verdictOf } from "../src/hub/checks.js";
import { runRow } from "../src/run-timeline.js";
import { createSessionServer } from "../src/server.js";

test("only a declared first line is a verdict", () => {
  assert.equal(verdictOf("VERDICT: holds — reproduces exactly at 85062bd\n..."), "holds");
  assert.equal(verdictOf("verdict: FAILS: the edge is the outage window"), "fails");
  assert.equal(verdictOf("Verdict - partial (Part A only)"), "partial");
  assert.equal(verdictOf("H1 REFUTED for large effects. It confirms -1's verdict."), undefined, "prose is not read");
  assert.equal(verdictOf("rerun of exp/Q4\nVERDICT: holds"), undefined, "the first line only");
  assert.equal(verdictOf("VERDICT: mostly fine"), undefined, "a closed set");
});

test("the hub asks a check without a verdict for one, keeps a declared one, and logs it", async (t) => {
  const dataDir = mkdtempSync(join(tmpdir(), "check-verdict-"));
  Hub.DEFAULT_NUDGE_MS = 0;
  const hub = new Hub({ dataDir });
  const seat = async (name: string) => {
    const session = createSessionServer(hub);
    const client = new Client({ name, version: "1" });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await session.server.connect(st); await client.connect(ct);
    return async (tool: string, args: Record<string, unknown>) => JSON.parse(((await client.callTool({ name: tool, arguments: args })).content as { text: string }[])[0].text) as Record<string, unknown>;
  };
  const room = "check-verdict";
  const a = await seat("a"), b = await seat("b");
  await a("join_room", { room, name: "A", agent: "test" });
  await b("join_room", { room, name: "B", agent: "test" });
  t.after(() => { const r = hub.getRoom(room); clearTimeout(r.nudgeTimer); clearTimeout(r.openingsTimer); });
  await a("board_set", { room, key: "exp/Q4", text: "Q4: the strip arm beats control by 3.1 points on the held-out tasks" });
  const bare = await b("board_set", { room, key: "audit/Q4-partA", text: "reran the strip arm on 20 tasks: 2.8 points, same direction" });
  assert.deepEqual(bare.checks, ["exp/Q4"], "the reply says what the entry was linked to");
  assert.match(String(bare.verdict_hint), /VERDICT: holds\|fails\|partial/);
  const said = await b("board_set", { room, key: "audit/Q4-partA", text: "VERDICT: holds — 2.8 points on 20 tasks, same direction\nreran the strip arm" });
  assert.equal(said.verdict_hint, undefined, "a check that declares one is not asked again");
  assert.equal(hub.getRoom(room).board.get("audit/Q4-partA")!.verdict, "holds");
  const plain = await a("board_set", { room, key: "evidence/notes", text: "not a check of anything" });
  assert.equal(plain.verdict_hint, undefined, "only a check is asked");
  const events = readFileSync(join(dataDir, `${room}.jsonl`), "utf8").trim().split("\n").map((l) => JSON.parse(l)).filter((e) => e.type === "check");
  assert.deepEqual(events.map((e) => [e.key, e.verdict ?? null]), [["audit/Q4-partA", null], ["audit/Q4-partA", "holds"]], "a new verdict is logged even when the link is unchanged");
});

test("the runs table splits reviewed results by declared verdict", () => {
  const at = (s: number) => new Date(Date.parse("2026-10-11T18:00:00Z") + s * 1000).toISOString();
  const board = (key: string, by: string, s: number, text = "x".repeat(60)) => ({ type: "board", room: "r", key, entry: { text, by, updatedAt: at(s) } });
  const log = [
    { type: "room", room: "r", opts: { topic: "t" }, createdAt: at(0) },
    board("result/a", "w1", 10), board("result/b", "w1", 11), board("result/c", "w1", 12), board("result/d", "w1", 13),
    board("rerun/a", "w2", 100, "VERDICT: holds — exact"), board("rerun/b", "w2", 101, "VERDICT: fails — the window is wrong"),
    board("rerun/c", "w2", 102, "numbers match"),
  ];
  const row = runRow(log as never);
  assert.equal(row.reviewed, 3);
  assert.deepEqual(row.verdicts, { holds: 1, fails: 1, partial: 0, unstated: 1 });
});
