/**
 * The hub tells seats the time, and says so when a seat states a time that is not the time (evidence-pack item 13,
 * chat-and-friction issue 15). No hub reply carried a clock, so seats wrote guessed times: of 40 present-tense time
 * statements by agents in the room records since 2026-10-10 ("as of 01:55 UTC", "written 10:55 UTC"), 18 were more than
 * 5 minutes off the hub's own timestamp of that message and 8 were in the future; some sit inside pre-registration
 * claims (0btz-break: "Started 14:50 UTC" written at 14:44). Now every wait_for_messages, send_message and board_set
 * reply carries hub_time; a stated time more than 5 minutes off gets a time_note in the reply and a time_claim event.
 * Run: npx tsx --test scripts/hub-clock-regression.ts
 */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Hub } from "../src/hub.js";
import { hubTime, timeClaims } from "../src/hub/clock.js";
import { createSessionServer } from "../src/server.js";

const AT = Date.parse("2026-10-11T14:44:05.000Z");

test("timeClaims: only present-tense statements more than 5 minutes off the clock, on the nearer side of midnight", () => {
  assert.equal(hubTime(AT), "2026-10-11T14:44Z");
  assert.deepEqual(timeClaims("Started 14:50 UTC, rerun of build1", AT), [{ stated: "14:50", delta_min: 6 }]);
  assert.deepEqual(timeClaims("State as of 14:20 UTC: three merged.", AT), [{ stated: "14:20", delta_min: -24 }]);
  assert.deepEqual(timeClaims("written 14:46Z; it is now about 14:41 UTC", AT), [], "within 5 minutes either way");
  assert.deepEqual(timeClaims("The run ends at 17:00 UTC and the deadline is 02:02 UTC.", AT), [], "a schedule is not a claim about now");
  assert.deepEqual(timeClaims("as of 00:02 UTC", Date.parse("2026-10-11T23:58:00Z")), [], "four minutes across midnight");
  assert.deepEqual(timeClaims("leads concluded 14:34:34, internal 16:06:29", AT), [], "bare times in evidence are not claims");
});

test("replies carry hub_time; a mis-stated time is answered in the reply and logged", async (t) => {
  const dataDir = mkdtempSync(join(tmpdir(), "hub-clock-"));
  Hub.DEFAULT_NUDGE_MS = 0;
  const hub = new Hub({ dataDir });
  const seat = async (name: string) => {
    const session = createSessionServer(hub);
    const client = new Client({ name, version: "1" });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await session.server.connect(st); await client.connect(ct);
    return async (tool: string, args: Record<string, unknown>) => {
      const r = await client.callTool({ name: tool, arguments: args });
      assert.ok(!r.isError, (r.content as { text: string }[])[0]?.text);
      return JSON.parse((r.content as { text: string }[])[0].text) as Record<string, unknown>;
    };
  };
  const room = "hub-clock";
  const a = await seat("a"), b = await seat("b");
  await a("join_room", { room, name: "A", agent: "test" });
  await b("join_room", { room, name: "B", agent: "test" });
  t.after(() => { const r = hub.getRoom(room); clearTimeout(r.nudgeTimer); clearTimeout(r.openingsTimer); });
  const minute = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}Z$/;
  const w = await b("wait_for_messages", { room, timeout_ms: 0 });
  assert.match(String(w.hub_time), minute, "a wait says what time it is");
  const w2 = await b("wait_for_messages", { room, timeout_ms: 0 });
  assert.match(String(w2.hub_time), minute, "also when nothing else changed");

  const wrong = new Date(Date.now() + 20 * 60_000).toISOString().slice(11, 16); // twenty minutes from now
  const right = new Date().toISOString().slice(11, 16);
  const ok = await a("send_message", { room, content: `Status as of ${right} UTC: nothing merged yet.`, force: true });
  assert.match(String(ok.hub_time), minute);
  assert.equal(ok.time_note, undefined, "a correct time draws no note");
  const sent = await a("send_message", { room, content: `Status as of ${wrong} UTC: two merged.`, force: true });
  assert.match(String(sent.time_note), new RegExp(`You wrote ${wrong} UTC as the time; the hub.s clock reads \\d\\d:\\d\\d UTC`));
  const set = await a("board_set", { room, key: "ranked/list", text: `State as of ${wrong} UTC. 1. first item.` });
  assert.match(String(set.hub_time), minute);
  assert.match(String(set.time_note), /the hub's clock reads/);

  // an appended line gets the same answer, under the writer's name even in a log someone else began (review/7f620d69)
  const app = await b("board_set", { room, key: "ledger", text: `run 7 started ${wrong} UTC`, append: true });
  assert.match(String(app.hub_time), minute);
  assert.match(String(app.time_note), /the hub's clock reads/);
  const app2 = await a("board_set", { room, key: "ledger", text: "run 8 queued behind run 7", append: true });
  assert.equal(app2.time_note, undefined);

  const events = readFileSync(join(dataDir, `${room}.jsonl`), "utf8").trim().split("\n").map((l) => JSON.parse(l)).filter((e) => e.type === "time_claim");
  assert.deepEqual(events.map((e) => [e.by, e.where, e.stated, Math.abs(e.delta_min - 20) <= 1]), [["A", "message", wrong, true], ["A", "board:ranked/list", wrong, true], ["B", "board:ledger", wrong, true]]);
});
