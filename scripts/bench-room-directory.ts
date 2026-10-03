/** Three Claude seats per room, serial runs; --build, --label, --reps, --port, --out select an arm.
 * Both arms disable caching throughout; audit first-request usage from the retained Claude transcripts. */
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const arg = (key: string, fallback: string) => { const i = process.argv.indexOf(`--${key}`); return i < 0 ? fallback : process.argv[i + 1]; };
const build = resolve(arg("build", "."));
const label = arg("label", "head");
const reps = Number(arg("reps", "3"));
const port = Number(arg("port", "18660"));
assert.ok(Number.isInteger(port) && port > 1024 && port < 65536 && port !== 7717);
assert.ok(Number.isInteger(reps) && reps > 0 && reps <= 3);
const out = resolve(arg("out", `/tmp/directory-${label}.json`));
mkdirSync(dirname(out), { recursive: true });
const url = `http://127.0.0.1:${port}`;
const sha = (text: string | Buffer) => createHash("sha256").update(text).digest("hex");
const files = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? files(join(dir, e.name)) : [join(dir, e.name)]).sort();
const head = spawnSync("git", ["-C", build, "rev-parse", "HEAD"], { encoding: "utf8" }).stdout.trim();
const brief = "Determine which OPEN room on this hub owns deployment segment MERIDIAN. Its complete task brief gives an acceptance key. Other rooms may share introductory text or describe other segments. Reach a scrutinised conclusion giving the exact room name and acceptance key, and explain the evidence briefly. Do not change any other room. This is a read-only coordination task; finish once the answer is checked.";
const result: { label: string; build: string; head: string; entry_sha256: string; dist_sha256: string; brief: string; cache_regime: string; runs: Record<string, unknown>[] } = {
  label, build, head,
  entry_sha256: sha(readFileSync(join(build, "dist/index.js"))),
  dist_sha256: sha(files(join(build, "dist")).map((f) => f.slice(build.length) + ":" + sha(readFileSync(f))).join("\n")),
  brief, cache_regime: "DISABLE_PROMPT_CACHING=1, uncached throughout; first-request audit required", runs: [],
};
const flush = () => writeFileSync(out, JSON.stringify(result, null, 2) + "\n");
flush();
for (let rep = 1; rep <= reps; rep++) {
  try { await fetch(url); throw new Error(`Refusing occupied port ${port}`); } catch (error) { if (!(error instanceof TypeError)) throw error; }
  const scratch = mkdtempSync(join(tmpdir(), "room-directory-bench-"));
  const dataDir = join(scratch, "data");
  const cwd = join(scratch, "work");
  mkdirSync(cwd);
  const env = { ...process.env, PORT: String(port), CHATROOM_INSECURE_LOCAL: "1", CHATROOM_RECRUIT_AGENT: "claude", CHATROOM_RECRUIT_MODEL: "claude-opus-5-5", CHATROOM_DATA_DIR: dataDir, CHATROOM_LOG_DIR: join(scratch, "logs"), DISABLE_PROMPT_CACHING: "1" };
  const hub = spawn(process.execPath, [join(build, "dist/index.js")], { cwd: build, env, stdio: ["ignore", "ignore", "inherit"] });
  let launcher: ReturnType<typeof spawn> | undefined;
  try {
    for (let attempt = 0; ; attempt++) {
      try { const r = await fetch(url); if (r.ok) break; } catch { /* wait for owned process */ }
      if (attempt > 100 || hub.exitCode !== null) throw new Error("Private hub failed to start");
      await new Promise((r) => setTimeout(r, 100));
    }
    const target = `catalogue-${String([3, 7, 10][rep - 1]).padStart(2, "0")}`;
    const key = `MERIDIAN-${rep}-ACCEPT-47`;
    const intro = "Release team. This working group owns a deployment segment. " + "Shared engineering context for the rollout. ".repeat(12);
    const fixtures = [];
    for (let i = 0; i < 12; i++) {
      const name = `catalogue-${String(i).padStart(2, "0")}`;
      const opening = name === target || i === ([3, 7, 10][rep - 1] + 1) % 12 ? intro : `Other deployment segment OTHER-${i}. ${"Unrelated task context. ".repeat(20)}`;
      const topic = `${opening}\nDeployment segment: ${name === target ? "MERIDIAN" : `OTHER-${i}`}. Acceptance key: ${name === target ? key : `OTHER-${i}-KEY`}.`;
      const response = await fetch(`${url}/rooms/${name}/create`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ topic, require_challenge: false }) });
      assert.equal(response.status, 201);
      fixtures.push({ name, topic });
    }
    const artifactPath = join(scratch, "result.json");
    const started = Date.now();
    launcher = spawn(process.execPath, [join(build, "dist/swarm.js"), brief, "--flat", "--agents", "3", "--models", "claude-opus-5-5", "--verifier-model", "claude-opus-5-5", "--no-carry", "--no-web", "--cwd", cwd, "--timeout", "4", "--port", String(port), "--result-path", artifactPath], { cwd: build, env, stdio: ["ignore", "pipe", "pipe"] });
    let log = "";
    launcher.stdout!.on("data", (d) => { log += d; });
    launcher.stderr!.on("data", (d) => { log += d; });
    const code = await new Promise<number | null>((resolveExit) => launcher!.once("close", resolveExit));
    writeFileSync(join(scratch, "launcher.log"), log);
    if (!existsSync(artifactPath)) throw new Error(`Launcher exited ${code} without result: ${scratch}`);
    const artifact = JSON.parse(readFileSync(artifactPath, "utf8"));
    const room = artifact.rooms.find((r: { name: string }) => r.name === artifact.leadRoom)?.payload;
    const conclusion = room?.conclusion?.text ?? "";
    const current = await (await fetch(`${url}/rooms`)).json() as { name: string; topic: string; message_count: number }[];
    const clean = fixtures.every((f) => { const r = current.find((r) => r.name === f.name); return r?.topic === f.topic && r.message_count === 0; });
    const row = { rep, target, key, fixture_sha256: sha(JSON.stringify(fixtures)), exit: code, room: artifact.leadRoom, run: artifact.run.id, run_dir: dirname(artifact.reportPath), scratch, conclusion, oracle: conclusion.includes(target) && conclusion.includes(key) && clean, fixtures_unchanged: clean, wall_seconds: (Date.now() - started) / 1000, time_to_conclusion_seconds: room?.conclusion?.decidedAt ? (Date.parse(room.conclusion.decidedAt) - Date.parse(room.created_at)) / 1000 : null, usage: artifact.usage ?? null };
    result.runs.push(row);
    flush();
    console.log(JSON.stringify(row));
  } finally {
    if (launcher && launcher.exitCode === null) launcher.kill("SIGTERM");
    hub.kill("SIGTERM");
    if (hub.exitCode === null) await new Promise((r) => hub.once("close", r));
  }
}
