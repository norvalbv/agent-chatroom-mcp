/**
 * A blocker the room cannot fix reaches the owner (swarm-073112-zcd7, evidence/rules-that-kept-trading). The live-money
 * room swarm-185621-lc0a was told to write needs/<name> and mention the chair when something needed money or an account;
 * the board ended with no needs/* entry. Its seat had named the laptop as the bottleneck at #235 (19:54) and trading ran
 * on until the owner stopped it at 20:55:55 (#612). The hub had no notion of needs/: nothing told the chair or a human,
 * nothing counted it, and room_status could not show one.
 *
 * needs/<name> is now a reserved prefix. Its first write posts one chat line that @-mentions the chair and every human
 * in the room (or says nobody is there to decide), and logs a need_filed event with the minutes since the room opened;
 * room_status lists open needs; clearing one logs need_cleared; run-metrics counts them and the minutes to the first one.
 * The flat seat prompt carries the concrete stop-and-escalate rule (arXiv:2606.28733: named stopping rules in the
 * system prompt doubled timely abstention).
 *
 * npx tsx scripts/needs-escalation-regression.ts */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hub } from "../src/hub.js";
import { parseRoomLog, runMetrics } from "../src/run-metrics.js";

const cases: [string, () => void][] = [];
const test = (name: string, run: () => void) => cases.push([name, run]);

let serial = 0;
function room(opts: { chair?: boolean; human?: boolean } = {}) {
  const dataDir = mkdtempSync(join(tmpdir(), "needs-"));
  const h = new Hub({ dataDir });
  const name = `needs-${++serial}`;
  const a = h.join(name, "alice", "test", {}, undefined, "sess-alice").participant;
  const b = h.join(name, "bob", "test", {}, undefined, "sess-bob").participant;
  if (opts.chair) h.join(name, "chair-claude", "claude", {}, undefined, "sess-chair", "chair");
  if (opts.human) h.join(name, "benji", "human", {}, undefined, "sess-benji");
  const events = () => readFileSync(join(dataDir, `${name}.jsonl`), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  return { h, name, a, b, events, dataDir };
}
const last = (h: Hub, name: string) => h.getRoom(name).messages.at(-1)!;

test("a seat's first needs/* write @-mentions the chair and the humans, and logs need_filed", () => {
  const { h, name, a, events } = room({ chair: true, human: true });
  h.setBoard(name, a.id, "needs/dublin-server", "A server in AWS eu-west-1. $10/mo. The laptop+VPN path decides crypto Up/Down (#235).");
  const m = last(h, name);
  assert.equal(m.kind, "chat", "chat kind, so the chair's held wait wakes on the mention");
  assert.match(m.content, /@chair-claude/);
  assert.match(m.content, /@benji/);
  assert.match(m.content, /needs\/dublin-server/);
  assert.match(m.content, /alice/);
  const filed = events().filter((e) => e.type === "need_filed");
  assert.equal(filed.length, 1);
  assert.equal(filed[0].key, "needs/dublin-server");
  assert.equal(filed[0].by, "alice");
  assert.equal(typeof filed[0].minutes_since_open, "number");
  assert.deepEqual(filed[0].told, ["chair-claude", "benji"]);
});

test("a blocks: line names the claims the blocker stops; their owners are pinged too and need_filed records them", () => {
  const { h, name, a, b, events } = room({ chair: true });
  h.setBoard(name, b.id, "claim/goal-lag", "{\"area\":\"in-play goal sniping\"}");
  h.setBoard(name, a.id, "claim/crypto-maker", "{\"area\":\"crypto maker\"}");
  h.setBoard(name, a.id, "needs/colocated-feed", "Binance->Polymarket in <50 ms\nblocks: claim/crypto-maker, claim/goal-lag, claim/nonexistent");
  const m = last(h, name);
  assert.match(m.content, /@bob/, "the goal-lag owner is told its test is blocked");
  assert.match(m.content, /claim\/goal-lag/);
  const filed = events().filter((e) => e.type === "need_filed")[0];
  assert.deepEqual(filed.blocks, ["claim/crypto-maker", "claim/goal-lag", "claim/nonexistent"]);
  assert.deepEqual(filed.told, ["chair-claude", "bob"], "the filer is not told about their own claim; an unknown claim tells nobody");
  assert.match(m.content, /claim\/nonexistent is not on the board/, "a blocks: key nobody claimed is said, so the filer can fix it");
});

test("with no chair and no human the notice says nobody is here to decide, so the seat knows the owner sees it only in the report", () => {
  const { h, name, a } = room();
  h.setBoard(name, a.id, "needs/more-budget", "+$40 for crypto-maker");
  assert.match(last(h, name).content, /no chair or human/i);
});

test("an edit does not notify again; room_status lists the open need; clearing it logs need_cleared and drops it", () => {
  const { h, name, a, b, events } = room({ chair: true });
  h.setBoard(name, a.id, "needs/vpn-off", "turn the VPN off for read-only data");
  const before = h.getRoom(name).messages.length;
  h.setBoard(name, a.id, "needs/vpn-off", "turn the VPN off for read-only data (measured 196 ms RTT, 5% loss)");
  assert.equal(h.getRoom(name).messages.filter((m, i) => i >= before && /needs\/vpn-off/.test(m.content) && m.kind === "chat").length, 0, "no second ping");
  const status = h.summary(h.getRoom(name)) as unknown as { open_needs?: { key: string; by: string; age_minutes: number }[] };
  assert.equal(status.open_needs?.length, 1);
  assert.equal(status.open_needs![0].key, "needs/vpn-off");
  assert.equal(status.open_needs![0].by, "alice");
  h.setBoard(name, a.id, "needs/vpn-off", "");
  assert.equal(events().filter((e) => e.type === "need_cleared").length, 1);
  const after = h.summary(h.getRoom(name)) as unknown as { open_needs?: unknown[] };
  assert.equal(after.open_needs, undefined, "absent when none is open");
});

test("run-metrics counts needs and the minutes to the first one", () => {
  const { h, name, a, dataDir } = room({ chair: true });
  h.setBoard(name, a.id, "needs/dublin-server", "server near London");
  h.setBoard(name, a.id, "needs/budget", "+$20");
  const m = runMetrics(parseRoomLog(readFileSync(join(dataDir, `${name}.jsonl`), "utf8")));
  assert.equal(m.needs?.filed, 2);
  assert.equal(typeof m.minutesTo.firstNeed, "number");
});

test("the flat seat prompt names the stop-and-escalate rule with concrete triggers", () => {
  const prompt = readFileSync(new URL("../prompts/minimal.md", import.meta.url), "utf8");
  assert.match(prompt, /needs\/<name>/);
  assert.match(prompt, /stop/i);
  assert.match(prompt, /network|machine/i);
});

let failed = 0;
for (const [name, run] of cases) {
  try { run(); console.log(`ok - ${name}`); } catch (e) { failed++; console.log(`not ok - ${name}\n  ${(e as Error).message.split("\n")[0]}`); }
}
if (failed) { console.log(`${failed} of ${cases.length} failed`); process.exit(1); }
console.log(`needs-escalation regression OK (${cases.length} cases)`);
