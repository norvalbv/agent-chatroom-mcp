/**
 * Board notices ride the full hold, and a board amend posts one notice (claim/redundant-calls, decision/redundant-calls).
 * evidence/redundant-calls, over 9f66 (6 rooms), 54vu (4), mrw4 (7) and zcd7: 36,200 model requests, $2,439.
 * (1) A held wait (hold_until_actionable) that saw only board notices returned at the seat's own 55 s, not at the
 *     connection's 4-min hold: in 9f66 main, board-only returns took p10 55,002 ms, p50 55,008 ms (n=372). With a notice
 *     every ~14 s, every idle seat woke every 55 s. After such a wake the seat waited again with nothing in between 49-57%
 *     of the time (2-3% after an addressed wake). Those wakes: 1,676 waits, 984 requests, $62.22 (2.6%); replayed with
 *     the full hold, 52% of them go.
 * (2) Hub.amendBoard posted two board notices per amend: setBoard's "updated board entry K (N chars; read it with
 *     board_get)" and its own "amended K: old → new". In 9f66 main that was 758 duplicate lines, 25% of 3,023 messages.
 * Red on f6a9eabb: the held wait returns at the seat's own budget on a board notice, and an amend posts two lines.
 * Run: npx tsx scripts/board-notice-hold-regression.ts   (in-process sessions; no port)
 */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Hub } from "../src/hub.js";
import { createSessionServer } from "../src/server.js";
import { costByTool } from "../src/wait-cost.js";

Hub.DEFAULT_NUDGE_MS = 0;
const dataDir = mkdtempSync(join(tmpdir(), "board-notice-hold-"));
const hub = new Hub({ dataDir });
const ROOM = "hold";
const open: Client[] = [];
async function seat(name: string, holdMs?: number, fullWaitMs?: number) {
  const session = createSessionServer(hub, undefined, { holdMs, ...(fullWaitMs ? { fullWaitMs } : {}) });
  const client = new Client({ name, version: "1" });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await session.server.connect(st);
  await client.connect(ct);
  open.push(client);
  const call = async (tool: string, args: Record<string, unknown>) => {
    const r = (await client.callTool({ name: tool, arguments: { room: ROOM, ...args } })) as { isError?: boolean; content: { text: string }[] };
    assert.notEqual(r.isError, true, r.content[0].text);
    return JSON.parse(r.content[0].text);
  };
  await call("join_room", { name, agent: "claude" });
  return call;
}
const timed = async <T>(run: () => Promise<T>) => { const t = Date.now(); const out = await run(); return { ms: Date.now() - t, out }; };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const events = () => readFileSync(join(dataDir, `${ROOM}.jsonl`), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));

try {
  // scaled down as in scripts/seat-hold-regression.ts: the seat's own full-length wait is 800 ms, the connection's hold 3 s
  const c = await seat("held", 3000, 800);
  const b = await seat("writer");
  await c("wait_for_messages", { timeout_ms: 0 });
  await b("wait_for_messages", { timeout_ms: 0 });
  const held = () => c("wait_for_messages", { timeout_ms: 800, hold_until_actionable: true });

  // (1a) only a board notice arrives: held to the connection's hold, then delivered (nothing is dropped)
  {
    const run = timed(held);
    await sleep(200);
    await b("board_set", { key: "notes/scorer", text: "scorer rerun: 0.62 → 0.58" });
    const got = await run;
    assert.ok(got.ms >= 2800, `a board notice alone does not end the hold at the seat's own 800 ms (${got.ms} ms)`);
    assert.equal(got.out.messages.length, 1, "the notice is still delivered once the hold ends");
    assert.match(got.out.messages[0], /notes\/scorer/);
  }
  // (1b) a board notice, then a message addressed to the seat: returns on the address at once, both delivered
  {
    const run = timed(held);
    await sleep(200);
    await b("board_set", { key: "notes/scorer", text: "scorer rerun: 0.58 → 0.57" });
    await sleep(800);
    await b("send_message", { content: "@held the scorer has finished, please review", force: true });
    const got = await run;
    assert.ok(got.ms >= 900 && got.ms < 1800, `woken by the address, not held to the end (${got.ms} ms)`);
    assert.equal(got.out.messages.length, 2);
    await c("pass", {}); // the ask is answered, so it no longer makes every wait actionable
  }
  // (1c) a board notice, then chat after the seat's own budget: chat still ends the hold at once, as before
  {
    const run = timed(held);
    await sleep(200);
    await b("board_set", { key: "notes/other", text: "a side note" });
    await sleep(1200);
    const t = Date.now();
    await b("send_message", { content: "an aside nobody has to answer", force: true, quiet: false });
    const got = await run;
    assert.ok(got.ms >= 1300 && Date.now() - t < 500, `chat after the budget returns at once; the board notice did not (${got.ms} ms)`);
    assert.equal(got.out.messages.length, 2);
  }
  // (1d) a plain connection (no hold) is unchanged: a board notice returns its held wait at the seat's own budget
  {
    const plain = await seat("plain");
    await plain("wait_for_messages", { timeout_ms: 0 });
    const run = timed(() => plain("wait_for_messages", { timeout_ms: 600, hold_until_actionable: true }));
    await sleep(100);
    await b("board_set", { key: "notes/plain", text: "for the plain seat" });
    const got = await run;
    assert.ok(got.ms < 1200, `no hold, no change (${got.ms} ms)`);
  }
  // telemetry: each wait says why it returned and how many board notices it carried
  {
    const ev = events();
    const pid = ev.find((e) => e.type === "join" && e.p?.name === "held").p.id;
    const waits = ev.filter((e) => e.type === "call_completion" && e.tool === "wait_for_messages" && e.participant === pid && !e.empty);
    assert.deepEqual(waits.map((w) => w.woke), ["message", "notices", "actionable", "chatter"], "woke: why each wait returned (the first, unheld, read the join lines)");
    assert.deepEqual(waits.map((w) => w.board_notices), [0, 1, 1, 1], "board_notices: how many board notices each carried");
    const empty = ev.filter((e) => e.type === "call_completion" && e.tool === "wait_for_messages" && e.participant === pid && e.empty);
    assert.ok(empty.every((w) => w.woke === "empty"), "an empty return says so");
    // scripts/wait-cost.ts --by-tool reads it: the request a notice-only wake cost is its own row
    const seatLog = [
      { type: "join", room: ROOM, p: { id: "p_s", name: "s", seatKeyHash: "k" } },
      { type: "usage", room: ROOM, seat: "k", ts: "2026-10-26T01:00:00.000Z", usage: { requests: 1, cost_usd: 0.1, at: "2026-10-26T01:00:00.000Z" } },
      { type: "call_completion", room: ROOM, tool: "wait_for_messages", outcome: "success", participant: "p_s", ts: "2026-10-26T01:04:00.000Z", empty: false, woke: "notices", board_notices: 3 },
      { type: "usage", room: ROOM, seat: "k", ts: "2026-10-26T01:04:05.000Z", usage: { requests: 2, cost_usd: 0.16, at: "2026-10-26T01:04:05.000Z" } },
      { type: "call_completion", room: ROOM, tool: "wait_for_messages", outcome: "success", participant: "p_s", ts: "2026-10-26T01:05:00.000Z", empty: false },
      { type: "usage", room: ROOM, seat: "k", ts: "2026-10-26T01:05:05.000Z", usage: { requests: 3, cost_usd: 0.22, at: "2026-10-26T01:05:05.000Z" } },
    ];
    assert.deepEqual(Object.fromEntries(costByTool([seatLog]).map((t) => [t.tool, t.requests])), { "wait_for_messages (notices)": 1, "wait_for_messages (messages)": 1 }, "wait-cost splits a wait by why it returned; an older log keeps the old label");
  }
  // (1e) a write that asks someone something follows its board line with an @-addressed chat line (board.ts reviewer,
  //      take.ts offer): a claim's reviewer and a take handed over still wake a held wait at once (the verifier's check, #393)
  {
    const run = timed(held);
    await sleep(200);
    await b("board_set", { key: "claim/notice-hold", text: JSON.stringify({ area: "notice-hold", owner: "writer", team: ["writer"], status: "open", note: "the reviewer case" }) });
    const got = await run;
    assert.ok(got.ms < 800, `the reviewer assignment wakes the held wait at once (${got.ms} ms)`);
    assert.ok(got.out.messages.some((m: string) => /@held you are the reviewer/.test(m)), JSON.stringify(got.out.messages));
    await c("pass", {});
    await b("board_set", { key: "take/slot", text: "writer: one run" });
    const run2 = timed(held);
    await sleep(200);
    await b("board_set", { key: "take/slot", text: "@held the slot is yours" });
    const got2 = await run2;
    assert.ok(got2.ms < 800, `a take handed over wakes the held wait at once (${got2.ms} ms)`);
    assert.ok(got2.out.messages.some((m: string) => /@held writer offers you "take\/slot"/.test(m)), JSON.stringify(got2.out.messages));
  }

  // (2) one notice per board amend, carrying the diff and the size, and still the metadata review asks are settled by
  {
    const h = new Hub({ dataDir });
    const a = h.join("amend", "A", "test", { nudgeAfterMs: 0 }, undefined, "s-a").participant;
    h.join("amend", "B", "test", {}, undefined, "s-b");
    const room = h.getRoom("amend");
    h.setBoard("amend", a.id, "ledger", "LEDGER\nT-1 fill 0.62, rerun pending\nT-2 wide book\n");
    const before = room.messages.length;
    h.amendBoard("amend", a.id, "ledger", "fill 0.62, rerun pending", "fill 0.58 after rerun");
    const posted = room.messages.slice(before);
    assert.equal(posted.length, 1, `one notice per amend, not two: ${JSON.stringify(posted.map((m) => m.content))}`);
    assert.equal(posted[0].kind, "board");
    assert.match(posted[0].content, /^amended "ledger" \(\d+ chars\): "fill 0\.62, rerun pending" → "fill 0\.58 after rerun"$/);
    // a review entry amended to cover a commit: the one notice keeps covers, which settles an ask naming that commit
    const sha = "abcdef1234567";
    h.setBoard("amend", a.id, "review/abcdef12", `{"proposal":"pending","command":"npm test","cwd":".","base_commit":"1111111","base_exit_code":1,"commit":"abcdef1","exit_code":0,"output_tail":"ok"}\nfirst look`);
    const mark = room.messages.length;
    h.amendBoard("amend", a.id, "review/abcdef12", "first look", `exercised ${sha} on a private hub`);
    const one = room.messages.slice(mark).filter((m) => m.kind === "board");
    assert.equal(one.length, 1);
    assert.ok(one[0].covers?.some((x: string) => sha.startsWith(x) || x.startsWith("abcdef1")), `covers kept on the single notice: ${JSON.stringify(one[0].covers)}`);
    // a sealed draft's notice names no content: its amend posts the sealed line only, never the diff
    h.setBoard("amend", a.id, "draft/A", "my answer: the threshold is 0.37");
    const sealedAt = room.messages.length;
    h.amendBoard("amend", a.id, "draft/A", "0.37", "0.41");
    const sealed = room.messages.slice(sealedAt);
    assert.equal(sealed.length, 1, `one notice for a sealed draft's amend: ${JSON.stringify(sealed.map((m) => m.content))}`);
    assert.ok(!/0\.37|0\.41|draft\/A/.test(sealed[0].content), `a sealed draft's amend leaks nothing: ${sealed[0].content}`);
    const edits = readFileSync(join(dataDir, "amend.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)).filter((e) => e.type === "board_edit");
    assert.equal(edits.length, 3);
    assert.ok(edits.every((e) => typeof e.notice_seq === "number"), "board_edit names the seq of its one notice");
    assert.equal(edits[0].notice_seq, posted[0].seq);
  }
  console.log("board-notice-hold-regression OK");
} finally {
  for (const cl of open) await cl.close().catch(() => {});
}
process.exit(0);
