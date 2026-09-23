/** A seat's prompt never appears in its argv: node --import tsx scripts/seat-prompt-argv.test.ts (needs npm run build)
 * In pool run room15-rep2 (2026-09-23) one seat's `pkill -f "offline-runner"` matched the brief that the launcher had put
 * in every seat's argv and killed 14 of 15 seats. argv is visible host-wide; the prompt now goes to claude, codex and
 * OpenRouter seats on stdin, from both launchers (src/swarm.ts and src/spawner.ts). */
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { claudeArgs } from "../src/claude-args.ts";
import { codexArgs } from "../src/codex-seat.ts";
import { Spawner } from "../src/spawner.ts";
import { runClaudeSeat } from "./bench-build-runtime.ts";
import { CODEX_TWO_TURN_JSONL, CODEX_TWO_TURN_SIDECAR, startHub, startStub, writeFakeBins } from "./seat-launch-fixture.ts";

const BRIEF = "Implement h14: make scripts/offline-runner.mjs time out each command.";

test("claudeArgs puts no prompt in argv: -p is followed by a flag", () => {
  const args = claudeArgs({ mcpJson: "/m.json", tools: ["Bash"], model: "claude-opus-5-5", outputFormat: "stream-json" });
  const i = args.indexOf("-p");
  assert.ok(i >= 0, "print mode");
  assert.ok(args[i + 1]?.startsWith("--"), `argument after -p is a flag, not a prompt: ${args[i + 1]}`);
});

test("runClaudeSeat hands the brief to claude on stdin and keeps it out of argv", async () => {
  const dir = mkdtempSync(join(tmpdir(), "seat-prompt-"));
  const record = join(dir, "record.json");
  const fake = join(dir, "claude");
  writeFileSync(fake, `#!/usr/bin/env node
const fs = require('node:fs');
const stdin = fs.readFileSync(0, 'utf8');
fs.writeFileSync(${JSON.stringify(record)}, JSON.stringify({ argv: process.argv.slice(2), stdin }));
process.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: 'ok', total_cost_usd: 0, usage: {} }) + '\\n');
`);
  chmodSync(fake, 0o755);
  const args = claudeArgs({ mcpJson: "/m.json", tools: ["Bash"], outputFormat: "stream-json" });
  await runClaudeSeat("seat-1", args, dir, 20_000, { env: { ...process.env, PATH: `${dir}:${process.env.PATH}` }, stdin: BRIEF });
  const seen = JSON.parse(readFileSync(record, "utf8")) as { argv: string[]; stdin: string };
  assert.equal(seen.stdin, BRIEF);
  assert.ok(!seen.argv.some((a) => a.includes("offline-runner")), "a pkill -f pattern from the brief cannot match the seat's argv");
});

// ---- codex and OpenRouter seats (docs/reuse-survey-2026-09-23.md, "Codex seats" and "Seat launch"): same rule, both launchers ----
// Real processes: stub codex and claude on PATH record what they were given; the OpenRouter seat is the real
// dist/openrouter.js talking to a local stub model, and argv is read with ps while that seat waits on the stub.

test("codexArgs: the prompt is read from stdin (-); read-only seats get -s read-only, write seats keep their configured sandbox", () => {
  const ro = codexArgs({ cwd: "/w", mcpUrl: "http://127.0.0.1:1/mcp", model: "gpt-6-astra", readOnly: true, outFile: "/o/seat.out", json: true });
  assert.equal(ro.at(-1), "-", "codex exec reads instructions from stdin when the prompt argument is -");
  assert.deepEqual(ro.slice(ro.indexOf("-s"), ro.indexOf("-s") + 2), ["-s", "read-only"]);
  assert.ok(ro.includes("--json"));
  assert.equal(ro[ro.indexOf("-o") + 1], "/o/seat.out", "-o still writes the final message alongside --json");
  const rw = codexArgs({ cwd: "/w", mcpUrl: "http://127.0.0.1:1/mcp", readOnly: false });
  assert.ok(!rw.includes("-s") && !rw.includes("--sandbox"), "a write seat's sandbox is left to the user's codex config");
  assert.equal(rw.at(-1), "-");
});

const MARKER = `argv-marker-${randomBytes(4).toString("hex")}`;
const SEAT_BRIEF = `Investigate why ${MARKER} fails and report the cause in the room.`;
const base = realpathSync(mkdtempSync(join(tmpdir(), "seat-argv-")));
const [bin, records, work, logs] = ["bin", "records", "work", "logs"].map((d) => join(base, d));
for (const d of [bin, records, work, logs]) mkdirSync(d);
writeFakeBins(bin);
interface Row { pid: number; ppid: number; args: string }
let processes: Row[] = [];
// taken while an OpenRouter seat is inside its model call, so the seat is certainly alive
const stub = await startStub(() => {
  processes = spawnSync("ps", ["-axww", "-o", "pid=,ppid=,args="], { encoding: "utf8" }).stdout.split("\n").map((l) => /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(l)).filter((m) => m !== null).map((m) => ({ pid: Number(m![1]), ppid: Number(m![2]), args: m![3] }));
});
const { hub, url: hubUrl, port: hubPort } = await startHub(logs, base);
after(async () => { hub.kill(); await stub.close(); rmSync(base, { recursive: true, force: true }); });
const seatEnv = { PATH: `${bin}:${process.env.PATH}`, FAKE_RECORD_DIR: records, OPENROUTER_API_KEY: "stub-key", OPENROUTER_BASE_URL: stub.url };
const takeRecords = (kind: "codex" | "claude") => readdirSync(records).filter((f) => f.startsWith(kind)).map((f) => { const r = JSON.parse(readFileSync(join(records, f), "utf8")); rmSync(join(records, f)); return r as { argv: string[]; stdin: string; cwd: string }; });
const waitFor = async (ok: () => unknown, what: string, ms = 30_000) => { for (const until = Date.now() + ms; !ok(); ) { if (Date.now() > until) throw new Error(`timed out waiting for ${what}`); await new Promise((r) => setTimeout(r, 50)); } };

test("spawner: codex recruits read the brief from stdin; read-only recruits run -s read-only, write recruits do not", async () => {
  Object.assign(process.env, seatEnv);
  const spawner = new Spawner({ mcpUrl: `${hubUrl}/mcp`, defaultCwd: work, logDir: logs });
  spawner.policy = {};
  for (const canEdit of [false, true]) {
    const [rec] = spawner.request({ room: "argv-room", requestedBy: "tester", brief: SEAT_BRIEF, agent: "codex", model: "gpt-6-astra", name: `codex-${canEdit ? "rw" : "ro"}`, canEdit });
    await waitFor(() => rec.endedAt, "the codex recruit to exit");
    const [seen] = takeRecords("codex");
    assert.ok(!seen.argv.some((a) => a.includes(MARKER)), "the brief is not in the codex recruit's argv");
    assert.ok(seen.stdin.includes(MARKER), "the codex recruit got its brief on stdin");
    assert.equal(seen.argv.at(-1), "-");
    assert.equal(seen.argv.includes("read-only"), !canEdit, canEdit ? "a write recruit keeps its sandbox" : "a read-only recruit runs -s read-only");
  }
});

test("spawner: an OpenRouter recruit reads the brief from stdin and its argv never carries it", async () => {
  Object.assign(process.env, seatEnv);
  const spawner = new Spawner({ mcpUrl: `${hubUrl}/mcp`, defaultCwd: work, logDir: logs });
  spawner.policy = {};
  processes = []; stub.bodies.length = 0;
  const [rec] = spawner.request({ room: "argv-room", requestedBy: "tester", brief: SEAT_BRIEF, agent: "openrouter", model: "stub/model", name: "or-recruit" });
  await waitFor(() => rec.endedAt, "the OpenRouter recruit to exit");
  assert.equal(rec.exitCode, 0, readFileSync(rec.log, "utf8").slice(-800));
  const seat = processes.find((p) => p.pid === rec.pid);
  assert.ok(seat && seat.args.includes("openrouter.js"), "the recruit was alive in the process table while it called the model");
  assert.ok(!seat.args.includes(MARKER), `the brief is not in the recruit's argv: ${seat.args.slice(0, 300)}`);
  assert.ok(stub.bodies.some((b) => b.messages.some((m) => (m.content ?? "").includes(MARKER))), "the brief reached the model, so stdin delivered it");
});

test("swarm.ts: codex and OpenRouter seats get the prompt on stdin, never argv; codex runs -s read-only and its usage lands in <name>.usage.json", async () => {
  processes = []; stub.bodies.length = 0;
  const swarm = spawn(process.execPath, [resolve("dist", "swarm.js"), SEAT_BRIEF, "--flat", "--agents", "3", "--codex", "1", "--openrouter", "1", "--codex-models", "gpt-6-astra",
    "--openrouter-models", "stub/model", "--models", "claude-opus-5-5", "--verifier-model", "claude-opus-5-5", "--port", String(hubPort), "--timeout", "1", "--cwd", work],
    { env: { ...process.env, ...seatEnv }, stdio: ["ignore", "pipe", "pipe"] });
  let out = "";
  swarm.stdout.on("data", (d) => (out += d));
  swarm.stderr.on("data", (d) => (out += d));
  await new Promise((ok) => swarm.on("close", ok));
  const id = /swarm (swarm-[0-9]+-[a-z0-9]+):/.exec(out)?.[1];
  assert.ok(id, out.slice(-1500));
  const dir = resolve("swarms", id);
  try {
    const [codex] = takeRecords("codex");
    assert.ok(codex, "the codex seat ran");
    assert.ok(!codex.argv.some((a) => a.includes(MARKER)), "the brief is not in the codex seat's argv");
    assert.ok(codex.stdin.includes(MARKER), "the codex seat got its prompt on stdin");
    assert.equal(codex.argv.at(-1), "-");
    assert.ok(codex.argv.includes("--json") && codex.argv.includes("-o"), "--json for usage, -o for the final text");
    assert.ok(codex.argv.includes("read-only"), "a seat without --full-access is read-only: -s read-only");
    // the launcher's own argv still carries the task (it is how swarm.js takes it); every seat it launched must not
    const seats = processes.filter((p) => p.ppid === swarm.pid);
    assert.ok(seats.some((p) => p.args.includes("openrouter.js")), "the OpenRouter seat was alive while it called the model");
    for (const p of seats) assert.ok(!p.args.includes(MARKER), `a seat's argv carries the brief: ${p.args.slice(0, 300)}`);
    assert.ok(stub.bodies.some((b) => b.messages.some((m) => (m.content ?? "").includes(MARKER))), "the OpenRouter seat's prompt reached the model");
    // codex usage: the recorded two-turn stream's last turn.completed, in the sidecar the launcher reads
    const sidecars = readdirSync(dir).filter((f) => f.endsWith(".usage.json")).map((f) => ({ f, u: JSON.parse(readFileSync(join(dir, f), "utf8")) }));
    const codexSidecar = sidecars.find((s) => s.u.codex_usage);
    assert.ok(codexSidecar, `no codex usage sidecar among ${sidecars.map((s) => s.f).join(", ")}`);
    assert.deepEqual(codexSidecar.u, CODEX_TWO_TURN_SIDECAR);
    const seatName = codexSidecar.f.replace(/\.usage\.json$/, "");
    assert.equal(readFileSync(join(dir, `${seatName}.out`), "utf8").trim(), "codex final text", "-o still gives the seat's final text");
    assert.equal(readFileSync(join(dir, `${seatName}.events.jsonl`), "utf8"), CODEX_TWO_TURN_JSONL, "the event stream is kept");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("openrouter.ts still takes -p for manual runs and the scripts that call it directly", async () => {
  stub.bodies.length = 0;
  const manual = `manual-${MARKER}`;
  const seat = spawn(process.execPath, [resolve("dist", "openrouter.js"), "-p", `Say hello. ${manual}`, "--mcp-url", `${hubUrl}/mcp`, "--model", "stub/model", "--max-minutes", "0.5"],
    { env: { ...process.env, ...seatEnv }, stdio: ["ignore", "ignore", "pipe"] });
  let err = "";
  seat.stderr.on("data", (d) => (err += d));
  assert.equal(await new Promise((ok) => seat.on("close", ok)), 0, err.slice(-800));
  assert.ok(stub.bodies.some((b) => b.messages.some((m) => (m.content ?? "").includes(manual))));
});
