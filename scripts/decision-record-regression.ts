/** Two self-improvement rounds in a row lost their DECISION RECORD (board evidence/decision-record-loss, swarm-005940-77tu):
 * - RSI-4 (swarm-073112-zcd7): the record was in the verifier's turn at 09:44:31Z; a background watcher woke it at 09:51:49Z
 *   and that 309-char turn became the CLI's json `result`, the only text src/swarm.ts read. The record survives only in the
 *   session transcript (fixtures/decision-record/rsi4-*).
 * - RSI-3 (swarm-092526-89rn): the final text held a record of 11 Targets written "**Target 1: <slug>.**" with no `Slug:`
 *   line, so the one-slug regex matched nothing and none was filed (fixtures/decision-record/rsi3-*).
 * The launcher now looks for the newest record in the final text, the session transcripts and the verifier's room
 * messages, files one proposed decision per Target, and keeps the whole record next to the report.
 *   npx tsx scripts/decision-record-regression.ts */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fx = (f: string) => join(root, "scripts", "fixtures", "decision-record", f);
const mod = await import("../src/launch/decision-record.js").catch((e) => assert.fail(`src/launch/decision-record.ts does not load: ${e}`));
const { findDecisionRecord, sessionCandidates, roomMessageCandidates, parseDecisionRecord, fileDecisionRecord, verifierCandidates } = mod;

// ---- RSI-4: the last turn is a background-wake note; the record is one turn earlier, in the session transcript ----
const rsi4Final = readFileSync(fx("rsi4-verifier-final.txt"), "utf8");
assert.ok(!rsi4Final.includes("DECISION RECORD"), "fixture: RSI-4's CLI result has no record (the bug)");
const rsi4 = findDecisionRecord([{ source: "final_text", text: rsi4Final }, ...sessionCandidates(readFileSync(fx("rsi4-verifier-session.jsonl"), "utf8"))]);
assert.ok(rsi4.found, `RSI-4's record is found (missing: ${rsi4.missing})`);
assert.equal(rsi4.found!.source, "session_transcript");
assert.equal(rsi4.found!.at, "2026-10-23T09:44:31.578Z", "the turn that carried it, not the later note");
assert.deepEqual(rsi4.found!.targets.map((t) => t.slug), ["lc0a-postmortem-escalation-build"], "the slug the room's verifier wrote (hand-filed in docs/decisions/proposed)");
assert.ok(rsi4.found!.turn.startsWith("VERIFIED:"), "the verdict that preceded the record is kept with it");
// the user prompt quotes "DECISION RECORD ... slug" too: only the verifier's own words count
assert.ok(sessionCandidates(readFileSync(fx("rsi4-verifier-session.jsonl"), "utf8")).every((c) => !c.text.startsWith("SETTLED AXES")), "prompt text is never a candidate");

// ---- RSI-3: eleven "**Target N: slug.**" headings, no Slug: line ----
const rsi3 = findDecisionRecord([{ source: "final_text", text: readFileSync(fx("rsi3-verifier-final.txt"), "utf8") }]);
assert.ok(rsi3.found, `RSI-3's record is found (missing: ${rsi3.missing})`);
assert.equal(rsi3.found!.source, "final_text");
const slugs3 = rsi3.found!.targets.map((t) => t.slug);
assert.equal(slugs3.length, 11, `every Target is filed, not the first: ${slugs3.join(", ")}`);
assert.equal(slugs3[0], "claude-seats-compact-at-300k");
assert.equal(slugs3[9], "take-matcher", "a heading with a parenthesis after the slug");
assert.equal(slugs3[10], "lessons-from-89rn");
assert.ok(rsi3.found!.targets[1].text.startsWith("**Target 2: room-topic-carried-once.**"), "each file holds its own Target");
assert.ok(!rsi3.found!.targets[0].text.includes("Target 2:"), "and not the next one");
assert.ok(rsi3.found!.targets.every((t) => t.slugFrom === "target_heading"));

// ---- this room's format: a Target heading and a Slug: line each ----
const room = parseDecisionRecord(`VERIFIED.\n\nDECISION RECORD\n\nTarget 1: keep working seats\n- Slug: \`reap-only-dead-seats\`\n- Context: x\n\nTarget 2: decision records survive\n- **Slug:** decision-record-survives-late-turns\n- Ruling: y\n`);
assert.deepEqual(room?.targets.map((t) => [t.slug, t.slugFrom]), [["reap-only-dead-seats", "slug_line"], ["decision-record-survives-late-turns", "slug_line"]], "a Slug: line wins over the heading");
// several Slug: lines and no Target heading: one target per Slug paragraph, its title line kept with it
const noHead = parseDecisionRecord(`DECISION RECORD\n**1. Reaping**\nSlug: reap-a\nContext: a\n\n**2. Breakouts**\nSlug: breakout-b\nContext: b\n`);
assert.deepEqual(noHead?.targets.map((t) => t.slug), ["reap-a", "breakout-b"]);
assert.ok(noHead!.targets[1].text.startsWith("**2. Breakouts**"), "the title above a Slug line belongs to its target");
assert.ok(!noHead!.targets[0].text.includes("Breakouts"));
// one record, one slug: as before
assert.deepEqual(parseDecisionRecord("DECISION RECORD\n**Slug**: `one-thing`\nContext: z")?.targets.map((t) => t.slug), ["one-thing"]);
// duplicate slugs are both filed
assert.deepEqual(parseDecisionRecord("DECISION RECORD\nTarget 1: a\nSlug: same-slug\n\nTarget 2: b\nSlug: same-slug\n")?.targets.map((t) => t.slug), ["same-slug", "same-slug-2"]);
// the guard-decisions field under the slug is not a heading (swarm-223603-6iom, -084346-o4cg, -163100-mugk, -174126-0s5m
// wrote it so; a first cut of this parser filed none of them)
assert.deepEqual(parseDecisionRecord("DECISION RECORD\n- **slug:** roster-seats-scoped-by-launcher\n- **target:** src/roster.ts, src/swarm.ts\n- **context:** c\n")?.targets.map((t) => t.slug), ["roster-seats-scoped-by-launcher"]);
assert.deepEqual(parseDecisionRecord("DECISION RECORD (ready for `guard-decisions add`)\n\n**slug**: `provenance-before-mechanism`\n**target**: A benchmark run records\n")?.targets.map((t) => t.slug), ["provenance-before-mechanism"]);
// "RE-TARGET <axis>" is not a Target heading, and prose "Target users" is not one either
assert.deepEqual(parseDecisionRecord("DECISION RECORD\nSlug: only-one\nTarget users are seats.\n**RE-TARGET** settle-disputes-by-spec-not-count: evidence\n")?.targets.map((t) => t.slug), ["only-one"]);

// ---- room messages: the verifier's, newest qualifying; another seat quoting a record does not count ----
const transcript = [
  "# swarm-x-room", "Topic: t", "",
  "#10 [2026-10-26T05:00:00.000Z] verifier (chat): DECISION RECORD\nTarget 1: old\nSlug: older-record\n",
  "#11 [2026-10-26T05:10:00.000Z] claude-opus-5-5-1 (chat): the DECISION RECORD should say\nSlug: not-the-verifier\n",
  "#12 [2026-10-26T05:20:00.000Z] verifier (chat): VERIFIED\n\nDECISION RECORD\nTarget 1: new\nSlug: newer-record\n\nTarget 2: second\nSlug: second-record\n",
  "#13 [2026-10-26T05:21:00.000Z] verifier (vote): verifier votes AGREE on prop_1",
  "#14 [2026-10-26T05:22:00.000Z] verifier-r1 (chat): leaving, the DECISION RECORD above stands",
].join("\n");
const roomCands = roomMessageCandidates(transcript, (n: string) => n === "verifier" || n.startsWith("verifier-r"));
assert.equal(roomCands.length, 3, "the verifier's chat messages only (not votes, not other seats)");
const viaRoom = findDecisionRecord([{ source: "final_text", text: "All done; nothing running." }, ...roomCands]);
assert.equal(viaRoom.found?.source, "room_message");
assert.deepEqual(viaRoom.found?.targets.map((t) => t.slug), ["newer-record", "second-record"], "newest message that names a slug; a later mention without one does not hide it");

// ---- nothing anywhere: the miss is said, with what was searched ----
const none = findDecisionRecord([{ source: "final_text", text: "bye" }, ...roomCands.slice(0, 0)]);
assert.equal(none.found, null);
assert.match(none.missing ?? "", /no DECISION RECORD/);
// a record with no slug at all is a different miss, and its text is still kept
const unnamed = findDecisionRecord([{ source: "final_text", text: "DECISION RECORD\nContext: something with no slug" }]);
assert.equal(unnamed.found, null);
assert.ok(unnamed.unnamed?.record.startsWith("DECISION RECORD"));
assert.match(unnamed.missing ?? "", /no slug/);

// ---- filing: one file per Target in the decision dir, the whole record next to the report, a summary for result.json ----
const out = mkdtempSync(join(tmpdir(), "decision-record-out-"));
const dir = mkdtempSync(join(tmpdir(), "decision-record-dir-"));
const summary = fileDecisionRecord(rsi3, { runId: "swarm-092526-89rn", state: "concluded", outDir: out, dir });
assert.equal(summary.source, "final_text");
assert.equal(summary.slugs.length, 11);
assert.equal(readdirSync(dir).length, 11, "eleven proposed decisions, not one");
const f2 = readFileSync(join(dir, "room-topic-carried-once.md"), "utf8");
assert.match(f2, /^# Proposed decision: room-topic-carried-once\n/);
assert.match(f2, /target 2 of 11/);
assert.ok(f2.includes("**Target 2: room-topic-carried-once.**"));
assert.ok(existsSync(join(out, "decision-record.md")), "the whole record is kept next to the report");
assert.equal(summary.wholeRecord, join(out, "decision-record.md"));
// a miss still writes what there was, and says why
const s2 = fileDecisionRecord(unnamed, { runId: "r", state: "concluded", outDir: out, dir });
assert.deepEqual(s2.slugs, []);
assert.match(s2.missing ?? "", /no slug/);
assert.ok(readFileSync(join(out, "decision-record.md"), "utf8").includes("Context: something with no slug"));
// no decision log in the project: nothing is proposed, the record is still kept and the summary says where
const s3 = fileDecisionRecord(rsi4, { runId: "r4", state: "concluded", outDir: out, dir: null });
assert.deepEqual(s3.files, []);
assert.deepEqual(s3.slugs, ["lc0a-postmortem-escalation-build"]);
assert.ok(s3.verdict?.startsWith("VERIFIED:"), "the record's own turn is carried when the CLI result was a later turn");

// ---- verifierCandidates reads the launcher's own sources: final text, session transcripts, the lead room's transcript ----
const cands = verifierCandidates({ finalText: rsi4Final, transcripts: [fx("rsi4-verifier-session.jsonl"), join(out, "no-such.jsonl")], roomTranscript: transcript });
assert.equal(findDecisionRecord(cands).found?.source, "room_message", "the room message at 05:20 is newer than the 09:44 turn of 23 Oct");

// ---- the launcher files through this module, not the old one-slug regex ----
const swarm = readFileSync(join(root, "src", "swarm.ts"), "utf8");
assert.ok(!swarm.includes("/slug\\**:\\**\\s*`?([a-z0-9-]{3,80})/i"), "src/swarm.ts no longer files one slug from the last turn");
assert.match(swarm, /fileDecisionRecord\(/, "src/swarm.ts files through src/launch/decision-record.ts");

// ---- the verifier is told the shape the launcher files, and what replaced RSI-4's final turn ----
const brief = readFileSync(join(root, "prompts", "verifier.md"), "utf8");
assert.match(brief, /its own line `Slug: <kebab-case-slug>`/, "verifier.md asks for one Slug: line per Target");
assert.match(brief, /stop every background command and Monitor/, "verifier.md says a background job must not outlive the final message");

// ---- the re-extract command: a finished run's result.json, as the chair would run it ----
const run = mkdtempSync(join(tmpdir(), "decision-record-run-"));
writeFileSync(join(run, "result.json"), JSON.stringify({ schemaVersion: 1, run: { id: "swarm-073112-zcd7" }, leadRoom: "swarm-073112-zcd7-room",
  rooms: [{ name: "swarm-073112-zcd7-room", payload: { state: "concluded" }, transcript: { text: "# swarm-073112-zcd7-room\n" } }],
  verifier: { name: "verifier", output: rsi4Final }, scorecard: [{ name: "verifier", transcript: fx("rsi4-verifier-session.jsonl") }, { name: "claude-opus-5-5-1" }] }));
const cli = spawnSync(process.execPath, ["--import", "tsx", join(root, "scripts", "decision-record.ts"), join(run, "result.json"), "--json"], { cwd: root, encoding: "utf8" });
assert.equal(cli.status, 0, cli.stderr);
const parsed = JSON.parse(cli.stdout);
assert.deepEqual(parsed.slugs, ["lc0a-postmortem-escalation-build"]);
assert.equal(parsed.source, "session_transcript");
assert.deepEqual(parsed.files, [], "a dry run writes nothing");
const wrote = mkdtempSync(join(tmpdir(), "decision-record-write-"));
const cli2 = spawnSync(process.execPath, ["--import", "tsx", join(root, "scripts", "decision-record.ts"), join(run, "result.json"), "--write", wrote], { cwd: root, encoding: "utf8" });
assert.equal(cli2.status, 0, cli2.stderr);
assert.ok(existsSync(join(wrote, "lc0a-postmortem-escalation-build.md")), cli2.stdout);
console.log("DECISION RECORD REGRESSION OK");
