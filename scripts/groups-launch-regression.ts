/** Hand-written groups: PORT=<free port> npx tsx --test scripts/groups-launch-regression.ts (needs npm run build)
 * The planned mode asks a planner model for the groups, so an operator could not launch groups with briefs they wrote
 * themselves (two groups with opposing briefs, each talking only in its own room). --groups <file.json> takes them as
 * given. The launcher is run for real with stub claude binaries on PATH, and each seat's prompt is read from what the
 * stub received on stdin. No model is called. */
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeFakeBins } from "./seat-launch-fixture.ts";

const PORT = process.env.PORT;
if (!PORT) throw new Error("set PORT to a free port in your range");

const TASK = "Decide whether the widget rebate pays a small account.";
const GROUPS = {
  done_when: "Both groups have concluded and the consolidation room holds one answer.",
  verifier_directive: "Rerun the build group's best result from its files.",
  groups: [
    { id: "build", title: "Build the rebate case", workers: 2, brief: "BUILD-BRIEF-MARKER: make the strongest runnable case that the rebate pays." },
    { id: "break", title: "Break the rebate case", workers: 2, brief: "BREAK-BRIEF-MARKER: find why the rebate does not pay." },
  ],
};

const base = realpathSync(mkdtempSync(join(tmpdir(), "groups-launch-")));
/** The launcher leaves the hub it started running (detached); stop only that hub: this checkout's dist/index.js on PORT. */
function stopOurHub() {
  for (const pid of spawnSync("lsof", ["-ti", `:${PORT}`, "-sTCP:LISTEN"], { encoding: "utf8" }).stdout.split("\n").filter(Boolean)) {
    const args = spawnSync("ps", ["-o", "args=", "-p", pid], { encoding: "utf8" }).stdout;
    if (args.includes(join(process.cwd(), "dist", "index.js"))) process.kill(Number(pid));
  }
}
after(() => { stopOurHub(); rmSync(base, { recursive: true, force: true }); });

interface Launch { status: number | null; stderr: string; stdout: string; prompts: string[]; result: string }
function launch(tag: string, groups: unknown, extra: string[] = []): Launch {
  const [bin, records, data] = ["bin", "records", "data"].map((d) => join(base, tag, d));
  for (const d of [bin, records, data]) mkdirSync(d, { recursive: true });
  writeFakeBins(bin);
  const file = join(base, tag, "groups.json");
  writeFileSync(file, typeof groups === "string" ? groups : JSON.stringify(groups));
  const result = join(base, tag, "result.json");
  const r = spawnSync(process.execPath, ["dist/swarm.js", TASK, "--groups", file, ...extra, "--no-carry", "--timeout", "1", "--port", PORT!, "--result-path", result], {
    encoding: "utf8",
    timeout: 90_000,
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, FAKE_RECORD_DIR: records, CHATROOM_INSECURE_LOCAL: "1", CHATROOM_NO_RECRUIT: "1", CHATROOM_DATA_DIR: data },
  });
  stopOurHub();
  const prompts = readdirSync(records).map((f) => (JSON.parse(readFileSync(join(records, f), "utf8")) as { stdin: string }).stdin);
  return { status: r.status, stderr: String(r.stderr), stdout: String(r.stdout), prompts, result };
}

test("--groups launches the groups as written: no planner, one room and one brief per group", () => {
  const r = launch("two", GROUPS);
  const tail = `launcher exit ${r.status}; stderr tail: ${r.stderr.slice(-600)}`;
  assert.ok(!r.prompts.some((p) => p.includes("Return ONLY a JSON object") || /You are (the )?planner/i.test(p)), `no planner seat was run (${tail})`);
  const workers = r.prompts.filter((p) => !p.includes("You are verifier"));
  assert.equal(workers.length, 4, `four group seats recorded (${tail})`);
  const build = workers.filter((p) => p.includes("BUILD-BRIEF-MARKER"));
  const brk = workers.filter((p) => p.includes("BREAK-BRIEF-MARKER"));
  assert.equal(build.length, 2, "two seats carry the build brief");
  assert.equal(brk.length, 2, "two seats carry the break brief");
  for (const p of build) assert.ok(!p.includes("BREAK-BRIEF-MARKER"), "a build seat is not shown the break group's brief");
  for (const p of brk) assert.ok(!p.includes("BUILD-BRIEF-MARKER"), "a break seat is not shown the build group's brief");
  const room = (p: string) => /join_room` \(room="([^"]+)"/.exec(p)?.[1] ?? "";
  assert.equal(new Set(build.map(room)).size, 1, "the build seats share one room");
  assert.match(room(build[0]), /-build$/, "named after the group id");
  assert.match(room(brk[0]), /-break$/);
  assert.notEqual(room(build[0]), room(brk[0]), "the two groups are in different rooms");
  for (const p of workers) {
    assert.ok(p.includes(TASK), "every seat sees the whole task");
    assert.ok(!p.includes("max_messages_per_participant"), "a long-room brief, not the eight-message debate brief");
    assert.match(p, /expected_participants=2\b/, "the room expects its own group, not the whole run");
  }
  const verifier = r.prompts.find((p) => p.includes("You are verifier"))!;
  assert.ok(verifier.includes("Build the rebate case") && verifier.includes("Break the rebate case"), "the verifier is told the groups");
  assert.ok(verifier.includes(GROUPS.verifier_directive), "and given the file's verifier directive");
  assert.match(r.stdout, /groups file: Build the rebate case ×2 \| Break the rebate case ×2/, "the launcher logs the groups it took from the file");
});

test("--groups refuses a file it cannot launch, before any seat starts", () => {
  const cases: [string, unknown, RegExp][] = [
    ["one-seat", { groups: [{ id: "a", title: "A", workers: 1, brief: "x" }, { id: "b", title: "B", workers: 2, brief: "y" }] }, /at least 2 workers/],
    ["dup-id", { groups: [{ id: "a", title: "A", workers: 2, brief: "x" }, { id: "a", title: "B", workers: 2, brief: "y" }] }, /id "a" is used twice/],
    ["no-brief", { groups: [{ id: "a", title: "A", workers: 2 }] }, /needs a brief/],
    ["not-json", "{ groups: oops", /not valid JSON/],
  ];
  for (const [tag, groups, why] of cases) {
    const r = launch(tag, groups);
    assert.equal(r.status, 2, `${tag}: exit 2 (got ${r.status}; ${r.stderr.slice(-300)})`);
    assert.match(r.stderr, why, tag);
    assert.equal(r.prompts.length, 0, `${tag}: no seat was started`);
  }
});

/** A stub claude that stays up for FAKE_SLEEP_MS, so the run lasts long enough for a digest pass to come due. */
const SLOW_CLAUDE = `#!/usr/bin/env node
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const argv = process.argv.slice(2), stdin = fs.readFileSync(0, 'utf8');
fs.writeFileSync(path.join(process.env.FAKE_RECORD_DIR, 'claude-' + crypto.randomUUID() + '.json'), JSON.stringify({ argv, stdin, cwd: process.cwd(), at: Date.now() }));
setTimeout(() => process.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: 'ok', total_cost_usd: 0.25, usage: {} }) + '\\n'), Number(process.env.FAKE_SLEEP_MS || 0));
`;

test("--digest-every starts a fresh consolidator seat on a timer, told every group's room and where to send what it finds", () => {
  const tag = "digest";
  const [bin, records, data] = ["bin", "records", "data"].map((d) => join(base, tag, d));
  for (const d of [bin, records, data]) mkdirSync(d, { recursive: true });
  writeFileSync(join(bin, "claude"), SLOW_CLAUDE, { mode: 0o755 });
  const file = join(base, tag, "groups.json");
  writeFileSync(file, JSON.stringify(GROUPS));
  const result = join(base, tag, "result.json");
  // 0.03 min = 1.8 s between passes; the group seats stay up 5 s, a consolidator 0.5 s
  const r = spawnSync(process.execPath, ["dist/swarm.js", TASK, "--groups", file, "--digest-every", "0.03", "--no-carry", "--timeout", "1", "--port", PORT!, "--result-path", result], {
    encoding: "utf8",
    timeout: 90_000,
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, FAKE_RECORD_DIR: records, FAKE_SLEEP_MS: "5000", CHATROOM_INSECURE_LOCAL: "1", CHATROOM_NO_RECRUIT: "1", CHATROOM_DATA_DIR: data },
  });
  stopOurHub();
  const tail = `launcher exit ${r.status}; stderr tail: ${String(r.stderr).slice(-600)}`;
  const prompts = readdirSync(records).map((f) => (JSON.parse(readFileSync(join(records, f), "utf8")) as { stdin: string }).stdin);
  const digests = prompts.filter((p) => /You are digest-\d+/.test(p));
  assert.ok(digests.length >= 1, `at least one consolidator seat was started (${tail})`);
  const first = digests.find((p) => p.includes("You are digest-1,"))!;
  assert.ok(first, "passes are numbered from 1");
  const swarm = /`(swarm-\d{6}-[a-z0-9]{4})-leads`/.exec(first)?.[1];
  assert.ok(swarm, "it is told the consolidation room");
  for (const id of ["build", "break"]) {
    assert.ok(first.includes(`${swarm}-${id}`), `it is told the ${id} group's room`);
    assert.ok(first.includes(`http://127.0.0.1:${PORT}/rooms/${swarm}-${id}`), `and where to read the ${id} room without joining it`);
  }
  assert.ok(first.includes("BUILD-BRIEF-MARKER") && first.includes("BREAK-BRIEF-MARKER"), "it sees every group's brief");
  assert.ok(first.includes('key="digest-1"') && first.includes("ack_required=true"), "it sends each group a note the group must acknowledge");
  assert.ok(first.includes("digest/1"), "and leaves the pass on the consolidation room's board for the next one");
  assert.match(String(r.stdout), /digest pass 1: started digest-1/, "the launcher logs each pass");
  // a pass that is still running is not doubled: passes are numbered without gaps and none repeats
  const numbers = digests.map((p) => Number(/You are digest-(\d+)/.exec(p)![1])).sort((a, b) => a - b);
  assert.deepEqual(numbers, numbers.map((_, i) => i + 1), `passes 1..n, each once: ${JSON.stringify(numbers)}`);
  const usage = (JSON.parse(readFileSync(result, "utf8")) as { usage?: { seats?: number; cost_usd?: number } }).usage;
  assert.equal(usage?.seats, 5 + digests.length, "each consolidator's usage is counted in the run's result, beside the five seats'");
  assert.equal(usage?.cost_usd, 0.25 * (5 + digests.length));
});

test("--digest-every without --groups is refused", () => {
  const bin = join(base, "nogroups-bin"), records = join(base, "nogroups-rec");
  for (const d of [bin, records]) mkdirSync(d, { recursive: true });
  writeFakeBins(bin);
  const r = spawnSync(process.execPath, ["dist/swarm.js", TASK, "--flat", "--digest-every", "30", "--no-carry", "--timeout", "1", "--port", PORT!], {
    encoding: "utf8", timeout: 60_000,
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, FAKE_RECORD_DIR: records, CHATROOM_INSECURE_LOCAL: "1", CHATROOM_NO_RECRUIT: "1", CHATROOM_DATA_DIR: join(base, "nogroups-data") },
  });
  stopOurHub();
  assert.equal(r.status, 2);
  assert.match(String(r.stderr), /--digest-every needs --groups/);
  assert.equal(readdirSync(records).length, 0, "no seat was started");
});
