/**
 * Re-research shows in the record (inputs/owner-4: "the agents must ensure they're not researching what has already
 * been researched ... please ensure it's covered in a form of telemetry"). settled.ts tells every seat what was already
 * read, but the room log never said what a seat was told, so whether the list works could not be measured: a NO_CARRY
 * arm looked like a run that got the list (decision/telemetry-gaps; replay of 332 logs: 7 of 238 paper/repo fetches and
 * 24 of 132 sources/* entries repeated an id the list had, 60 fetches repeated another seat's in the same run).
 * 1. settled.ts: the list carries repos and packages (refsIn), and decision records still in docs/decisions/proposed/
 *    add their sources (not their axes); carriedSummary() is what a seat was told, as ids.
 * 2. The reader: per room, fetches of a carried id, of an id another seat fetched first, of an id another seat had
 *    already summarised on the board, and sources/* re-summarising a carried id; "list unknown" without the event.
 * 3. runs-table and run-metrics show it, and runs-table shows reaps (reap_check when the log has it, else session closed).
 * 4. A served hub records `carried`: from the launcher's POST /rooms/:room/carried, and from the spawner per recruit.
 * Run: npx tsx scripts/re-research-regression.ts
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { carriedSummary, settledAxes } from "../src/settled.js";
import { reResearch } from "../src/telemetry/re-research.js";
import { renderRunsTable, runRow } from "../src/run-timeline.js";
import { parseRoomLog, renderMetrics, runMetrics } from "../src/run-metrics.js";
import { ownHubPort } from "./lib/own-hub.js";

// ---------- 1. what a seat is told ----------
const cwd = mkdtempSync(join(tmpdir(), "re-research-"));
mkdirSync(join(cwd, "docs", "decisions", "proposed"), { recursive: true });
writeFileSync(join(cwd, "docs", "decisions", "axis-one.md"), "## Target 1 — Axis one\n\n**Ruling:** keep it.\n\nEvidence: arXiv:2401.00001 and https://github.com/Owner/Repo.\n");
writeFileSync(join(cwd, "docs", "decisions", "proposed", "rsi-four.md"), "## Target 1 — Proposed thing\n\n**Decision:** not yet settled.\n\nSources: arXiv:2604.09408, doi:10.1145/2363.2433.\n");
const dir = join(cwd, "swarms", "swarm-000000-prev");
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, "report.md"), "# prev\n");
writeFileSync(join(dir, "result.json"), JSON.stringify({ rooms: [{ payload: { board: { "sources/jmazzini-bot": { text: "https://github.com/jmazzini/5m-poly-bot: read, never run" }, "sources/pkg": { text: "https://pypi.org/project/py-clob-client/ client docs" } } } }] }));
utimesSync(join(dir, "report.md"), new Date(Date.now() - 60_000), new Date(Date.now() - 60_000));
const told = settledAxes(cwd);
assert.match(told, /axis-one/, "a settled record is an axis");
assert.doesNotMatch(told.split("SOURCES ALREADY READ")[0], /rsi-four|Proposed thing/, "a proposed record is not an axis: it is not settled");
const read = told.slice(told.indexOf("SOURCES ALREADY READ"));
assert.match(read, /arXiv:2604\.09408/, "a proposed record's sources were read, so they are listed");
assert.match(read, /doi:10\.1145\/2363\.2433/);
assert.match(read, /gh:owner\/repo/, "a repo in a decision record is a read source");
assert.match(read, /gh:jmazzini\/5m-poly-bot/, "a repo a prior run summarised under sources/* reaches the next run");
assert.match(read, /pypi:py-clob-client/, "so does a package");
const sum = carriedSummary(told);
assert.ok(sum.ids.includes("arXiv:2401.00001") && sum.ids.includes("gh:jmazzini/5m-poly-bot") && sum.ids.includes("arXiv:2604.09408"), `ids: ${sum.ids.join(", ")}`);
assert.equal(sum.axes, 1, "one settled axis");
assert.equal(sum.chars, told.length);
assert.deepEqual(carriedSummary(""), { ids: [], axes: 0, chars: 0 }, "a NO_CARRY seat was told nothing");
rmSync(cwd, { recursive: true, force: true });

// ---------- 2. the reader ----------
const T = (min: number) => new Date(Date.parse("2026-10-26T01:00:00Z") + min * 60_000).toISOString();
const join_ = (id: string, name: string, role = "worker") => ({ type: "join", room: "r", p: { id, name, role, agent: "claude" } });
const work = (pid: string, target: string, min: number, tool = "WebFetch") => ({ type: "work", room: "r", pid, cls: "web", tool, target, ts: T(min) });
const board = (key: string, by: string, text: string, min: number) => ({ type: "board", room: "r", key, entry: { text, by, updatedAt: T(min) } });
const base = [
  { type: "room", room: "r", opts: { topic: "t" }, createdAt: T(0) },
  join_("pa", "a"), join_("pb", "b"), join_("pc", "c"), join_("pv", "verifier", "verifier"),
];
const log = [
  ...base,
  { type: "carried", room: "r", from: "launcher", seats: ["a", "b", "c", "verifier"], ids: ["arXiv:2401.00001", "gh:owner/repo"], axes: 1, chars: 900, ts: T(0) },
  work("pa", "arxiv.org/abs/2401.00001", 1),                      // a carried id fetched again
  work("pa", "arxiv.org/abs/2502.00002", 2),                      // new
  work("pb", "arxiv.org/pdf/2502.00002v2", 3),                    // another seat fetches what a fetched first (no summary yet)
  board("sources/arXiv:2502.00002", "a", "arXiv:2502.00002: what it shows", 4),
  work("pc", "export.arxiv.org/abs/2502.00002", 5),               // after a's summary was on the board
  work("pa", "arxiv.org/abs/2502.00002", 6),                      // the summary's own author reading again is not re-research
  board("sources/2401.00001", "b", "arXiv:2401.00001 again", 7), // a carried id summarised again
  work("pv", "arxiv.org/abs/2502.00002", 8),                      // the verifier checking a cited source: counted apart
  work("pb", "api.github.com/repos/Owner/Repo/contents", 9, "Bash"), // a carried repo, through a script
  work("pb", "docs.polymarket.com/api", 10),                      // no ref: not counted
];
const r = reResearch(log);
assert.deepEqual(r, {
  listKnown: true, carriedIds: 2, fetches: 7,
  carriedFetches: 2, repeatFetches: 1, afterSummary: 1, verifierRepeats: 1, carriedSummaries: 1,
}, JSON.stringify(r));
const unknown = reResearch(log.filter((e) => e.type !== "carried"));
assert.equal(unknown.listKnown, false, "no carried event: what the seats were told is unknown");
assert.equal(unknown.carriedFetches, undefined, "...so across-run re-research is unknown, never 0");
assert.equal(unknown.repeatFetches, 1, "in-run repeats need no list");
const none = reResearch([...base, { type: "carried", room: "r", from: "launcher", seats: ["a"], ids: [], axes: 0, chars: 0, no_carry: true, ts: T(0) }, work("pa", "arxiv.org/abs/2401.00001", 1)]);
assert.equal(none.carriedFetches, 0, "a NO_CARRY arm was told nothing, so it re-fetched nothing it had been told");
assert.equal(none.listKnown, true);
// the launcher posts after its seats start, so its event can land after a seat's first call; a launcher event that names
// no seats covers every seat it started
const late = reResearch([...base, work("pa", "arxiv.org/abs/2401.00001", 0.5), { type: "carried", room: "r", from: "launcher", ids: ["arXiv:2401.00001"], axes: 1, chars: 50, ts: T(1) }]);
assert.equal(late.carriedFetches, 1, "what the seat was told counts for a fetch logged before the event");
assert.equal(late.listKnown, true);

// a recruit's own list counts for the recruit (spawner events name their seats)
const recruitLog = [...base, join_("pr", "recruit-1", "recruit"),
  { type: "carried", room: "r", from: "spawner", seats: ["recruit-1"], ids: ["arXiv:2603.00003"], axes: 0, chars: 100, ts: T(1) },
  work("pr", "arxiv.org/abs/2603.00003", 2), work("pa", "arxiv.org/abs/2603.00003", 3)];
const rr = reResearch(recruitLog);
assert.equal(rr.carriedFetches, 1, "the recruit was told; seat a was not (no launcher event): only the recruit's fetch is a carried re-fetch");
assert.equal(rr.listKnown, false, "seat a's list is unknown, so the room's is not wholly known");
// a recruit with no spawner event of its own (an older hub, or one that joined by hand) is not covered by the launcher's
// list: the launcher never told it anything (review/f8faed7f F1)
const untold = reResearch([...base, join_("pr", "recruit-1", "recruit"),
  { type: "carried", room: "r", from: "launcher", ids: ["arXiv:2401.12345"], axes: 1, chars: 50, ts: T(0) },
  work("pr", "arxiv.org/abs/2401.12345", 1)]);
assert.equal(untold.carriedFetches, 0, "the recruit was never told the launcher's list, so its fetch is not a carried re-fetch");
assert.equal(untold.listKnown, false, "the recruit's list is unknown");

// ---------- 3. the readers show it ----------
const row = runRow(log);
assert.deepEqual(row.reResearch, r);
const table = renderRunsTable([row]);
assert.match(table, /\| re-research \|/, "runs-table has the column");
assert.match(table, /carried 2 of 7, 1 re-summarised, in-run 2 \(\+1 verifier\)/, table);
assert.match(renderRunsTable([runRow(log.filter((e) => e.type !== "carried"))]), /list unknown, in-run 2 \(\+1 verifier\)/);
assert.match(renderMetrics(runMetrics(log)), /Re-research: 7 paper or repo fetches; 2 of them fetched an id the seat was told was already read/);

// reaps: reap_check events when the log has them, else session closed lines; never both added
const reapOld = [...base, { type: "session", room: "r", event: "closed", participant: "pa", name: "a", reason: "MCP session closed without leave_room (idle 30 min, reaped)", seat_kept: false, ts: T(40) },
  { type: "session", room: "r", event: "closed", participant: "pb", name: "b", reason: "MCP session closed without leave_room (idle 30 min, reaped)", seat_kept: true, ts: T(41) },
  { type: "session", room: "r", event: "moved", participant: "pc", name: "c", reason: "reconnected", seat_kept: true, ts: T(42) }];
assert.deepEqual(runRow(reapOld).reaps, { reaped: 1 }, "an old log: a session closed by the reaper that took the seat");
const reapNew = [...reapOld, { type: "reap_check", room: "r", participant: "pa", name: "a", outcome: "reaped", alive_by: [], idle_min: 31, ts: T(40) },
  { type: "reap_check", room: "r", participant: "pc", name: "c", outcome: "spared", alive_by: ["stream"], idle_min: 31, ts: T(42) },
  { type: "reap_check", room: "r", participant: "pv", name: "verifier", outcome: "spared", alive_by: ["process"], idle_min: 35, ts: T(45) }];
assert.deepEqual(runRow(reapNew).reaps, { reaped: 1, spared: 2 }, "reap_check counted by outcome, the session lines not added on top");
assert.match(renderRunsTable([runRow(reapNew)]), /\| reaped 1, spared 2 \|/);
assert.equal(runRow(base).reaps, undefined, "no reap at all: no entry");

// ---------- 4. a served hub records what seats were told ----------
const PORT = await ownHubPort(Number(process.env.PORT ?? 20_000 + Math.floor(Math.random() * 20_000)));
assert.notEqual(PORT, 7717, "never the live hub");
const HTTP = `http://127.0.0.1:${PORT}`;
const data = mkdtempSync(join(tmpdir(), "re-research-hub-"));
const server = spawn("npx", ["tsx", "src/index.ts"], { env: { ...process.env, PORT: String(PORT), CHATROOM_DATA_DIR: data, CHATROOM_SPAWN_DRY: "1", CHATROOM_INSECURE_LOCAL: "1", CHATROOM_NUDGE_MS: "0" }, stdio: "ignore" });
process.on("exit", () => { server.kill(); rmSync(data, { recursive: true, force: true }); });
for (let i = 0; ; i++) {
  try { await fetch(`${HTTP}/`); break; } catch { if (i > 150) throw new Error("hub did not start"); await new Promise((res) => setTimeout(res, 200)); }
}
const ROOM = "re-research-room";
const client = new Client({ name: "lead", version: "0.0.0" });
await client.connect(new StreamableHTTPClientTransport(new URL(`${HTTP}/mcp?seat=key-aaaaaaaa`)));
const call = async (name: string, args: Record<string, unknown>) => (await client.callTool({ name, arguments: args })) as { isError?: boolean; content: { text: string }[] };
const j = await call("join_room", { room: ROOM, name: "lead", agent: "test" });
assert.notEqual(j.isError, true, j.content[0]?.text);
const post = async (path: string, body: unknown) => {
  const res = await fetch(`${HTTP}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { status: res.status, text: await res.text() };
};
const events = () => parseRoomLog(readFileSync(join(data, `${ROOM}.jsonl`), "utf8"));

assert.equal((await post(`/rooms/${ROOM}/carried`, { text: 42 })).status, 400, "text must be a string");
assert.equal((await post(`/rooms/no-such-room/carried`, { text: "" })).status, 400);
const SETTLED = "SETTLED AXES (...):\n- axis-one: Axis one — keep it\n\nSOURCES ALREADY READ (...): arXiv:2401.00001, doi:10.1145/2363.2433\n";
assert.equal((await post(`/rooms/${ROOM}/carried`, { text: SETTLED, seats: ["lead", "w-1"] })).status, 200);
assert.equal((await post(`/rooms/${ROOM}/carried`, { text: "", no_carry: true, seats: ["arm-b"] })).status, 200);
const fromLauncher = events().filter((e) => e.type === "carried").map(({ ts, room, ...rest }) => rest);
assert.deepEqual(fromLauncher, [
  { type: "carried", from: "launcher", seats: ["lead", "w-1"], ids: ["arXiv:2401.00001", "doi:10.1145/2363.2433"], axes: 1, chars: SETTLED.length },
  { type: "carried", from: "launcher", seats: ["arm-b"], ids: [], axes: 0, chars: 0, no_carry: true },
], "the launcher's list, as ids; a NO_CARRY arm is recorded as told nothing");
assert.equal(events().filter((e) => e.type === "message" && /carried|SOURCES ALREADY READ/.test(String(e.msg?.content))).length, 0, "no line in the room: telemetry only");

const rec = await call("request_agent", { room: ROOM, brief: "Read one paper and report what it shows, then leave.", name: "reader", agent: "claude" });
assert.notEqual(rec.isError, true, rec.content[0]?.text);
const fromSpawner = events().filter((e) => e.type === "carried" && e.from === "spawner");
assert.equal(fromSpawner.length, 1, "one carried event per recruit spawn");
assert.deepEqual(fromSpawner[0].seats, ["reader"]);
assert.ok(Array.isArray(fromSpawner[0].ids) && fromSpawner[0].ids.length > 0 && fromSpawner[0].axes > 0, `the recruit was told this repo's decision log: ${JSON.stringify(fromSpawner[0]).slice(0, 200)}`);

// the run-end route moved into the same module (src/telemetry/launch-reports.ts) and behaves as before
assert.equal((await post(`/rooms/${ROOM}/run-end`, { cause: "timeout" })).status, 200);
assert.equal((await post(`/rooms/no-such-room/run-end`, { cause: "timeout" })).status, 400);
assert.deepEqual(events().filter((e) => e.type === "run_end").map((e) => e.cause), ["timeout"]);

server.kill();
console.log("re-research-regression: ok");
process.exit(0);
