/**
 * Every problem a brief names has an owner, and the room shows it without the chair checking by hand (inputs/owner-3 (a),
 * decision/coverage-tracking). The brief's numbered list was parsed only to give flat seats a starting line and then
 * dropped: nothing on the board or in room_status named the problems, and a claim showed that someone took one, not
 * that it was being worked or done (72% of 1,289 claims were still "held" when their owner left, evidence/claims-census).
 * item/<slug> entries now name the problems (the chair writes them; a launcher may seed them like resource/*), and the
 * hub computes each one's owner and state from item/* and claim/* in room_status.coverage, open_work and a coverage event.
 * Run: npx tsx scripts/coverage-regression.ts
 */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hub } from "../src/hub.js";
import { openWork } from "../src/hub/open-work.js";
import { renderRunReport, type RunResult } from "../src/result.js";
import { parseResources } from "../src/resources.js";
import { replayCoverage } from "./coverage-replay.js";

const cases: [string, () => Promise<void> | void][] = [];
const test = (name: string, run: () => Promise<void> | void) => cases.push([name, run]);

let serial = 0;
type Cov = { items: number; by_state: Record<string, number>; open: string[]; rows: { key: string; state: string; owners: string[]; claims: string[]; since: string }[]; multi_claim_seats?: Record<string, number> };
function room(dataDir?: string) {
  const h = new Hub(dataDir ? { dataDir } : {});
  const name = `coverage-${++serial}`;
  const [chair, alice, bob, carol] = ["chair", "alice", "bob", "carol"].map((n) => h.join(name, n, "test", {}, undefined, `sess-${n}`, n === "chair" ? "chair" : undefined).participant);
  const cov = () => (h.summary(h.getRoom(name)) as { coverage?: Cov }).coverage;
  const row = (key: string) => cov()?.rows.find((r) => r.key === key);
  return { h, name, chair, alice, bob, carol, cov, row };
}
const claim = (area: string, owner: string, extra: Record<string, unknown> = {}) => JSON.stringify({ area, owner, status: "open", ...extra });

test("a room with no item/* entry has no coverage field", () => {
  const { h, name, alice, cov } = room();
  h.setBoard(name, alice.id, "claim/x", claim("x", "alice"));
  assert.equal(cov(), undefined);
});

test("items nobody holds are unowned, counted and listed as open", () => {
  const { h, name, chair, cov } = room();
  h.setBoard(name, chair.id, "item/room-size", "How many agents to put into a room");
  h.setBoard(name, chair.id, "item/recruit-timing", "When to use recruits");
  const c = cov()!;
  assert.equal(c.items, 2);
  assert.equal(c.by_state.unowned, 2);
  assert.deepEqual([...c.open].sort(), ["item/recruit-timing", "item/room-size"]);
});

test("claim/<slug>, or a claim naming item/<slug>, makes its holder the owner", () => {
  const { h, name, chair, alice, bob, row, cov } = room();
  h.setBoard(name, chair.id, "item/room-size", "How many agents");
  h.setBoard(name, chair.id, "item/recruit-timing", "When to recruit");
  h.setBoard(name, alice.id, "claim/room-size", claim("room-size", "alice"));
  h.setBoard(name, bob.id, "claim/recruits", claim("recruits", "bob", { note: "covers item/recruit-timing" }));
  assert.deepEqual(row("item/room-size"), { key: "item/room-size", state: "owned", owners: ["alice"], claims: ["claim/room-size"], since: row("item/room-size")!.since });
  assert.equal(row("item/recruit-timing")!.state, "owned");
  assert.deepEqual(row("item/recruit-timing")!.owners, ["bob"]);
  assert.deepEqual(cov()!.open, []);
});

test("a claim made at recruitment counts its recruit as owner, not the chair that asked", () => {
  const { h, name, chair, row, cov } = room();
  h.setBoard(name, chair.id, "item/room-size", "How many agents");
  h.setBoardAs(name, "chair", "claim/room-size", JSON.stringify({ area: "room-size", owner: "chair", team: ["chair", "alice"], status: "open", note: "claimed at recruitment" }));
  assert.deepEqual(row("item/room-size")!.owners, ["alice"]);
  assert.equal(cov()!.multi_claim_seats?.chair, undefined);
});

test("the owner's own done is 'built' until someone else reviews it; a review alone is 'reviewed'; both are 'done'", () => {
  const { h, name, chair, alice, bob, row } = room();
  h.setBoard(name, chair.id, "item/room-size", "How many agents");
  h.setBoard(name, alice.id, "claim/room-size", claim("room-size", "alice"));
  h.setBoard(name, alice.id, "claim/room-size", claim("room-size", "alice", { status: "done" }));
  assert.equal(row("item/room-size")!.state, "built");
  h.setBoard(name, bob.id, "verify/room-size", "checked room-size: the guidance cites its runs");
  assert.equal(row("item/room-size")!.state, "done");
  h.setBoard(name, chair.id, "item/recruit-timing", "When to recruit");
  h.setBoard(name, alice.id, "claim/recruit-timing", claim("recruit-timing", "alice"));
  h.setBoard(name, bob.id, "verify/recruit-timing", "checked recruit-timing so far");
  assert.equal(row("item/recruit-timing")!.state, "reviewed");
});

test("chat naming the area, another seat's note, or a failing check is not a review", () => {
  const { h, name, chair, alice, bob, row } = room();
  h.setBoard(name, chair.id, "item/room-size", "How many agents");
  h.setBoard(name, alice.id, "claim/room-size", claim("room-size", "alice", { status: "done" }));
  h.send(name, bob.id, "@alice how is room-size going?");
  h.setBoard(name, chair.id, "inputs/owner-9", "The owner asked about room-size again.");
  h.setBoard(name, bob.id, "verify/room-size", '{"proposal":"pending","command":"npx tsx scripts/x.ts","cwd":".","base_commit":"aaaaaaa1","base_exit_code":1,"commit":"bbbbbbb2","exit_code":1,"output_tail":"FAIL"}\nfails at the commit');
  assert.equal(row("item/room-size")!.state, "built");
  h.setBoard(name, carolOf(h, name).id, "review/ccccccc3", "Reviewed claim/room-size: the guidance cites its runs.");
  assert.equal(row("item/room-size")!.state, "done");
});
const carolOf = (h: Hub, name: string) => [...h.getRoom(name).participants.values()].find((p) => p.name === "carol")!;

test("a review told to a seat holding two claims counts for neither unless it names one (review/4ddcfe6d)", () => {
  const { h, name, chair, alice, bob, row } = room();
  h.setBoard(name, chair.id, "item/a", "first");
  h.setBoard(name, chair.id, "item/b", "second");
  h.setBoard(name, alice.id, "claim/a", claim("a", "alice", { status: "done" }));
  h.setBoard(name, alice.id, "claim/b", claim("b", "alice", { status: "done" }));
  h.setBoard(name, bob.id, "review/abcdef12", '{"proposal":"pending","command":"npx tsx t.ts","cwd":".","base_commit":"1111111a","base_exit_code":1,"commit":"abcdef12","exit_code":0,"output_tail":"ok"}\nthe fix holds');
  h.getRoom(name).board.get("review/abcdef12")!.toldAuthor = "alice"; // as review_notice sets it for the commit's author
  assert.deepEqual([row("item/a")!.state, row("item/b")!.state], ["built", "built"]);
  h.setBoard(name, bob.id, "review/abcdef12", '{"proposal":"pending","command":"npx tsx t.ts","cwd":".","base_commit":"1111111a","base_exit_code":1,"commit":"abcdef12","exit_code":0,"output_tail":"ok"}\nthe fix for claim/a holds');
  assert.deepEqual([row("item/a")!.state, row("item/b")!.state], ["done", "built"]);
});

test("a verify keyed by a longer slug credits that slug's item, not a shorter one it starts with", () => {
  const { h, name, chair, alice, bob, row } = room();
  h.setBoard(name, chair.id, "item/breakout", "the break-out itself");
  h.setBoard(name, chair.id, "item/breakout-fate", "what happens to it after");
  h.setBoard(name, alice.id, "claim/breakout", claim("breakout", "alice", { status: "done" }));
  h.setBoard(name, carolOf(h, name).id, "claim/breakout-fate", claim("breakout-fate", "carol", { status: "done" }));
  h.setBoard(name, bob.id, "verify/breakout-fate-dev", "checked the fate line in a dev room");
  assert.deepEqual([row("item/breakout")!.state, row("item/breakout-fate")!.state], ["built", "done"]);
});

test("an item whose every owner left without a review is orphaned and open again", () => {
  const { h, name, chair, alice, row, cov } = room();
  h.setBoard(name, chair.id, "item/room-size", "How many agents");
  h.setBoard(name, alice.id, "claim/room-size", claim("room-size", "alice"));
  h.leave(name, alice.id, "out of time");
  assert.equal(row("item/room-size")!.state, "orphaned");
  assert.deepEqual(cov()!.open, ["item/room-size"]);
});

test("'dropped: <why>' or 'done: <key>' on the item's first line settles it", () => {
  const { h, name, chair, row, cov } = room();
  h.setBoard(name, chair.id, "item/room-size", "dropped: the owner ruled it out at #12\nHow many agents");
  h.setBoard(name, chair.id, "item/recruit-timing", "done: decision/recruit-timing\nWhen to recruit");
  assert.equal(row("item/room-size")!.state, "dropped");
  assert.equal(row("item/recruit-timing")!.state, "done");
  assert.deepEqual(cov()!.open, []);
});

test("seats holding two or more live claims are named", () => {
  const { h, name, chair, alice, bob, cov } = room();
  h.setBoard(name, chair.id, "item/a", "first");
  h.setBoard(name, alice.id, "claim/a", claim("a", "alice"));
  h.setBoard(name, alice.id, "claim/b", claim("b", "alice"));
  h.setBoard(name, bob.id, "claim/c", claim("c", "bob"));
  assert.deepEqual(cov()!.multi_claim_seats, { alice: 2 });
});

test("a free seat is offered an unowned item; a seat holding a claim is not", () => {
  const { h, name, chair, alice, bob } = room();
  h.setBoard(name, chair.id, "item/room-size", "How many agents");
  h.setBoard(name, alice.id, "claim/other", claim("other", "alice"));
  const kinds = (p: typeof bob) => openWork(h, h.getRoom(name), p).filter((w) => w.kind === "item_unowned").map((w) => w.key);
  assert.deepEqual(kinds(bob), ["item/room-size"]);
  assert.deepEqual(kinds(alice), []);
});

test("a coverage event is logged when the ledger changes, and not for a write that leaves it as it was", () => {
  const dir = mkdtempSync(join(tmpdir(), "coverage-"));
  const { h, name, chair, alice } = room(dir);
  h.setBoard(name, chair.id, "item/room-size", "How many agents");
  h.setBoard(name, alice.id, "claim/room-size", claim("room-size", "alice"));
  h.setBoard(name, alice.id, "evidence/unrelated", "notes");
  h.setBoard(name, alice.id, "claim/room-size", claim("room-size", "alice", { note: "same state" }));
  const log = () => readFileSync(join(dir, `${name}.jsonl`), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const events = log().filter((e) => e.type === "coverage");
  assert.equal(events.length, 2, JSON.stringify(events));
  assert.deepEqual([events[0].unowned, events[1].owned], [1, 1]);
  assert.deepEqual(events[0].open, ["item/room-size"]);
  assert.deepEqual([events[1].states, events[1].owners], [{ "item/room-size": "owned" }, { "item/room-size": ["alice"] }]);
  // the replay reads the same events back per item: time to owner, who held it, how it ended
  h.leave(name, alice.id, "out of time");
  const [r] = replayCoverage(log());
  assert.deepEqual([r.key, r.end, r.owners, typeof r.min_to_owner, r.min_open >= 0], ["item/room-size", "orphaned", ["alice"], "number", true]);
});

test("a launcher can seed item/* entries through the resources route, as it does resource/*", () => {
  const h = new Hub();
  const items = [{ key: "item/room-size", text: "How many agents" }, { key: "item/recruit-timing", text: "When to recruit" }];
  assert.deepEqual(h.seedResources("coverage-seeded", items).keys, ["item/room-size", "item/recruit-timing"]);
  assert.throws(() => h.seedResources("coverage-seeded", [{ key: "other/x", text: "no" }]), /resource\/<name>/);
});

test("swarm --resources seeds an item/<slug> from a '## item: <name>' heading, and resource/<slug> from any other", () => {
  const parsed = parseResources("# brief problems\n\n## item: Room size\nHow many agents to put into a room\n\n## Item: recruit timing\nWhen to recruit\n\n## rooms dataset\n/tmp/rooms.jsonl\n");
  assert.deepEqual(parsed.map((r) => r.key), ["item/room-size", "item/recruit-timing", "resource/rooms-dataset"]);
  assert.equal(parsed[0].text, "Room size\nHow many agents to put into a room");
  assert.deepEqual(new Hub().seedResources("coverage-launch", parsed).keys, ["item/room-size", "item/recruit-timing", "resource/rooms-dataset"]);
});

test("the run report prints the lead room's coverage, and nothing when the room had no items", () => {
  const { h, name, chair, alice } = room();
  h.setBoard(name, chair.id, "item/room-size", "How many agents");
  h.setBoard(name, chair.id, "item/recruit-timing", "When to recruit");
  h.setBoard(name, alice.id, "claim/room-size", claim("room-size", "alice"));
  const run = (payload: Record<string, unknown>): RunResult => ({ schemaVersion: 1, run: { id: "s", startedAt: "a", completedAt: "b", task: "t", doneWhen: "d" }, project: { cwd: ".", canonicalPath: ".", git: null },
    leadRoom: name, rooms: [{ name, payload, error: null, transcript: { text: "T", sourceUrl: "u", error: null } }], verifier: { name: "verifier", output: null }, reportPath: "r", artifactPath: "a" });
  const md = renderRunReport(run(JSON.parse(JSON.stringify(h.summary(h.getRoom(name))))));
  assert.match(md, /## Coverage\n\n\| item \| state \| owners \|/);
  assert.match(md, /\| item\/room-size \| owned \| alice \|/);
  assert.match(md, /Nobody on: item\/recruit-timing\./);
  assert.ok(!renderRunReport(run({ state: "open", conclusion: null, board: {} })).includes("## Coverage"));
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
console.log(failed ? `\n${failed} of ${cases.length} failed` : `\nCOVERAGE OK (${cases.length} cases)`);
process.exit(failed ? 1 : 0);
