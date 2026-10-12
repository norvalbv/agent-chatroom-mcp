/**
 * Real processes, real ps: a seat's agent exits while a job it detached runs on; the room is told when the job stops.
 * Run: npx tsx scripts/job-outlives-seat-probe.ts   (about 80 s: a process is a job only after JOB_MIN_S)
 * Exit 0 when the room got both lines (the seat-exit line naming the job, and the line when it stopped), 1 otherwise.
 */
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hub } from "../src/hub.js";
import { seatHash } from "../src/hub/liveness.js";

const KEY = `probe-key-${process.pid}-${Date.now()}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const dir = mkdtempSync(join(tmpdir(), "job-outlives-"));
const env = { ...process.env, CHATROOM_SEAT_KEY: KEY };
// the agent is the oldest process carrying the key; the job is detached from it, as `nohup round.sh &` is
const agent = spawn(process.execPath, ["-e", "setTimeout(()=>{}, 600000) // agent"], { env, stdio: "ignore" });
await sleep(1500);
// started the way a seat starts one: from a shell that returns at once, so launchd adopts it (ppid 1)
const started = spawnSync("sh", ["-c", `nohup "${process.execPath}" -e "setTimeout(()=>{}, 600000) // bench-round" > /dev/null 2>&1 & echo $!`], { env, encoding: "utf8" });
const job = { pid: Number(started.stdout.trim()) };
// and its last foreground command, which ends with it and must not be announced
const fg = spawn(process.execPath, ["-e", "setTimeout(()=>{}, 600000) // foreground"], { env, stdio: "ignore" });
let code = 1;
try {
  const hub = new Hub({ dataDir: dir });
  hub.bindSeat(KEY, "sess-a");
  const a = hub.join("jobs", "ann", "claude", { requireChallenge: false, nudgeAfterMs: 0, expectedParticipants: 0 }, undefined, "sess-a").participant;
  hub.join("jobs", "bob", "claude", {}, undefined, "sess-b");
  await sleep(63_000);
  await hub.memory.tick();
  const counted = hub.memory.jobs(seatHash(KEY)).map((j) => j.pid);
  console.log("job counted for the live seat:", counted.includes(job.pid!));
  agent.kill("SIGKILL"); fg.kill("SIGKILL");
  hub.recordSeatExit(KEY, "exit 1: usage limit");
  hub.leave("jobs", a.id, "process exited");
  await sleep(1500);
  await hub.memory.tick();
  await hub.memory.tick();
  const lines = () => hub.getRoom("jobs").messages.map((m) => m.content);
  const exitLine = lines().some((c) => c.includes(`exited with a job still counted as running: pid ${job.pid}`));
  const early = lines().some((c) => c.includes("is no longer running")); // the job is alive, and the foreground command is not news
  console.log("seat-exit line names the job:", exitLine, "| said to have stopped while still alive:", early);
  process.kill(job.pid!, "SIGKILL");
  await sleep(1500);
  await hub.memory.tick();
  const endLine = lines().find((c) => c.includes(`started before leaving is no longer running: pid ${job.pid}`));
  console.log("room told when it stopped:", Boolean(endLine), endLine ? `\n  ${endLine}` : "");
  code = counted.includes(job.pid!) && exitLine && !early && endLine ? 0 : 1;
} finally {
  for (const p of [agent, job, fg]) try { process.kill(p.pid!, "SIGKILL"); } catch {}
  rmSync(dir, { recursive: true, force: true });
}
process.exit(code);
