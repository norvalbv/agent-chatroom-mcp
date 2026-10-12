/**
 * Real processes, real ps, a real spawn: a seat writes wake/<pid> for a job it detached and leaves; when the job stops
 * the hub starts a successor (a stub `claude` on PATH that records the prompt it was given, so no model is called).
 * Run: npx tsx scripts/job-wake-probe.ts   (about 80 s: a process is a job only after JOB_MIN_S)
 * Exit 0 when nothing was started while the job ran and the stub received the brief after it stopped, 1 otherwise.
 */
import { spawn } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { Hub } from "../src/hub.js";
import { seatHash } from "../src/hub/liveness.js";
import { Spawner } from "../src/spawner.js";

const KEY = `probe-key-${process.pid}-${Date.now()}`;
const BRIEF = "Read rounds/a1/status.json, post the recall table to the room, then write handoff/a1.";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const dir = realpathSync(mkdtempSync(join(tmpdir(), "job-wake-")));
const got = join(dir, "prompt.txt");
writeFileSync(join(dir, "claude"), `#!/bin/sh\ncat > "${got}.stdin"\nprintf '%s\\n' "$@" > "${got}"\n`);
chmodSync(join(dir, "claude"), 0o755);
process.env.PATH = `${dir}${delimiter}${process.env.PATH}`;
const env = { ...process.env, CHATROOM_SEAT_KEY: KEY };
const agent = spawn(process.execPath, ["-e", "setTimeout(()=>{}, 600000) // agent"], { env, stdio: "ignore" });
await sleep(1500);
const job = spawn(process.execPath, ["-e", "setTimeout(()=>{}, 600000) // bench-round"], { env, stdio: "ignore", detached: true });
job.unref();
let code = 1;
try {
  const hub = new Hub({ dataDir: join(dir, "data") });
  const spawner = new Spawner({ mcpUrl: "http://127.0.0.1:1/mcp", defaultCwd: dir, logDir: join(dir, "logs") });
  spawner.policy = { ...spawner.policy, agent: "claude", model: undefined };
  spawner.attach({ isHeld: () => false, claimArea: () => {}, ensureRoom: () => {}, announce: (r, t) => { hub.announce(r, t); }, liveAgents: () => 0 });
  const { attachJobWake } = await import("../src/spawner/wake.js");
  attachJobWake(hub, spawner);
  hub.bindSeat(KEY, "sess-a");
  const a = hub.join("jobs", "ann", "claude", { requireChallenge: false, nudgeAfterMs: 0, expectedParticipants: 0 }, undefined, "sess-a").participant;
  hub.join("jobs", "bob", "claude", {}, undefined, "sess-b");
  await sleep(63_000);
  await hub.memory.tick();
  console.log("job counted for the live seat:", hub.memory.jobs(seatHash(KEY)).some((j) => j.pid === job.pid));
  hub.setBoard("jobs", a.id, `wake/${job.pid}`, BRIEF);
  agent.kill("SIGKILL");
  hub.leave("jobs", a.id, "round runs an hour; brief in wake/");
  await sleep(1500);
  await hub.memory.tick();
  await hub.memory.tick();
  const early = spawner.agents.length;
  console.log("successors started while the job still ran:", early);
  process.kill(job.pid!, "SIGKILL");
  await sleep(1500);
  await hub.memory.tick();
  for (let i = 0; i < 100 && !existsSync(got); i++) await sleep(50);
  const prompt = existsSync(got) ? readFileSync(got, "utf8") + readFileSync(`${got}.stdin`, "utf8") : "";
  const line = hub.getRoom("jobs").messages.map((m) => m.content).find((c) => c.includes("was started by the hub to read the result of"));
  console.log("successors started after it stopped:", spawner.agents.length, "| stub claude received the brief:", prompt.includes(BRIEF), "\n ", line ?? "(room not told)");
  code = early === 0 && spawner.agents.length === 1 && prompt.includes(BRIEF) && line ? 0 : 1;
} finally {
  for (const p of [agent, job]) try { process.kill(p.pid!, "SIGKILL"); } catch {}
  await sleep(500);
  rmSync(dir, { recursive: true, force: true });
}
process.exit(code);
