/**
 * item/report-wiring: RSI-7's four measurements (opening spread, held width at the reveal, winner provenance, steer split)
 * were printed only by hand commands. This pins that the run report, result.json, run-metrics and runs-table carry them
 * per room, with coverage and unknown reasons, that a missing or failing embedder degrades the two blocks that need it to
 * "embedder absent" / an error string while the rest still print, and that the numbers are the scripts' own cores.
 * Offline: a fake embedder stands in for Ollama (scripts/measurements-parity.ts checks the real one against the scripts).
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const mod = await import("../src/measurements/room.js").catch(() => null);
assert.ok(mod, "src/measurements/room.ts exists");
const { measureRoom, renderMeasurements, renderMeasurementsTable, embedderFromEnv } = mod;
const { openingsOf, spreadOf } = await import("../src/measurements/opening-spread.js");
const { extract, width } = await import("../src/measurements/framing-width.js");
const { provenance } = await import("../src/measurements/winner-provenance.js");
const { collectSteers } = await import("../src/measurements/steer-split.js");
const { collectRoomMeasurements, runMeasurements, measurementsLogLine } = await import("../src/measurements/collect.js");
const { renderRunReport } = await import("../src/result.js");

const T0 = Date.parse("2026-10-29T21:00:00.000Z");
const at = (min: number) => new Date(T0 + min * 60_000).toISOString();
const R = "swarm-210000-abcd-room";
const seat = (id: string, name: string, agent: string, role = "worker") => ({ type: "join", room: R, p: { id, name, agent, role, joinedAt: at(0) } });
const board = (key: string, by: string, min: number, text: string) => ({ type: "board", room: R, key, entry: { text, by, updatedAt: at(min) } });
const chat = (seq: number, from: { id: string; name: string; agent: string }, min: number, content: string) => ({ type: "message", room: R, msg: { seq, id: `m_${seq}`, room: R, kind: "chat", from, content, ts: at(min) } });
const chair = { id: "p_c", name: "chair-claude", agent: "claude" };
const events = [
  { type: "room", room: R, createdAt: at(0), opts: { topic: "GOAL: pick the cache for the hub. Your starting area: item/cache", chair: "chair-claude" } },
  seat("p_a", "alice", "claude"), seat("p_b", "bob", "codex"), seat("p_d", "dora", "claude"), seat("p_v", "verifier", "claude", "verifier"), seat("p_c", "chair-claude", "claude", "chair"),
  { type: "opening", room: R, pid: "p_a", content: "Use an LRU cache keyed by room; eviction by size." },
  { type: "opening", room: R, pid: "p_b", content: "Use a write-through cache in front of the log; measure hit rate first." },
  { type: "opening", room: R, pid: "p_d", content: "No cache: the log read is already fast; profile before building." },
  { type: "opening", room: R, pid: "p_v", content: "I will verify by rerunning the benchmark." },
  { type: "openings_revealed", room: R, ts: at(1), ideas_seeded: [] },
  board("claim/cache", "alice", 2, JSON.stringify({ item: "item/cache", owner: "alice", status: "building the LRU" })),
  chat(10, chair, 3, "@alice please run the benchmark before you build; blocked on the port, use 7881"),
  board("evidence/bench", "bob", 5, "hit rate 0.82 on the RSI-7 log replay"),
  { type: "work", room: R, pid: "p_a", cls: "run", tool: "Bash", target: "npm test", ts: at(4) },
  board("inbox/chair/steer", "chair-claude", 6, "reframe: rather than a cache, consider whether the read is the bottleneck"),
  { type: "proposal", room: R, proposal: { id: "prop_1", by: { id: "p_a", name: "alice" }, text: "Use an LRU cache keyed by room with size eviction; hit rate 0.82.", createdAt: at(8) } },
  { type: "vote", room: R, pid: "p_b", proposalId: "prop_1", entry: { vote: "agree", ts: at(9) } },
  { type: "state", room: R, state: "concluded", ts: at(10), conclusion: { proposalId: "prop_1", text: "Use an LRU cache keyed by room with size eviction; hit rate 0.82.", decidedAt: at(10) } },
];
// deterministic 16-dim vectors from the text's hash: unrelated texts land apart, equal texts at cosine 1
const vec = (t: string) => [...createHash("sha256").update(t).digest()].slice(0, 16).map((b) => b / 255 - 0.5);
const fake = { model: "embeddinggemma", embed: async (texts: string[]) => texts.map(vec) };

// 1. no embedder: the two embedding blocks say why, the other two still measure, nothing throws
const none: any = await measureRoom(events as any[], R, {});
assert.equal(none.schema, "room-measurements-v1");
assert.equal(none.embedder.status, "absent");
assert.equal(none.opening_spread.status, "unknown");
assert.ok(none.opening_spread.unknown.some((u: string) => /embedder absent/.test(u)), "spread says embedder absent");
assert.deepEqual(none.opening_spread.coverage, { worker_openings: 3, embedded: 0 }, "the verifier's opening is not a worker opening");
assert.equal(none.winner_provenance.status, "unknown");
assert.ok(none.winner_provenance.unknown.some((u: string) => /embedder absent/.test(u)));
assert.equal(none.winner_provenance.value.candidate_revisions, provenance(events as any[], R).revisions.length);
assert.equal(none.winner_provenance.value.revisions_after_peer_delivery, null, "a build without delivery receipts gives no delivery count, not 0");
assert.equal(none.winner_provenance.value.revisions_after_peer_framing_read, 0);
assert.equal(none.winner_provenance.value.revisions_with_explicit_receipt, 0);
assert.equal(none.winner_provenance.value.board_channel, "peer_board_reads", "this build's provenance has no trigger_board_reads");
// after the merge with item/delivery-receipts the board channel reads trigger_board_reads, never the key regex (review/8c98df0f.verifier)
const read = (key: string) => ({ key });
assert.deepEqual(mod.boardChannel([{ peer_board_reads: [read("decision/x")] }, { peer_board_reads: [read("resource/x")] }]), { source: "peer_board_reads", count: 1 });
assert.deepEqual(mod.boardChannel([{ peer_board_reads: [read("decision/x")], trigger_board_reads: [] }, { peer_board_reads: [read("evidence/y")], trigger_board_reads: [{ key: "evidence/y" }] }]), { source: "trigger_board_reads", count: 1 });
const open = await measureRoom(events.filter((e) => e.type !== "state") as any[], R, {});
assert.match(renderMeasurements([open]), /\*\*Winner provenance\*\*: no winner \(not concluded\)/, "an open room says so before any cosine");
assert.equal(none.framing_width.status, "unknown", "held width needs a validated labeller");
assert.equal(none.framing_width.value.held_at_reveal, null);
assert.equal(none.framing_width.value.first_evidence_min, 4, "evidence/bench at minute 5 is 4 min after the reveal");
assert.equal(none.framing_width.value.first_invocation_min, 3);
assert.equal(none.steer_split.status, "ok");
const steers = collectSteers([{ file: R, events: events as any[] }]);
assert.equal(none.steer_split.value.steers, steers.length);
assert.deepEqual([none.steer_split.value.chair, none.steer_split.value.notes], [1, 1], "one chair chat and one inbox note");

// 2. with an embedder: the spread and provenance numbers are the scripts' own cores
const withE: any = await measureRoom(events as any[], R, { embedder: fake });
assert.equal(withE.embedder.status, "present");
const ro = openingsOf(events as any[], R);
assert.deepEqual(withE.opening_spread.value, { ...spreadOf(ro, ro.openings.map((o) => vec(o.text)), 0.599), cut: 0.599 });
assert.equal(withE.opening_spread.coverage.embedded, 3);
const texts = (() => { const p = provenance(events as any[], R); return [...new Set([...p.openings, ...p.seeded, ...(p.final ? [p.final] : [])].map((d) => d.embedded_text).concat(p.brief?.embedded_text ?? "").filter(Boolean))]; })();
const pv = provenance(events as any[], R, { vectors: new Map(texts.map((t) => [t, vec(t)])) });
assert.equal(withE.winner_provenance.value.nearest_opening.author, pv.opening_matches[0]!.author);
assert.equal(withE.winner_provenance.value.nearest_opening.similarity, Math.round(pv.opening_matches[0]!.similarity! * 1000) / 1000);
assert.equal(withE.winner_provenance.value.label, null, "no hand label: origin unknown");
assert.ok(withE.winner_provenance.unknown.includes("no hand label: origin unknown"));
// a model without a fitted cut gets cosines but no framing count
const other: any = await measureRoom(events as any[], R, { embedder: { ...fake, model: "nomic-embed-text" } });
assert.equal(other.opening_spread.value.framings, null);
assert.ok(other.opening_spread.unknown.some((u: string) => /no fitted cut/.test(u)));

// 3. a failing embedder is an error string in its blocks; width and steers still measure
const broken: any = await measureRoom(events as any[], R, { embedder: { model: "embeddinggemma", embed: async () => { throw new Error("connect ECONNREFUSED 127.0.0.1:11434"); } } });
assert.equal(broken.embedder.status, "error");
assert.equal(broken.opening_spread.status, "error");
assert.match(broken.opening_spread.error, /ECONNREFUSED/);
assert.equal(broken.steer_split.status, "ok");
assert.equal(broken.framing_width.value.statements, none.framing_width.value.statements);

// 3b. one shared embedding budget, spread and provenance embedding at once: a slow embedder costs only its own blocks
// and the launcher's wait outlasts the whole budget, so width and steers always reach result.json (attack/decision/report-wiring 1)
const slow = (ms: number) => ({ model: "embeddinggemma", embed: (texts: string[]) => new Promise<number[][]>((res) => setTimeout(() => res(texts.map(vec)), ms)) });
let t = Date.now();
const late: any = await measureRoom(events as any[], R, { embedder: slow(1500), budgetMs: 600 } as any);
assert.ok(Date.now() - t < 1200, `a slow embedder is cut at the budget, not waited for twice (took ${Date.now() - t} ms)`);
assert.deepEqual([late.opening_spread.status, late.winner_provenance.status, late.steer_split.status, late.embedder.status], ["error", "error", "ok", "error"]);
assert.match(late.opening_spread.error, /exceeded the 600 ms measurement budget/);
assert.equal(late.framing_width.value.statements, none.framing_width.value.statements);
t = Date.now();
const both: any = await measureRoom(events as any[], R, { embedder: slow(400), budgetMs: 3000 } as any);
assert.deepEqual([both.opening_spread.status, both.winner_provenance.status], ["ok", "ok"]);
assert.ok(Date.now() - t < 700, `spread and provenance embed at once, not one after the other (took ${Date.now() - t} ms)`);
assert.ok((await import("../src/measurements/collect.js")).COLLECT_TIMEOUT_MS >= mod.MEASURE_BUDGET_MS + 10_000, "the launcher waits past the hub's whole embedding budget");

// 4. hand labels: held width from the labeller, the script's width() on the same labels; a hand provenance label wins
const labelled: any = await measureRoom(events as any[], R, { widthLabels: { [R]: { "*": "A", "2": "B" } }, provenanceLabels: [{ room: R, origin: "midroom", adjudicated_origin: "opening" }] });
const x = extract(events as any[], R), w = width(x, (i) => { const s = x.stmts[i]!, k = String(s.adopts ?? i); return ({ "*": "A", "2": "B" } as Record<string, string>)[k] ?? "A"; });
assert.equal(labelled.framing_width.status, "ok");
assert.equal(labelled.framing_width.value.held_at_reveal, w.held_at_reveal);
assert.equal(labelled.framing_width.value.held_at_reveal, 2, "two labels among the openings at the reveal");
assert.equal(labelled.winner_provenance.value.label, "opening");
assert.equal(labelled.winner_provenance.value.label_source, "hand (adjudicated)");
// 4b. labels that miss a statement give no width: an unlabelled statement is not its own framing (attack/decision/report-wiring 2)
const partial: any[] = [];
for (const l of [{}, { "2": "B" }] as Record<string, string>[]) {
  const m: any = await measureRoom(events as any[], R, { widthLabels: { [R]: l } });
  assert.equal(m.framing_width.status, "unknown", `labels ${JSON.stringify(l)} are not a labeller for every statement`);
  assert.equal(m.framing_width.value.held_at_reveal, null);
  assert.ok(m.framing_width.coverage.labelled < m.framing_width.coverage.statements);
  assert.match(m.framing_width.unknown[0], new RegExp(`^hand labels cover ${m.framing_width.coverage.labelled}/${m.framing_width.coverage.statements} statements`));
  partial.push(m);
}
assert.match(renderMeasurements(partial), /\*\*Held width at the reveal\*\*: unknown \(hand labels cover 0\//);

// 5. the report section: every unknown says why, nothing prints undefined or NaN
const md = renderMeasurements([none, withE, broken, labelled], ["swarm-210000-abcd-g1: HTTP 404"]);
assert.match(md, /^## Measurements/);
assert.match(md, /Embedder: absent \(CHATROOM_EMBED_URL unset\)/);
assert.match(md, /\*\*Opening spread\*\*: unknown \(embedder absent/);
assert.match(md, /\*\*Opening spread\*\*: 3 worker openings \(mixed\(claude\+codex\)\), mean cosine/);
assert.match(md, /\*\*Held width at the reveal\*\*: unknown \(no validated labeller/);
assert.match(md, /\*\*Held width at the reveal\*\*: 2 \(hand labels/);
assert.match(md, /present at the reveal \(hand \(adjudicated\)\)/);
assert.match(md, /error: connect ECONNREFUSED/);
assert.match(md, /\*\*Steer split\*\*: 2 steer\(s\): 0 human, 1 chair, 1 inbox note/);
assert.match(md, /swarm-210000-abcd-g1: HTTP 404/);
assert.doesNotMatch(md, /undefined|NaN/);
const table = renderMeasurementsTable([none, withE]);
assert.match(table, /\| room \| embedder \|/);
assert.match(table, /Measured: spread 1\/2, held width 0\/2 \(hand labels only\), provenance 1\/2, steers 2\/2; embedder 1\/2/);
assert.match(measurementsLogLine(none), /spread unknown \(embedder absent .*steers ok; embedder absent/);

// 6. embedder config: unset means absent, never a localhost guess
assert.equal(embedderFromEnv({}), null);
assert.equal(embedderFromEnv({ CHATROOM_EMBED_URL: " " }), null);
assert.equal(embedderFromEnv({ CHATROOM_EMBED_URL: "http://127.0.0.1:1/api/embed" })?.model, "embeddinggemma");

// 7. the launcher: one fetch per room, a bad answer is that room's error, the lead room first in result.json
const rooms: any[] = [{ name: "g1" }, { name: R }];
await collectRoomMeasurements(rooms, "http://hub", { fetch: (async (url: string) => url.includes(encodeURIComponent(R)) ? new Response(JSON.stringify(none)) : new Response("no", { status: 404 })) as any });
assert.equal(rooms[1].measurements.room, R);
assert.equal(rooms[0].measurementsError, "Error: HTTP 404");
const run = runMeasurements(rooms, R);
assert.deepEqual([run.rooms.map((m: any) => m.room), run.errors], [[R], ["g1: Error: HTTP 404"]]);
await collectRoomMeasurements(rooms, "http://hub", { fetch: (async () => new Response(JSON.stringify({ ...none, room: "other" }))) as any });
assert.match(rooms[1].measurementsError, /schema mismatch/, "a payload for another room is not this room's");
// a hub whose embedder hangs still answers inside the launcher's wait, with the label-free blocks
const hung = { model: "embeddinggemma", embed: () => new Promise<number[][]>(() => {}) };
const slowHub: any[] = [{ name: R }];
await collectRoomMeasurements(slowHub, "http://hub", { timeoutMs: 1500, fetch: ((_: string, init: { signal: AbortSignal }) => new Promise((res, rej) => {
  init.signal.addEventListener("abort", () => rej(init.signal.reason));
  measureRoom(events as any[], R, { embedder: hung, budgetMs: 300 } as any).then((m) => res(new Response(JSON.stringify(m))));
})) as any });
assert.equal(slowHub[0].measurementsError, undefined, `a hung embedder costs the launcher no blocks: ${slowHub[0].measurementsError}`);
assert.deepEqual([slowHub[0].measurements.steer_split.status, slowHub[0].measurements.opening_spread.status], ["ok", "error"]);

// 8. report.md prints the section from result.json's block
const report = renderRunReport({ schemaVersion: 1, run: { id: "swarm-210000-abcd", startedAt: at(0), completedAt: at(10), task: "t", doneWhen: "d" }, project: { cwd: "/x", canonicalPath: "/x", git: null },
  leadRoom: R, rooms: [{ name: R, payload: { state: "concluded", conclusion: { text: "c" } }, error: null, transcript: { text: "", sourceUrl: "", error: null } }], verifier: { name: "verifier", output: null },
  reportPath: "/x/report.md", artifactPath: "/x/result.json", measurements: { schema: "run-measurements-v1", rooms: [none], errors: [] } } as any);
assert.match(report, /## Measurements[\s\S]*### swarm-210000-abcd-room[\s\S]*\*\*Steer split\*\*/);

// 9. the scripts: run-metrics --json and runs-table print the same block with no embedder
const dir = mkdtempSync(join(tmpdir(), "measurements-"));
try {
  const file = join(dir, `${R}.jsonl`);
  writeFileSync(file, events.map((e) => JSON.stringify(e)).join("\n") + "\n");
  const env = { ...process.env }; delete env.CHATROOM_EMBED_URL;
  const rm = spawnSync(process.execPath, ["--import", "tsx", "scripts/run-metrics.ts", file, "--json"], { encoding: "utf8", env });
  assert.equal(rm.status, 0, rm.stderr);
  const j = JSON.parse(rm.stdout);
  assert.equal(j.measurements.embedder.status, "absent");
  assert.equal(j.measurements.steer_split.value.steers, 2);
  const rmText = spawnSync(process.execPath, ["--import", "tsx", "scripts/run-metrics.ts", file], { encoding: "utf8", env });
  assert.match(rmText.stdout, /## Measurements/);
  const rt = spawnSync(process.execPath, ["--import", "tsx", "scripts/runs-table.ts", file], { encoding: "utf8", env });
  assert.equal(rt.status, 0, rt.stderr);
  assert.match(rt.stdout, /\| swarm-210000-abcd-room \| absent \| embedder absent \| unknown \|/);
  writeFileSync(join(dir, "w.json"), JSON.stringify({ [R]: { "*": "A" } }));
  const rtl = spawnSync(process.execPath, ["--import", "tsx", "scripts/runs-table.ts", file, "--width-labels", join(dir, "w.json"), "--json"], { encoding: "utf8", env });
  assert.equal(rtl.status, 0, rtl.stderr);
  assert.equal(JSON.parse(rtl.stdout)[0].measurements.framing_width.value.held_at_reveal, 1, "a label file is a flag value, not a room log");
} finally { rmSync(dir, { recursive: true, force: true }); }
console.log("MEASUREMENTS OK");
