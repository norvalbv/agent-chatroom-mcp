#!/usr/bin/env node
/**
 * Swarm orchestrator: one command that turns "get N agents to solve X" into
 * plan -> sub-rooms of workers -> leads room -> verifier with veto -> report.
 *
 *   npx tsx src/swarm.ts "<task>" --agents 6 --cwd /path/to/project [--codex 2] [--openrouter 2] [--apply] [--timeout 30]
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { collectRoomSnapshot, renderRunReport, writeRunResult, rollupUsage, parseClaudeCliOutput, type RunResult, type RoomSnapshot, type SeatUsageRollup } from "./result.js";
import { settledAxes } from "./settled.js";
import { registerRespawn } from "./respawn.js";
import { fileURLToPath } from "node:url";
import { loadDotEnv, seatChildEnv } from "./env.js";
import { respawnDecision, type RespawnRoom } from "./respawn.js";
loadDotEnv();

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");

// ---------- args ----------
const argv = process.argv.slice(2);
const flag = (name: string, def?: string) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : def;
};
const has = (name: string) => argv.includes(`--${name}`);
const BOOL_FLAGS = new Set(["--apply", "--full-access", "--named", "--flat", "--require-verification", "--respawn"]);
const task = argv.find((a, i) => !a.startsWith("--") && (i === 0 || !argv[i - 1].startsWith("--") || BOOL_FLAGS.has(argv[i - 1])));
if (!task) {
  console.error('usage: swarm "<task>" [--flat] [--done-when text] [--verify text] [--agents 6] [--cwd dir] [--models sonnet,haiku] [--lead-model opus] [--verifier-model opus] [--planner-model opus] [--codex k] [--codex-models gpt-6-astra,gpt-5.6-sol,gpt-5.6-terra] [--openrouter k] [--openrouter-models deepseek/deepseek-v4.1-flash,...] [--verifier-openrouter slug] [--openrouter-reasoning low|medium|high] [--require-verification] [--quorum unanimous|majority|supermajority] [--prompt loop.md] [--respawn] [--apply] [--full-access] [--named] [--timeout 30] [--port 7717] [--result-path path]');
  process.exit(2);
}
const TOTAL = Math.max(2, Number(flag("agents", "4")));
const WORKERS = TOTAL - 1; // one seat is the verifier
const CWD = resolve(flag("cwd", process.cwd())!);
const CODEX = Math.min(WORKERS, Number(flag("codex", "0")));
const OPENROUTER = Math.min(WORKERS - CODEX, Number(flag("openrouter", "0")));
const APPLY = has("apply");
const ANON = !has("named"); // worker rooms are anonymous unless --named
const LENSES = ["reproduce and measure before theorising", "the simplest fix that could work", "what could go wrong with the obvious fix", "what the tests and history say", "the maintainer who inherits this in a year"];
const FULL = has("full-access");
/** --require-verification: the room is created by the launcher with require_verification, so no proposal passes without a verify/* board entry by someone other than its author naming it (hub-enforced "done") */
const REQUIRE_VERIFICATION = has("require-verification");
/** --quorum unanimous|majority|supermajority: the room's quorum, fixed by the launcher at creation (a forty-seat lobby cannot run on unanimity); supermajority = ceil(0.75 x electorate), the recommended default for flat runs that used to ask for plain majority */
const QUORUM = flag("quorum") as "unanimous" | "majority" | "supermajority" | undefined;
/** --prompt <file in prompts/>: the flat-mode brief template (default minimal.md; loop.md for a self-improvement lobby) */
const FLAT_PROMPT = flag("prompt", "minimal.md")!;
/** --respawn: a seat that exits while its room is still open is relaunched (up to 3 times) with a note to read the board first */
const RESPAWN = has("respawn");
const RUN_STARTED = Date.now();
// Capture target identity before workers can change its revision.
const gitIdentity = () => {
  const git = (...args: string[]) => { const r = spawnSync("git", ["-C", CWD, ...args], { encoding: "utf8" }); if (r.status !== 0) throw new Error(r.stderr); return r.stdout.trim(); };
  try { return { root: realpathSync(git("rev-parse", "--show-toplevel")), commonDir: realpathSync(resolve(CWD, git("rev-parse", "--git-common-dir"))), revision: git("rev-parse", "HEAD"), branch: git("branch", "--show-current"), dirty: git("status", "--porcelain").length > 0 }; } catch { return null; }
};
const PROJECT_IDENTITY = { cwd: CWD, canonicalPath: realpathSync(CWD), git: gitIdentity() };
/** set by the signal handler: a seat that exits because the launcher is stopping is not a drop to respawn */
let STOPPING = false;
/**
 * --flat: no planner, no pre-assigned sub-rooms. Every agent gets the raw task in ONE room on the
 * minimal prompt and organises itself (board claims, request_agent, break-out rooms). The verifier sits
 * in the same room. Use it when the shape of the work is itself unknown (brainstorms, open questions).
 */
const FLAT = has("flat");
// model mix: --models sonnet,sonnet,haiku (rotated over workers), --lead-model, --verifier-model, --planner-model
const MODELS = (flag("models", process.env.CLAUDE_MODEL ?? "") || "").split(",").map((m) => m.trim()).filter(Boolean);
const LEAD_MODEL = flag("lead-model", MODELS[0]);
const VERIFIER_MODEL = flag("verifier-model", LEAD_MODEL);
const PLANNER_MODEL = flag("planner-model", VERIFIER_MODEL);
// Codex seats: --codex k spreads k workers over --codex-models (rotated), default the current OpenAI line-up
const CODEX_MODELS = (flag("codex-models", process.env.CODEX_MODELS ?? process.env.CODEX_MODEL ?? "gpt-6-astra,gpt-5.6-sol,gpt-5.6-terra") || "").split(",").map((m) => m.trim()).filter(Boolean);
// OpenRouter seats: --openrouter k spreads k workers over --openrouter-models (rotated); any OpenRouter slug works
const OPENROUTER_MODELS = (flag("openrouter-models", process.env.OPENROUTER_MODELS ?? process.env.OPENROUTER_MODEL ?? "deepseek/deepseek-v4-flash-0731") || "").split(",").map((m) => m.trim()).filter(Boolean);
/** --verifier-openrouter <slug>: the verifier seat on an OpenRouter model instead of Claude (a run can then cost nothing) */
const VERIFIER_OPENROUTER = flag("verifier-openrouter");
/** --openrouter-reasoning low|medium|high: passed to every OpenRouter seat (models without a reasoning parameter ignore it) */
const OPENROUTER_REASONING = flag("openrouter-reasoning", process.env.OPENROUTER_REASONING);
if ((OPENROUTER > 0 || VERIFIER_OPENROUTER) && !process.env.OPENROUTER_API_KEY) {
  console.error("--openrouter needs OPENROUTER_API_KEY (https://openrouter.ai/keys); a dead seat still counts toward the room's expected participants, so refusing to launch.");
  process.exit(2);
}
// workers may edit files and run anything; each gets its own git worktree
const READ_TOOLS = ["mcp__chatroom__*", "Read", "Grep", "Glob", "Bash", "WebSearch", "WebFetch"];
const WRITE_TOOLS = [...READ_TOOLS, "Edit", "Write", "MultiEdit", "NotebookEdit"];
const TIMEOUT_MIN = Number(flag("timeout", "30"));
const PORT = Number(flag("port", process.env.PORT ?? "7717"));
const URL_ = `http://127.0.0.1:${PORT}`;
const SWARM_ID = `swarm-${new Date().toISOString().slice(11, 19).replace(/:/g, "")}-${Math.random().toString(36).slice(2, 6)}`;
const OUT = resolve(repoRoot, "swarms", SWARM_ID);
mkdirSync(OUT, { recursive: true });

const log = (s: string) => console.log(`\x1b[2m[${new Date().toISOString().slice(11, 19)}]\x1b[0m ${s}`);
const prompt = (file: string, vars: Record<string, string | number>) =>
  Object.entries(vars).reduce((s, [k, v]) => s.split(`{{${k}}}`).join(String(v)), readFileSync(resolve(repoRoot, "prompts", file), "utf8"));

// ---------- settled axes: see src/settled.ts ----------

// ---------- hub ----------
async function ensureHub() {
  try {
    await fetch(URL_);
    return;
  } catch {}
  log(`starting hub on :${PORT}`);
  const child = spawn("node", [resolve(repoRoot, "dist/index.js")], {
    env: { ...process.env, PORT: String(PORT), CHATROOM_DATA_DIR: resolve(repoRoot, "data") },
    detached: true,
    stdio: "ignore",
  });
  child.unref();
  for (let i = 0; i < 50; i++) {
    try {
      await fetch(URL_);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  throw new Error("hub did not start");
}

// ---------- agents ----------
const children: ChildProcess[] = [];
const mcpJson = resolve(OUT, "mcp.json");
writeFileSync(mcpJson, JSON.stringify({ mcpServers: { chatroom: { type: "http", url: `${URL_}/mcp` } } }));

/**
 * R4 usage telemetry for claude seats: `--output-format json` turns stdout into one JSON blob carrying
 * `result` (the seat's final text) alongside `usage`/`total_cost_usd`, in place of the plain text
 * `--output-format text` (the CLI default) would have produced. runProc buffers that blob into outFile
 * exactly as before; parseClaudeCliOutput splits it back into {text, usage} and the text is rewritten
 * over outFile so the .out file holds the seat's final text exactly as today, never the raw JSON.
 */
function runClaude(name: string, text: string, tools: string[], cwd: string, model?: string): Promise<SeatOutcome> {
  const outFile = resolve(OUT, `${name}.out`);
  const args = ["-p", text, "--mcp-config", mcpJson, "--strict-mcp-config", "--allowedTools", tools.join(","), "--output-format", "json"];
  if (model) args.push("--model", model);
  return runProc(name, "claude", args, cwd, outFile).then((raw) => {
    const { text: final, usage } = parseClaudeCliOutput(raw);
    writeFileSync(outFile, final);
    return { text: final, usage };
  });
}

// ---------- R4 usage telemetry ----------
/** Per-seat outcome: the seat's final text (exactly what its .out held) plus its usage, or null when the seat never reported usage (unknown, never zero-filled). */
export interface SeatRun { name: string; text: string; usage: SeatUsageRollup | null; }
export type SeatOutcome = Omit<SeatRun, "name">;
/** Parse the <name>.usage.json sidecar the seat wrote next to its .out; null when absent or invalid. */
const readSeatUsage = (sidecar: string): SeatUsageRollup | null => {
  try {
    const u = JSON.parse(readFileSync(sidecar, "utf8")) as Record<string, unknown>;
    return u && typeof u === "object" && ["steps", "prompt_tokens", "completion_tokens", "cost"].every((k) => typeof u[k] === "number") ? (u as unknown as SeatUsageRollup) : null;
  } catch { return null; }
};
/** `node dist/openrouter.js`, or tsx on the source when the launcher itself is being run from source. */
const seatScript = existsSync(resolve(repoRoot, "dist/openrouter.js")) ? { cmd: process.execPath, pre: [resolve(repoRoot, "dist/openrouter.js")] } : { cmd: "npx", pre: ["tsx", resolve(repoRoot, "src/openrouter.ts")] };

function runOpenRouter(name: string, text: string, cwd: string, model: string | undefined, write: boolean): Promise<SeatOutcome> {
  const outFile = resolve(OUT, `${name}.out`);
  const sidecar = resolve(OUT, `${name}.usage.json`);
  // the seat's own budget matches the launcher's timeout so it leaves the room rather than being killed in it
  const args = [...seatScript.pre, "-p", text, "--mcp-url", `${URL_}/mcp`, "--cwd", cwd, "--max-minutes", String(TIMEOUT_MIN), "--usage-sidecar", sidecar];
  if (model) args.push("--model", model);
  if (write) args.push("--write");
  if (OPENROUTER_REASONING) args.push("--reasoning", OPENROUTER_REASONING);
  return runProc(name, seatScript.cmd, args, cwd, outFile).then((t) => ({ text: t, usage: readSeatUsage(sidecar) }));
}

function runCodex(name: string, text: string, cwd: string, model?: string): Promise<SeatOutcome> {
  const outFile = resolve(OUT, `${name}.out`);
  const args = ["exec", "--skip-git-repo-check", "-C", cwd, "-c", `mcp_servers.chatroom.url="${URL_}/mcp"`, "-c", "mcp_servers.chatroom.tool_timeout_sec=120", "-o", outFile];
  if (model) args.push("-m", model);
  args.push(text);
  return runProc(name, "codex", args, cwd, outFile, true).then((t) => ({ text: t, usage: readSeatUsage(resolve(OUT, `${name}.usage.json`)) }));
}

/**
 * A seat that exits while its room is still open is relaunched under a suffixed name only when the room still needs
 * it: it crashed (non-zero exit), it left a claim/* with no handoff/*, the room fell below its floor, or it is the
 * verifier. A seat that finished, handed over and left is not replaced merely because the room is open; the first
 * respawning launcher did that 70 times in two runs (src/respawn.ts). Up to three times and never in the last five minutes.
 */
async function withRespawn(name: string, room: string, mk: (nm: string, note: string) => Promise<SeatOutcome>): Promise<SeatOutcome> {
  let out: SeatOutcome = await mk(name, "");
  let previousName = name;
  for (let i = 1; RESPAWN && i <= 3; i++) {
    if (STOPPING || Date.now() > RUN_STARTED + TIMEOUT_MIN * 60_000 - 5 * 60_000) break;
    let summary: RespawnRoom | null = null;
    try {
      summary = (await (await fetch(`${URL_}/rooms/${encodeURIComponent(room)}`)).json()) as RespawnRoom;
    } catch {}
    const d = respawnDecision({ name: previousName, exitCode: exitCodes.get(previousName) ?? null, attempt: i, room: summary });
    if (!d.respawn) {
      log(`${previousName} exited; not respawning: ${d.reason}`);
      break;
    }
    const nm = `${name}-r${i}`;
    let note: string;
    try {
      note = await registerRespawn(URL_, room, previousName, nm, process.env.CHATROOM_LAUNCHER_TOKEN, undefined, d.reason);
    } catch (error) {
      log(`Not respawning ${previousName}: ${error instanceof Error ? error.message : "replacement registration failed"}`);
      break;
    }
    log(`${previousName} exited while ${room} is ${summary?.state}; respawning as ${nm}: ${d.reason}`);
    out = await mk(nm, note);
    previousName = nm;
  }
  return out;
}

/** Last exit code per seat name; withRespawn reads it to tell a crash from a finished seat. */
const exitCodes = new Map<string, number | null>();
/** Only successfully isolated workers receive seat commit attribution (never planner/verifier). */
const writeWorkers = new Set<string>();

function runProc(name: string, cmd: string, args: string[], cwd: string, outFile: string, outViaFile = false): Promise<string> {
  return new Promise((res) => {
    const child = spawn(cmd, args, { cwd, env: seatChildEnv(process.env, writeWorkers.has(name) ? name : undefined), stdio: ["ignore", "pipe", "pipe"] });
    children.push(child);
    let out = "";
    let err = "";
    child.stdout?.on("data", (d) => (out += d));
    child.stderr?.on("data", (d) => {
      err += d;
      // a seat's rate-limit retries, provider errors and budget exits are worth seeing live, not only in its log at exit
      for (const line of String(d).split("\n")) if (/retry|provider error|budget spent|step cap|could not leave|OpenRouter:/.test(line)) log(`${name}: ${line.replace(/^\[openrouter [^\]]*\] /, "").slice(0, 160)}`);
    });
    child.on("close", (code) => {
      writeFileSync(resolve(OUT, `${name}.log`), err);
      if (!outViaFile) writeFileSync(outFile, out);
      const final = outViaFile ? safeRead(outFile) : out;
      exitCodes.set(name, code);
      log(`${name} exited (${code})`);
      res(final.trim());
    });
  });
}
const safeRead = (f: string) => {
  try {
    return readFileSync(f, "utf8");
  } catch {
    return "";
  }
};

// ---------- live transcript tail ----------
const seen = new Map<string, number>();
async function tailRooms(rooms: string[]) {
  for (const room of rooms) {
    try {
      const since = seen.get(room) ?? 0;
      const msgs = (await (await fetch(`${URL_}/rooms/${room}/messages?since=${since}`)).json()) as { seq: number; from: { name: string }; kind: string; content: string }[];
      for (const m of msgs) {
        seen.set(room, m.seq);
        const short = m.content.length > 300 ? m.content.slice(0, 300) + "…" : m.content;
        console.log(`\x1b[36m[${room.replace(`${SWARM_ID}-`, "")}]\x1b[0m \x1b[1m${m.from.name}\x1b[0m${m.kind !== "chat" ? ` (${m.kind})` : ""}: ${short.replace(/\n+/g, " ")}`);
      }
    } catch {}
  }
}

/** With --full-access, give each worker its own git worktree so parallel edits cannot collide. */
const isGitRepo = spawnSync("git", ["-C", CWD, "rev-parse", "--is-inside-work-tree"], { encoding: "utf8" }).stdout?.trim() === "true";
const readOnlyWorkers = new Set<string>();
function workerCwd(name: string): string {
  if (!FULL || !isGitRepo) return CWD;
  const dir = resolve(CWD, ".swarm-worktrees", SWARM_ID, name);
  const branch = `swarm/${SWARM_ID}/${name}`;
  const r = spawnSync("git", ["-C", CWD, "worktree", "add", "-b", branch, dir], { encoding: "utf8" });
  if (r.status !== 0) {
    log(`worktree for ${name} failed (${r.stderr.trim()}); ${name} will run READ-ONLY in ${CWD}`);
    readOnlyWorkers.add(name);
    return CWD;
  }
  // a worktree has no node_modules; link the main checkout's so `npm run build` and the tests work there
  const mods = resolve(CWD, "node_modules");
  if (existsSync(mods) && !existsSync(resolve(dir, "node_modules"))) {
    try {
      symlinkSync(mods, resolve(dir, "node_modules"), "dir");
    } catch (e) {
      log(`could not link node_modules into ${dir}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  writeWorkers.add(name);
  log(`${name} works in ${dir} (branch ${branch})`);
  return dir;
}

// ---------- main ----------
interface Plan {
  summary: string;
  done_when: string;
  groups: { id: string; title: string; workers: number; directive: string }[];
  verifier_directive: string;
}

await ensureHub();
if (FLAT) {
  const info = (await (await fetch(URL_)).json()) as { caps?: { max_live_per_room: number } };
  const cap = info.caps?.max_live_per_room ?? 12;
  if (TOTAL > cap) {
    console.error(`--flat puts every agent in one room and this hub caps a room at ${cap} live agents; --agents ${TOTAL} could never conclude. Use --agents ${cap} or start the hub with CHATROOM_MAX_LIVE_PER_ROOM=${TOTAL}.`);
    process.exit(2);
  }
}
log(`swarm ${SWARM_ID}: ${TOTAL} agents (${WORKERS} workers + verifier), project ${CWD}`);
/** Earlier runs in this checkout: a room should ratify or refute them by reference, not re-derive them. */
function priorRuns(): string {
  const dir = resolve(repoRoot, "swarms");
  if (!existsSync(dir)) return "";
  // run ids are HHMMSS, so a name sort mixes days; the report is written when a run ends, so its time orders runs
  const rows = readdirSync(dir)
    .filter((d) => existsSync(resolve(dir, d, "report.md")))
    .map((d) => ({ d, at: statSync(resolve(dir, d, "report.md")).mtimeMs }))
    .sort((a, b) => a.at - b.at)
    .slice(-6)
    .map(({ d }) => {
      const t = readFileSync(resolve(dir, d, "report.md"), "utf8");
      const task = /\*\*Task:\*\* ([^\n]+)/.exec(t)?.[1] ?? "";
      const state = /## Final answer \(([a-z]+)\)/.exec(t)?.[1] ?? "?";
      return `- ${d} (${state}): ${task.slice(0, 160)}${task.length > 160 ? "…" : ""} — swarms/${d}/report.md`;
    });
  return rows.length ? `PRIOR RUNS in this checkout (read the report before re-deriving; ratify or refute by reference):\n${rows.join("\n")}\n` : "";
}
const SETTLED = settledAxes(CWD) + priorRuns();
if (SETTLED) log(`decision log found: ${SETTLED.split("\n").length - 4} settled axes injected into every prompt`);
let plan: Plan;
if (FLAT) {
  log("flat mode: no planner; everyone in one room");
  plan = {
    summary: task,
    done_when: flag("done-when", "The room has adopted one proposal that answers the task, challenged and verified.")!,
    groups: [{ id: "room", title: "Room", workers: WORKERS, directive: task }],
    verifier_directive: flag("verify", "Check the concrete claims in the final proposal against the files, transcripts or commands they cite; agree only with evidence.")!,
  };
} else {
  log("planning…");
  const planRaw = (await runClaude("planner", prompt("planner.md", { TASK: task, CWD, WORKERS, MAX_GROUPS: Math.max(1, Math.floor(WORKERS / 2)) }) + "\n\n" + SETTLED, READ_TOOLS.filter((t) => !t.startsWith("mcp__")), CWD, PLANNER_MODEL)).text;
  try {
    plan = JSON.parse(planRaw.slice(planRaw.indexOf("{"), planRaw.lastIndexOf("}") + 1));
  } catch {
    console.error("planner did not return JSON:\n" + planRaw);
    process.exit(1);
  }
}
// normalise worker counts to exactly WORKERS
let sum = plan.groups.reduce((a, g) => a + (g.workers || 1), 0);
while (sum < WORKERS) {
  plan.groups[sum % plan.groups.length].workers++;
  sum++;
}
while (sum > WORKERS) {
  const g = plan.groups.find((g) => g.workers > 1) ?? plan.groups[plan.groups.length - 1];
  if (g.workers > 1) g.workers--;
  else plan.groups.pop();
  sum = plan.groups.reduce((a, g) => a + g.workers, 0);
}
writeFileSync(resolve(OUT, "plan.json"), JSON.stringify(plan, null, 2));
log(`plan: ${plan.groups.map((g) => `${g.title} ×${g.workers}`).join(" | ")}`);

const leadsRoom = FLAT ? `${SWARM_ID}-room` : `${SWARM_ID}-leads`;
const groupRooms = FLAT ? [] : plan.groups.map((g) => `${SWARM_ID}-${g.id}`);
const runs: Promise<SeatRun>[] = [];
/**
 * Alternate-provider seats: --codex k and --openrouter k take non-lead seats, rotating over their
 * own model lists. Claude keeps the lead and verifier seats.
 */
const altSeats: { agent: "codex" | "openrouter"; model: string }[] = [
  ...Array.from({ length: CODEX }, (_, i) => ({ agent: "codex" as const, model: CODEX_MODELS[i % Math.max(1, CODEX_MODELS.length)] })),
  ...Array.from({ length: OPENROUTER }, (_, i) => ({ agent: "openrouter" as const, model: OPENROUTER_MODELS[i % Math.max(1, OPENROUTER_MODELS.length)] })),
];
const ALT = altSeats.length;
/** Seats the alt providers take, walked from the back so k asked for is k launched, never the lead. */
const altSlots = new Set<string>();
for (let back = 0; back < Math.max(0, ...plan.groups.map((g) => g.workers)) && altSlots.size < ALT; back++) {
  for (const g of plan.groups) {
    if (altSlots.size >= ALT) break;
    const i = g.workers - back;
    if (g.workers > 1 && i > (FLAT ? 0 : 1)) altSlots.add(`${g.id}:${i}`);
  }
}
let workerIndex = 0;

// verifier joins the leads room first so it is present for every report
const verifierTools = APPLY || FULL ? WRITE_TOOLS : READ_TOOLS;
const verifierText = SETTLED + "\n" + prompt("verifier.md", {
      NAME: "verifier",
      AGENT: VERIFIER_OPENROUTER ? "openrouter" : "claude",
      TOTAL,
      CWD,
      TASK: task,
      DONE_WHEN: plan.done_when,
      GROUP_LIST: FLAT ? "none: every agent is in this one room with you, and may recruit or break out into sub-rooms" : plan.groups.map((g) => g.title).join("; "),
      VERIFIER_DIRECTIVE: plan.verifier_directive,
      LEADS_ROOM: leadsRoom,
      LEADS_N: FLAT ? TOTAL : plan.groups.length + 1,
      APPLY_CLAUSE:
        APPLY || FULL
          ? "You MAY modify files to apply the agreed fix on a new git branch and run the tests to prove it works; report the branch name in your vote." +
            (FULL && isGitRepo ? ` Workers may have committed on branches named swarm/${SWARM_ID}/<name>; inspect and merge or cherry-pick from them as needed.` : "")
          : "Do NOT modify any files; verify by reading and running read-only commands only.",
    });
runs.push(
  withRespawn("verifier", leadsRoom, (nm, note) => (VERIFIER_OPENROUTER ? runOpenRouter(nm, verifierText.split("verifier\"").join(`${nm}\"`) + note, CWD, VERIFIER_OPENROUTER, APPLY || FULL) : runClaude(nm, verifierText + note, verifierTools, CWD, VERIFIER_MODEL))).then((o) => ({ name: "verifier", text: o.text, usage: o.usage })),
);

for (const g of plan.groups) {
  const room = FLAT ? leadsRoom : `${SWARM_ID}-${g.id}`;
  for (let i = 1; i <= g.workers; i++) {
    const alt = altSlots.has(`${g.id}:${i}`) ? altSeats.shift() : undefined; // an alt provider never takes the lead seat
    const agent = alt?.agent ?? "claude";
    const isLead = !FLAT && i === 1;
    const model = alt ? alt.model : isLead ? LEAD_MODEL : MODELS.length ? MODELS[workerIndex++ % MODELS.length] : undefined;
    // flat rooms name agents by model (sonnet-3, deepseek-v4-1-flash-6) so a human can see the mix at a glance
    const name = FLAT ? `${(model ?? agent).split("/").pop()!.replace(/[^a-z0-9]+/gi, "-").replace(/^gpt-/, "")}-${i}` : `${g.id}-${agent}-${i}`;
    log(`launching ${name}${isLead ? " (lead)" : ""}${model ? ` [${model}]` : ""}`);
    const vars = {
      NAME: name,
      AGENT: agent,
      TOTAL,
      CWD,
      TASK: task,
      DONE_WHEN: plan.done_when,
      GROUP_TITLE: g.title,
      DIRECTIVE: g.directive,
      ROOM: room,
      N: g.workers,
      ANON: String(ANON),
      LENS: LENSES[(i - 1) % LENSES.length],
      LEADS_ROOM: leadsRoom,
      AFTER_CONCLUSION: isLead ? prompt("lead-tail.md", { LEADS_ROOM: leadsRoom, NAME: name, AGENT: agent, GROUP_TITLE: g.title }) : "`leave_room` and finish.",
    };
    const wcwd = workerCwd(name);
    const writeRule =
      FULL && !readOnlyWorkers.has(name)
        ? `You MAY modify files and run anything; you are on your own git branch in ${wcwd}. Commit what you want the verifier to test and say so in the room.`
        : "Do NOT modify any files.";
    const buildText = (nm: string) => FLAT
      ? SETTLED +
        "\n" +
        prompt(FLAT_PROMPT, { NAME: nm, N: TOTAL, ROOM: room, TOPIC: task, AGENT: agent }) +
        `\nWorking directory: ${wcwd}; you may read the project and run commands. ${writeRule} A verifier named "verifier" sits in the room and the final proposal needs its agree vote. Organise yourselves: claim areas on the board, recruit or break out into sub-rooms with request_agent when depth is needed, and bring results back here.`
      : SETTLED + "\n" + prompt("worker.md", { ...vars, NAME: nm, CWD: wcwd, WRITE_RULE: writeRule });
    const mayWrite = FULL && !readOnlyWorkers.has(name);
    const mk = (nm: string, note: string) => {
      // Replacements reuse the original successful worktree but commit under their new seat name.
      if (writeWorkers.has(name)) writeWorkers.add(nm);
      return agent === "codex"
        ? runCodex(nm, buildText(nm) + note, wcwd, model)
        : agent === "openrouter"
          ? runOpenRouter(nm, buildText(nm) + note, wcwd, model, mayWrite)
          : runClaude(nm, buildText(nm) + note, mayWrite ? WRITE_TOOLS : READ_TOOLS, wcwd, model);
    };
    runs.push(withRespawn(name, room, mk).then((o) => ({ name, text: o.text, usage: o.usage })));
  }
}

// stopping the launcher stops its seats: an orphaned seat keeps polling the provider with nobody to collect its result
for (const sig of ["SIGTERM", "SIGINT"] as const) process.on(sig, () => { STOPPING = true; log(`${sig}: stopping ${children.length} agent(s)`); for (const c of children) c.kill(); setTimeout(() => process.exit(130), 3000).unref(); });
// the launcher fixes the room's policy before any seat joins (join_room settings only apply at creation)
if (REQUIRE_VERIFICATION || QUORUM) {
  try {
    const r = await fetch(`${URL_}/rooms/${encodeURIComponent(leadsRoom)}/create`, { method: "POST", headers: { "content-type": "application/json", ...(process.env.CHATROOM_HUMAN_TOKEN ? { "x-chatroom-token": process.env.CHATROOM_HUMAN_TOKEN } : {}) }, body: JSON.stringify({ topic: task, expected_participants: FLAT ? TOTAL : plan.groups.length + 1, require_verification: REQUIRE_VERIFICATION, quorum: QUORUM ?? "unanimous" }) });
    log(`${leadsRoom} created with quorum=${QUORUM ?? "unanimous"}${REQUIRE_VERIFICATION ? ", require_verification" : ""} (${r.status})`);
  } catch (e) {
    log(`could not pre-create ${leadsRoom}: ${e instanceof Error ? e.message : String(e)}`);
  }
}
const tail = setInterval(() => tailRooms([...groupRooms, leadsRoom]), 2000);
const timeout = setTimeout(() => {
  log(`timeout after ${TIMEOUT_MIN} min; stopping agents`);
  for (const c of children) c.kill();
}, TIMEOUT_MIN * 60_000);

// R4: persist incrementally — a crash keeps the usage of every run that had already finished (partials, never zero-filled).
const persistIncremental = (done: SeatRun[]) => {
  writeRunResult(resolve(OUT, "result.json"), {
    schemaVersion: 1,
    run: { id: SWARM_ID, startedAt: new Date(RUN_STARTED).toISOString(), completedAt: new Date().toISOString(), task, doneWhen: plan.done_when },
    project: PROJECT_IDENTITY,
    leadRoom: leadsRoom,
    rooms: [],
    verifier: { name: "verifier", output: null },
    reportPath: resolve(OUT, "report.md"),
    artifactPath: resolve(flag("result-path", resolve(OUT, "result.json"))!),
    collectionErrors: [`incremental checkpoint: ${done.length}/${runs.length} runs complete`],
    usage: rollupUsage(done),
  });
};
const completedRuns: SeatRun[] = [];
const results = await Promise.all(runs.map(async (p) => { const r = await p; completedRuns.push(r); persistIncremental(completedRuns); return r; }));
clearTimeout(timeout);
clearInterval(tail);
await tailRooms([...groupRooms, leadsRoom]);

// ---------- report ----------
const collectionErrors: string[] = [];
const fetchText = async (url: string) => {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);
  return response.text();
};
// Fetch full GET payload for every room, including dynamically created break-outs.
try {
  const all = JSON.parse(await fetchText(`${URL_}/rooms`)) as { name: string }[];
  for (const room of all.filter(r => r.name.startsWith(`${SWARM_ID}-`) && r.name !== leadsRoom)) groupRooms.push(room.name);
} catch (e) { collectionErrors.push(`Room discovery: ${String(e)}`); }
const snapshots: RoomSnapshot[] = [];
for (const name of new Set([leadsRoom, ...groupRooms])) {
  const snapshot = await collectRoomSnapshot(URL_, name);
  if (snapshot.error) collectionErrors.push(`${name} payload: ${snapshot.error}`);
  if (snapshot.transcript.error) collectionErrors.push(`${name} transcript: ${snapshot.transcript.error}`);
  snapshots.push(snapshot);
}
const leads = snapshots.find(r => r.name === leadsRoom)?.payload ?? { state: "missing", conclusion: null };
const artifactPath = resolve(flag("result-path", resolve(OUT, "result.json"))!);
const artifact: RunResult = {
  schemaVersion: 1,
  run: { id: SWARM_ID, startedAt: new Date(RUN_STARTED).toISOString(), completedAt: new Date().toISOString(), task, doneWhen: plan.done_when },
  project: PROJECT_IDENTITY,
  leadRoom: leadsRoom,
  rooms: snapshots,
  verifier: { name: "verifier", output: results.find(r => r.name === "verifier")?.text ?? null },
  reportPath: resolve(OUT, "report.md"), artifactPath, collectionErrors, usage: rollupUsage(results),
};
writeRunResult(resolve(OUT, "result.json"), artifact);
if (artifactPath !== resolve(OUT, "result.json")) writeRunResult(artifactPath, artifact);
writeFileSync(artifact.reportPath, renderRunReport(artifact));
{
  // a decision-record-shaped verdict is written where the next run's settledAxes() can find it once a human promotes it
  const verdict = results.find((r) => r.name === "verifier")?.text ?? "";
  const rec = /DECISION RECORD[\s\S]*$/.exec(verdict)?.[0];
  // markdown puts the colon either side of the emphasis: **Slug:** `x` and **Slug**: `x` both count
  const slug = /slug\**:\**\s*`?([a-z0-9-]{3,80})/i.exec(rec ?? "")?.[1];
  if (rec && slug && existsSync(resolve(CWD, "docs", "decisions"))) {
    const dir = resolve(CWD, "docs", "decisions", "proposed");
    mkdirSync(dir, { recursive: true });
    writeFileSync(resolve(dir, `${slug}.md`), `# Proposed decision: ${slug}\n\nFrom ${SWARM_ID} (${leads.state}); report: swarms/${SWARM_ID}/report.md. A human promotes this into docs/decisions/ with \`guard-decisions add\`; nothing is adopted automatically.\n\n${rec}\n`);
    log(`decision record proposed: docs/decisions/proposed/${slug}.md`);
  }
}

console.log("\n==================== FINAL ANSWER ====================");
console.log(leads.conclusion?.text ?? "NO CONSENSUS");
console.log("\n==================== VERIFIER ====================");
console.log(results.find((r) => r.name === "verifier")?.text ?? "(none)");
if (FULL && isGitRepo) console.log(`worker branches: git -C "${CWD}" branch --list "swarm/${SWARM_ID}/*"   (worktrees under .swarm-worktrees/${SWARM_ID}/)`);
console.log(`\nreport: ${resolve(OUT, "report.md")}`);
process.exit(leads.conclusion ? 0 : 1);
