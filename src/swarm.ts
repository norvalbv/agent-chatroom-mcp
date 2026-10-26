#!/usr/bin/env node
/**
 * Swarm orchestrator: one command that turns "get N agents to solve X" into
 * plan -> sub-rooms of workers -> leads room -> verifier with veto -> report.
 *
 *   npx tsx src/swarm.ts "<task>" --agents 6 --cwd /path/to/project [--codex 2] [--openrouter 2] [--apply] [--timeout 30]
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, readFileSync, readdirSync, statSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { carryHooks, hooksLine, hooksOff } from "./worktree-hooks.js";
import { checkJoined, joinLines, roomNames, type LaunchedSeat } from "./join-check.js";
import { dirname, resolve } from "node:path";
import { collectRoomSnapshot, renderRunReport, writeRunResult, rollupUsage, hubUsageRollup, parseClaudeCliOutput, transcriptPath, seatScorecard, classifyOutcome, proposedDecisionDir, promptDigests, type RunResult, type RoomSnapshot, type SeatUsageRollup } from "./result.js";
import { carriedSummary, settledAxes } from "./settled.js";
import { registerRespawn, respawnProbe } from "./respawn.js";
import { fileURLToPath } from "node:url";
import { aiGatesLine, HUB_START_MS, waitForHub, seatHoldMs, carrySettings, launcherHeaders, COMPACT_WINDOW_TESTED, compactWindow, devHubRule, heartbeatHookSettings, hubLogFile, loadDotEnv, outputHeartbeat, ownHubEnv, readLauncherToken, respawnTokenProblem, reusedHubProblem, seatBeat, seatChildEnv, seatCompactWindow, seatPortError, type SeatBeat } from "./env.js";
import { randomUUID } from "node:crypto";
import { claudeUsageProbe, exitDetail, fetchRespawnRoom, respawnChain, type RespawnRoom } from "./respawn.js";
import { claudeArgs } from "./claude-args.js";
import { codexSeatCommand, codexUsageTracker } from "./codex-seat.js";
import { claudeSandbox } from "./sandbox.js";
import { topicDigest } from "./hub/status-view.js";
import { stopStrays } from "./strays.js";
import { launchGuide } from "./cost-estimate.js";
import { seatTarget } from "./seat-targets.js";
import { runRooms } from "./launch/run-rooms.js";
import { digestAcks, digestRecords, loadGroups, renderDigests, type GroupsFile } from "./groups.js";
import { loadResources, seedResources } from "./resources.js";
import { preflightAtLaunch } from "./launch/preflight.js";
import { decisionRecordLine, fileRunDecisionRecord, isVerifierSeat } from "./launch/decision-record.js";
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
const BOOL_FLAGS = new Set(["--keep-hub", "--reuse-hub", "--apply", "--full-access", "--named", "--flat", "--require-verification", "--respawn", "--claude-full", "--no-carry", "--no-seat-targets", "--sandbox", "--no-web"]);
const task = argv.find((a, i) => !a.startsWith("--") && (i === 0 || !argv[i - 1].startsWith("--") || BOOL_FLAGS.has(argv[i - 1])));
if (!task) { console.error('usage: swarm "<task>" [--flat] [--done-when text] [--verify text] [--agents 6] [--cwd dir] [--models sonnet,haiku] [--lead-model opus] [--verifier-model opus] [--planner-model opus] [--codex k] [--codex-models gpt-6-astra,gpt-5.6-sol,gpt-5.6-terra] [--openrouter k] [--openrouter-models deepseek/deepseek-v4.1-flash,...] [--verifier-openrouter slug] [--openrouter-reasoning low|medium|high] [--require-verification] [--quorum unanimous|majority|supermajority] [--chair name] [--owner-word] [--seat-hooks off] [--seat-ai-gates on] [--prompt loop.md] [--groups groups.json [--digest-every 45]] [--resources file.md] [--preflight "<cmd>" | --preflight-strict "<cmd>"] [--respawn] [--apply] [--full-access] [--named] [--claude-full] [--no-carry] [--no-seat-targets] [--no-web] [--sandbox] [--timeout 30] [--port 7717] [--result-path path]'); process.exit(2); }
const PF = preflightAtLaunch(argv, resolve(flag("cwd", process.cwd())!)); // --preflight / --preflight-strict: the kit's environment checks, before anything starts (src/launch/preflight.ts)
/** --groups <file.json>: the run's groups as the operator wrote them (src/groups.ts), one room and one brief each, on the
 * long-room brief (prompts/group.md). No planner runs, and --agents is the file's workers plus the verifier. */
let GROUPS: GroupsFile | undefined;
if (flag("groups")) {
  if (has("flat")) { console.error("--groups gives each group its own room; --flat puts everyone in one. Pass one of them."); process.exit(2); }
  try {
    GROUPS = loadGroups(resolve(flag("groups")!));
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(2);
  }
}
/** --digest-every <minutes>: with --groups, a fresh consolidator seat is started on this interval. It reads every group's
 * room over HTTP without joining it, sends each group what the others found that bears on its brief (post_to_room with
 * ack_required, so the group cannot propose until it has read it) and leaves the pass on the consolidation room's board
 * as digest/<n> for the next pass (prompts/consolidator.md). A seat per pass, not one that polls between them. */
const DIGEST_EVERY_MIN = Number(flag("digest-every", "0"));
if (flag("digest-every") && !(DIGEST_EVERY_MIN > 0)) { console.error("--digest-every takes the minutes between consolidation passes, e.g. --digest-every 45"); process.exit(2); }
if (DIGEST_EVERY_MIN && !GROUPS) { console.error("--digest-every needs --groups: it passes findings between the groups' rooms, and without --groups there is one room or the planner's."); process.exit(2); }
const TOTAL = GROUPS ? GROUPS.groups.reduce((a, g) => a + g.workers, 0) + 1 : Math.max(2, Number(flag("agents", "4")));
const WORKERS = TOTAL - 1; // one seat is the verifier
const CWD = resolve(flag("cwd", process.cwd())!);
const CODEX = Math.min(WORKERS, Number(flag("codex", "0")));
const OPENROUTER = Math.min(WORKERS - CODEX, Number(flag("openrouter", "0")));
const APPLY = has("apply");
const ANON = !has("named"); // worker rooms are anonymous unless --named
const LENSES = ["reproduce and measure before theorising", "the simplest fix that could work", "what could go wrong with the obvious fix", "what the tests and history say", "the maintainer who inherits this in a year"];
const FULL = has("full-access");
/** --claude-full: opt out of the lean claude flag set (src/claude-args.ts) and restore today's args exactly (--tools, --disable-slash-commands, --setting-sources project, --exclude-dynamic-system-prompt-sections all dropped). CHATROOM_CLAUDE_FULL=1 does the same for recruits (src/spawner.ts). */
const CLAUDE_FULL = has("claude-full");
/** --require-verification: the room is created by the launcher with require_verification, so no proposal passes without a verify/* board entry by someone other than its author (or the assigned reviewer, once one is active) whose first line parses as JSON {proposal,command,cwd,base_commit,base_exit_code,commit,exit_code,output_tail} naming it: the same check failed at the parent commit and passes at the proposal's (or passes at both with refactor:true); hub-enforced "done" (VERIFY_HEAD_EXAMPLE in src/hub.ts) */
const REQUIRE_VERIFICATION = has("require-verification");
/** --quorum unanimous|majority|supermajority: the room's quorum, fixed by the launcher at creation (a forty-seat lobby cannot run on unanimity); supermajority = ceil(0.75 x electorate), the recommended default for flat runs that used to ask for plain majority */
const QUORUM = flag("quorum") as "unanimous" | "majority" | "supermajority" | undefined;
/** --chair <name>: the seat that will relay the owner in the lead room. Named when the room is created, so its messages are tagged [chair] and not [chair, self-claimed] (any seat can take an unnamed room's chair by joining first). */
const CHAIR = flag("chair");
/** --prompt <file in prompts/>: the flat-mode brief template (default minimal.md; loop.md for a self-improvement lobby) */
const FLAT_PROMPT = flag("prompt", "minimal.md")!;
/** --respawn: a seat that exits while its room is still open is relaunched (up to 3 times) with a note to read the board first */
const RESPAWN = has("respawn");
const RUN_STARTED = Date.now();
// Capture target identity before workers can change its revision.
const gitIdentity = () => {
  const git = (...args: string[]) => { const r = spawnSync("git", ["--no-optional-locks", "-C", CWD, ...args], { encoding: "utf8" }); if (r.status !== 0) throw new Error(r.stderr); return r.stdout.trim(); };
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
/** --fresh-challenger: a hub this launcher starts recruits one read-only seat per opened proposal to check it (Spawner.freshChallenger) */
const FRESH_CHALLENGER = has("fresh-challenger");
/** --no-carry: seats start from the brief alone (no settled axes, no PRIOR RUNS, auto-memory off); see carrySettings in env.ts */
const NO_CARRY = has("no-carry");
/** --seat-hooks off: seat worktrees do not get the repository's commit hooks (c3d2d088 copies them by default). For runs whose
 * commits are scratch: in devkit the pre-commit runs its LLM reviewer fleet on every commit (evidence/seat-hooks-cost-and-bypass). */
const SEAT_HOOKS_OFF = flag("seat-hooks") === "off";
/** --seat-ai-gates on: seat commits run the repository's AI reviewer gates too. Off by default (owner ruling #985): seats
 * peer review each other, and their commits run only the deterministic gates (SEAT_AI_GATES_OFF in env.ts). Set in this
 * process so seatChildEnv sees it, and so a hub this launcher starts hands it to its recruits. */
if (flag("seat-ai-gates") === "on") process.env.CHATROOM_SEAT_AI_GATES = "on";
/** --owner-word (or CHATROOM_OWNER_WORD=1): every seat's prompt gains prompts/owner-word.md, which makes a [human route: token] message, or a named [chair]'s relay, part of its brief. */
const OWNER_WORD_ON = has("owner-word") || process.env.CHATROOM_OWNER_WORD === "1";
/** --resources <file>: each `## <name>` entry goes on every room's board as resource/<name> before a seat starts (src/resources.ts) */
let RESOURCES: ReturnType<typeof loadResources> = [];
if (has("resources")) {
  try { RESOURCES = loadResources(resolve(flag("resources") ?? "")); } catch (e) { console.error(e instanceof Error ? e.message : String(e)); process.exit(2); }
}
/**
 * --compact-at <tokens>: every Claude seat, and every recruit of a hub this launcher starts, compacts its transcript at
 * this size (compactWindow in env.ts). A hub that was already running keeps its own setting for the seats it recruits.
 * Unset, lean seats compact at SEAT_COMPACT_DEFAULT (300000); "--compact-at off", or --claude-full, leaves Claude Code's own default.
 */
const COMPACT_AT = flag("compact-at") ?? (CLAUDE_FULL ? "off" : undefined);
if (COMPACT_AT === "off") process.env.CHATROOM_SEAT_COMPACT_WINDOW = "off";
else if (COMPACT_AT !== undefined) {
  if (compactWindow(COMPACT_AT) === null) {
    console.error(`--compact-at takes a whole number of tokens from 100000 to 1000000, or "off" (got "${COMPACT_AT}"); "200k" is not accepted.`);
    process.exit(2);
  }
  process.env.CHATROOM_SEAT_COMPACT_WINDOW = COMPACT_AT;
  // swarm-005342-qejc: at 100000 a seat reading large files died of "Autocompact is thrashing"; at 200000 the same task ran through
  if (compactWindow(COMPACT_AT)! < COMPACT_WINDOW_TESTED) console.error(`--compact-at ${COMPACT_AT}: under ${COMPACT_WINDOW_TESTED} a seat that reads large files or outputs can refill its context within three turns of a compaction and stop ("Autocompact is thrashing").`);
}
/** --no-seat-targets: flat seats all get the same brief, with no starting item each (the A arm when measuring src/seat-targets.ts) */
const NO_SEAT_TARGETS = has("no-seat-targets");
/**
 * --sandbox: every seat's shell runs in an OS sandbox (src/sandbox.ts), so a seat's pkill/killall cannot reach the hub,
 * the launcher or another seat (the room15-rep2 kill, docs/reuse-survey-2026-09-23.md). Claude seats get Claude Code's
 * own sandbox in --settings; OpenRouter seats wrap run_command in sandbox-runtime; a hub this launcher starts gets
 * CHATROOM_SANDBOX=1 so its recruits match. Codex seats are not covered (todo/non-claude-seats-stdin-usage-sandbox.md).
 * Default off: flipping it is the owner's call.
 */
const SANDBOX = has("sandbox");
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
if ((OPENROUTER > 0 || VERIFIER_OPENROUTER) && !process.env.OPENROUTER_API_KEY) { console.error("--openrouter needs OPENROUTER_API_KEY (https://openrouter.ai/keys); a dead seat still counts toward the room's expected participants, so refusing to launch."); process.exit(2); }
// workers may edit files and run anything; each gets its own git worktree
/** --no-web: no seat may search or fetch the web, e.g. on a benchmark whose answers are published online. */
const WEB_TOOLS = has("no-web") ? [] : ["WebSearch", "WebFetch"];
const READ_TOOLS = ["mcp__chatroom__*", "Read", "Grep", "Glob", "Bash", ...WEB_TOOLS];
const WRITE_TOOLS = [...READ_TOOLS, "Edit", "Write", "MultiEdit", "NotebookEdit"];
const TIMEOUT_MIN = Number(flag("timeout", "30"));
{
  const refused = seatPortError(process.env, flag("port"));
  if (refused) {
    console.error(refused);
    process.exit(2);
  }
}
/**
 * Minutes a hub this run starts stays up with nobody using it. It must outlive the run so a reviewer can still read the
 * room: in swarm-000525-jcz8 verify entries citing a dev room landed 30-50 min after it ended (-5), hence 120.
 */
const HUB_IDLE_EXIT_MIN = has("keep-hub") ? 0 : Number(flag("hub-idle-exit", "120"));
/**
 * --seat-memory-mb <n>: what the processes one seat starts may hold together. The hub this launcher starts stops a
 * seat's largest process past it and tells the seat (src/hub/memory.ts); every seat reads the figure as
 * CHATROOM_SEAT_MEMORY_MB. A hub that was already running keeps the budget it was started with. Size it as a share of
 * the machine, not per taste: (RAM minus about 8 GB for the system and whatever else runs) over the number of seats,
 * recruits included, e.g. 2500 for six seats on 24 GB.
 */
if (Number(flag("seat-memory-mb", "0")) > 0) process.env.CHATROOM_SEAT_MEMORY_MB = String(Number(flag("seat-memory-mb", "0")));
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
/** What lets this launcher register a replacement seat: its own environment's, else the one the hub's supervisor left on disk. */
let launcherToken = process.env.CHATROOM_LAUNCHER_TOKEN || undefined;
async function ensureHub() {
  let info: { build?: { root?: string; head?: string } } | undefined;
  try {
    info = await (await fetch(URL_)).json() as typeof info;
  } catch {}
  if (info) {
    const head = spawnSync("git", ["-C", repoRoot, "rev-parse", "--short", "HEAD"], { encoding: "utf8" }).stdout?.trim() ?? "";
    const problem = reusedHubProblem(info.build, { root: realpathSync(repoRoot), head });
    // a seat's dev room must test its own build; the operator's runs on a shared hub only get the warning
    if (problem && process.env.CHATROOM_SEAT_KEY && !has("reuse-hub")) {
      console.error(`Refusing to run on :${PORT}: ${problem}. Pick a free port, or pass --reuse-hub if that is intended.`);
      process.exit(2);
    }
    log(`using the hub already running on :${PORT} (not started by this run, so this run never stops it)${problem ? `; WARNING: ${problem}` : ""}`);
    // a supervised hub leaves its launcher token next to its log, in the checkout it was started from
    launcherToken ??= readLauncherToken(info.build?.root ?? repoRoot, PORT);
    return;
  }
  // through the supervisor (src/hubd.ts): a hub that dies mid-run is back within seconds instead of ending the room.
  // A hub with no idle exit is meant to stay, so even a clean exit of it is restarted.
  const keeps = !Object.keys(ownHubEnv(HUB_IDLE_EXIT_MIN, PORT)).length;
  const child = spawn("node", [resolve(repoRoot, "dist/hubd.js"), "--port", String(PORT), ...(keeps ? ["--always"] : [])], {
    // CHATROOM_DEFAULT_CWD: a recruit with no cwd and no worktree to go by works in this run's project, not in this checkout
    env: { ...process.env, PORT: String(PORT), CHATROOM_DATA_DIR: resolve(repoRoot, "data"), CHATROOM_DEFAULT_CWD: process.env.CHATROOM_DEFAULT_CWD || CWD, ...(SANDBOX ? { CHATROOM_SANDBOX: "1" } : {}), ...(OWNER_WORD_ON ? { CHATROOM_OWNER_WORD: "1" } : {}), ...(SEAT_HOOKS_OFF ? { CHATROOM_SEAT_HOOKS: "off" } : {}), ...(FRESH_CHALLENGER ? { CHATROOM_FRESH_CHALLENGER: "1" } : {}), ...ownHubEnv(HUB_IDLE_EXIT_MIN, PORT) },
    detached: true,
    stdio: "ignore",
  });
  child.unref();
  let supervisorExited = false;
  child.once("exit", () => { supervisorExited = true; });
  log(`started a supervised hub on :${PORT} (supervisor pid ${child.pid}, log ${hubLogFile(repoRoot, PORT)}); it is restarted if it dies and ${keeps ? `keeps running: stop it with kill ${child.pid}` : `stops itself after ${HUB_IDLE_EXIT_MIN} min with no request (--hub-idle-exit, --keep-hub)`}`);
  const t0 = Date.now();
  if (await waitForHub(URL_, HUB_START_MS, () => supervisorExited)) {
    if (Date.now() - t0 > 10_000) log(`the hub took ${Math.round((Date.now() - t0) / 1000)} s to start`);
    launcherToken ??= readLauncherToken(repoRoot, PORT);
    return;
  }
  throw new Error(supervisorExited ? `hub did not start: its supervisor exited after ${Math.round((Date.now() - t0) / 1000)} s (log ${hubLogFile(repoRoot, PORT)})` : `hub did not start within ${HUB_START_MS / 1000} s (CHATROOM_HUB_START_MS)`);
}

// ---------- agents ----------
const children: ChildProcess[] = [];
/** The latest process per seat name, and the seats the timeout had to kill: the report's "how it ended" column. */
const seatChildren = new Map<string, ChildProcess>();
const killedAtTimeout = new Set<string>();
/** Cost per process name (`name-rN` for a respawn): withRespawn hands back only the last attempt under the base name. */
const seatCosts = new Map<string, number>();
const seatTranscripts = new Map<string, string>();
const priced = (name: string, o: SeatOutcome): SeatOutcome => { if (o.usage) seatCosts.set(name, o.usage.cost); return o; };

/**
 * R4 usage telemetry for claude seats: `--output-format json` turns stdout into one JSON blob carrying
 * `result` (the seat's final text) alongside `usage`/`total_cost_usd`, in place of the plain text
 * `--output-format text` (the CLI default) would have produced. runProc buffers that blob into outFile
 * exactly as before; parseClaudeCliOutput splits it back into {text, usage} and the text is rewritten
 * over outFile so the .out file holds the seat's final text exactly as today, never the raw JSON.
 */
function runClaude(name: string, text: string, tools: string[], cwd: string, model?: string): Promise<SeatOutcome> {
  const outFile = resolve(OUT, `${name}.out`);
  // per seat: the MCP URL carries this seat's heartbeat key, which its tool hook sends on every local tool call, and how
  // long its client waits for a tool, so the hub holds its empty waits that long (seatHoldMs)
  const beat = seatBeat(`${URL_}/mcp`, randomUUID(), cwd, seatHoldMs(), task && text.includes(task) ? topicDigest(task) : undefined);
  const seatMcp = resolve(OUT, `${name}.mcp.json`);
  writeFileSync(seatMcp, JSON.stringify({ mcpServers: { chatroom: { type: "http", url: beat.mcpUrl } } }));
  // a seat may write when its tool list lets it edit (WRITE_TOOLS); a read-only seat's Bash gets its cwd denied
  const sandbox = SANDBOX ? claudeSandbox({ cwd, write: tools.includes("Edit"), hubPort: PORT }) : undefined;
  const args = claudeArgs({ mcpJson: seatMcp, tools, model, full: CLAUDE_FULL, settings: carrySettings(NO_CARRY, heartbeatHookSettings()), sandbox });
  return runProc(name, "claude", args, cwd, outFile, false, beat, false, text).then((raw) => {
    const { text: final, usage, sessionId } = parseClaudeCliOutput(raw);
    // where the seat's transcript is, for result.json (gap G17: it is under the launcher's CLAUDE_CONFIG_DIR, not ~/.claude)
    const transcript = transcriptPath(sessionId, cwd);
    if (transcript) seatTranscripts.set(name, transcript);
    writeFileSync(outFile, final);
    // per-seat usage next to the .out, the same sidecar shape an OpenRouter seat writes (scripts/pool-run.ts reads it per seat)
    if (usage) writeFileSync(resolve(OUT, `${name}.usage.json`), JSON.stringify(usage));
    return priced(name, { text: final, usage });
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
  // the seat's own budget matches the launcher's timeout so it leaves the room rather than being killed in it;
  // the prompt goes on stdin (src/openrouter.ts reads it there when no -p is given), never argv (src/claude-args.ts)
  const args = [...seatScript.pre, "--mcp-url", `${URL_}/mcp`, "--cwd", cwd, "--max-minutes", String(TIMEOUT_MIN), "--usage-sidecar", sidecar];
  if (model) args.push("--model", model);
  if (write) args.push("--write");
  if (OPENROUTER_REASONING) args.push("--reasoning", OPENROUTER_REASONING);
  if (SANDBOX) args.push("--sandbox");
  openRouterSeats.add(name);
  return runProc(name, seatScript.cmd, args, cwd, outFile, false, undefined, false, text).then((t) => priced(name, { text: t, usage: readSeatUsage(sidecar) }));
}

/**
 * Native Codex app-server adapter: prompt on stdin, read-only unless the seat may write, normalized JSONL
 * events and cumulative usage beside the final output. The adapter owns activity heartbeats and turn/steer.
 */
function runCodex(name: string, text: string, cwd: string, model: string | undefined, write: boolean): Promise<SeatOutcome> {
  const outFile = resolve(OUT, `${name}.out`);
  const sidecar = resolve(OUT, `${name}.usage.json`);
  const beat = seatBeat(`${URL_}/mcp`, randomUUID(), cwd);
  const { cmd, args } = codexSeatCommand({ cwd, mcpUrl: beat.mcpUrl, model, readOnly: !write, outFile, json: true });
  const events = createWriteStream(resolve(OUT, `${name}.events.jsonl`)).on("error", (e) => log(`${name}: event log: ${e.message}`));
  // written on every turn.completed, so a seat stopped after one keeps what it had reported; a write error must not kill the launcher
  const track = codexUsageTracker((usage) => { try { writeFileSync(sidecar, JSON.stringify(usage, null, 2)); } catch (e) { log(`${name}: usage sidecar: ${e instanceof Error ? e.message : String(e)}`); } });
  const onStdout = (d: Buffer) => { events.write(d); track(d); };
  return runProc(name, cmd, args, cwd, outFile, true, beat, false, text, onStdout).then((t) => { events.end(); return priced(name, { text: t, usage: readSeatUsage(sidecar) }); });
}

/**
 * A seat that exits while its room is still open is relaunched under a suffixed name only when the room still needs
 * it: it crashed (non-zero exit), it left a claim/* with no handoff/*, the room fell below its floor, or it is the
 * verifier. A seat that finished, handed over and left is not replaced merely because the room is open; the first
 * respawning launcher did that 70 times in two runs (src/respawn.ts). Up to three times and never in the last five minutes.
 */
/** Attempts a respawn replaced, by process name: their usage belongs in the run total (unknown stays unknown). */
const replacedRuns: SeatRun[] = [];
/** `probeModel`: the Claude model this seat runs on (undefined: the CLI's default), which is the one asked when the usage limit stopped it. */
async function withRespawn(name: string, room: string, probeModel: string | undefined, mk: (nm: string, note: string) => Promise<SeatOutcome>): Promise<SeatOutcome> {
  if (!RESPAWN) return mk(name, "");
  const chain = await respawnChain<SeatOutcome>({
    name,
    stop: () => STOPPING || Date.now() > RUN_STARTED + TIMEOUT_MIN * 60_000 - 5 * 60_000,
    room: () => fetchRespawnRoom(URL_, room),
    exitCode: (nm) => exitCodes.get(nm) ?? null,
    signal: (nm) => exitSignals.get(nm) ?? null,
    detail: (nm) => exitDetails.get(nm) ?? "",
    usageReady: () => claudeUsageProbe({ model: probeModel, cwd: CWD, env: seatChildEnv(process.env), log, who: name }),
    ...(Number(process.env.CHATROOM_USAGE_POLL_MS) > 0 ? { usagePollMs: Number(process.env.CHATROOM_USAGE_POLL_MS) } : {}),
    register: (previousName, nm, reason) => registerRespawn(URL_, room, previousName, nm, launcherToken, undefined, reason),
    run: mk,
    log,
  });
  for (const r of chain.replaced) replacedRuns.push({ name: r.name, ...r.outcome });
  return chain.last;
}

/** Last exit code per seat name; withRespawn reads it to tell a crash from a finished seat. */
const exitCodes = new Map<string, number | null>();
/** The signal that ended a seat, when one did: code is null for every signal, and SIGKILL (out of memory) is not a stop. */
const exitSignals = new Map<string, string | null>();
/** The exit receipt's detail per seat name (exitDetail): withRespawn waits out a usage-limit exit instead of relaunching into it. */
const exitDetails = new Map<string, string>();
/** Only successfully isolated workers receive seat commit attribution (never planner/verifier). */
const writeWorkers = new Set<string>();
/** Seats that run on OpenRouter: the only ones whose environment keeps the paid key (SEAT_PAID_KEYS in env.ts). */
const openRouterSeats = new Set<string>();

/** `beat`: the seat's heartbeat key and env; `beatOnOutput`: its output is its heartbeat (codex exec has no tool hooks); `stdin`: the prompt; `onStdout`: sees stdout as it arrives. */
function runProc(name: string, cmd: string, args: string[], cwd: string, outFile: string, outViaFile = false, beat?: SeatBeat, beatOnOutput = false, stdin?: string, onStdout?: (d: Buffer) => void): Promise<string> {
  return new Promise((res) => {
    const child = spawn(cmd, args, { cwd, env: { ...seatChildEnv(process.env, writeWorkers.has(name) ? name : undefined, openRouterSeats.has(name), cmd === "claude"), ...beat?.env }, stdio: [stdin === undefined ? "ignore" : "pipe", "pipe", "pipe"] });
    if (stdin !== undefined) { child.stdin?.on("error", () => {}); child.stdin?.end(stdin); } // the prompt, never argv (claude-args.ts)
    if (beat && beatOnOutput) {
      const send = outputHeartbeat((detail) => {
        fetch(`${URL_}/heartbeat`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ seat_key: beat.key, tool: cmd, detail }), signal: AbortSignal.timeout(5_000) }).catch(() => {});
      });
      child.stdout?.on("data", send);
      child.stderr?.on("data", send);
    }
    children.push(child);
    seatChildren.set(name, child);
    let out = "";
    let err = "";
    // a seat whose final text comes from a file (codex -o) needs no copy of stdout held in memory
    child.stdout?.on("data", (d: Buffer) => { if (!outViaFile) out += d; onStdout?.(d); });
    child.stderr?.on("data", (d) => {
      err += d;
      // a seat's rate-limit retries, provider errors and budget exits are worth seeing live, not only in its log at exit
      for (const line of String(d).split("\n")) if (/retry|provider error|budget spent|step cap|could not leave|OpenRouter:/.test(line)) log(`${name}: ${line.replace(/^\[openrouter [^\]]*\] /, "").slice(0, 160)}`);
    });
    child.on("close", async (code, signal) => {
      writeFileSync(resolve(OUT, `${name}.log`), err);
      if (!outViaFile) writeFileSync(outFile, out);
      const final = outViaFile ? safeRead(outFile) : out;
      exitCodes.set(name, code);
      exitSignals.set(name, signal);
      exitDetails.set(name, exitDetail(code, [final, err], Date.now(), signal));
      log(`${name} exited (${exitDetails.get(name)!.replace(/^exit /, "")})`);
      // the exit receipt: the hub closes this seat's MCP sessions, so a dead seat is not read as alive in a long command.
      // Awaited (5 s at most): withRespawn reads the room's active seats next, and the launcher's own exit would cut it off.
      if (beat) await fetch(`${URL_}/heartbeat`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ seat_key: beat.key, exited: true, detail: exitDetail(code, [final, err], Date.now(), signal), ...(killedAtTimeout.has(name) ? { stopped_by: "timeout" } : STOPPING ? { stopped_by: "operator" } : {}) }), signal: AbortSignal.timeout(5_000) }).catch(() => {});
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
/** Commits a write seat left on its own branch: a builder's output is commits, which the board never shows. */
const branchCommits = (name: string): number | undefined => {
  if (!writeWorkers.has(name) || !PROJECT_IDENTITY.git) return undefined;
  const n = Number(spawnSync("git", ["-C", CWD, "rev-list", "--count", `${PROJECT_IDENTITY.git.revision}..swarm/${SWARM_ID}/${name}`], { encoding: "utf8" }).stdout?.trim());
  return Number.isFinite(n) ? n : undefined;
};
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
  // nor a hooks runner: without it every commit this seat makes skips the repository's hooks (bugs.md 4)
  log(hooksLine(name, SEAT_HOOKS_OFF ? hooksOff(CWD) : carryHooks(CWD, dir)));
  log(`${name}: ${aiGatesLine(seatChildEnv(process.env, name))}`);
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
{
  // said now: the last Polymarket room learned it at 16:37, when the first replacement was refused
  // ...and asked of the hub itself: a token in hand is not a token the hub accepts (hub 7717 was started with none)
  const problem = RESPAWN ? (await respawnProbe(URL_, launcherToken)) ?? respawnTokenProblem(RESPAWN, launcherToken, PORT) : null;
  if (problem) console.error(`\x1b[1;31m${problem}\x1b[0m`);
}
if (FLAT) {
  const info = (await (await fetch(URL_)).json()) as { caps?: { max_live_per_room: number } };
  const cap = info.caps?.max_live_per_room ?? 12;
  if (TOTAL > cap) {
    console.error(`--flat puts every agent in one room and this hub caps a room at ${cap} live agents; --agents ${TOTAL} could never conclude. Use --agents ${cap} or start the hub with CHATROOM_MAX_LIVE_PER_ROOM=${TOTAL}.`);
    process.exit(2);
  }
}
log(`swarm ${SWARM_ID}: ${TOTAL} agents (${WORKERS} workers + verifier), project ${CWD}`);
const SIZING = launchGuide({ total: TOTAL, timeoutMin: TIMEOUT_MIN, flat: FLAT, groupWorkers: GROUPS?.groups.map((g) => g.workers), task, seatTargets: !NO_SEAT_TARGETS }, log);
if (SANDBOX) log(`--sandbox: claude seats run Bash in Claude Code's sandbox, OpenRouter seats wrap run_command in sandbox-runtime${CODEX ? `; the ${CODEX} codex seat(s) are NOT sandboxed by this flag` : ""}`);
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
const SETTLED = NO_CARRY ? "" : settledAxes(CWD) + priorRuns();
{
  // what the seat actually gets: an inherited CLAUDE_CODE_AUTO_COMPACT_WINDOW (e.g. this launcher itself runs in a seat) passes through
  const window = seatChildEnv(process.env, undefined, false, true).CLAUDE_CODE_AUTO_COMPACT_WINDOW;
  const why = seatCompactWindow(process.env) !== null ? (COMPACT_AT === undefined ? "default; --compact-at to change" : "--compact-at") : window ? "inherited CLAUDE_CODE_AUTO_COMPACT_WINDOW" : "--compact-at off / --claude-full";
  log(`compact window: Claude seats compact their transcript at ${window ? `${window} tokens` : "Claude Code's own default (near the model's limit)"} (${why})`);
}
if (NO_CARRY || SETTLED) log(NO_CARRY ? "--no-carry: no settled axes or prior runs injected; seat auto-memory off" : ((c) => `decision log found: ${c.axes} settled axes and ${c.ids.length} sources already read injected into every prompt`)(carriedSummary(SETTLED)));
let plan: Plan;
if (FLAT) {
  log("flat mode: no planner; everyone in one room");
  plan = {
    summary: task,
    done_when: flag("done-when", "The room has adopted one proposal that answers the task, challenged and verified.")!,
    groups: [{ id: "room", title: "Room", workers: WORKERS, directive: task }],
    verifier_directive: flag("verify", "Check the concrete claims in the final proposal against the files, transcripts or commands they cite; agree only with evidence.")!,
  };
} else if (GROUPS) {
  plan = {
    summary: task,
    done_when: flag("done-when", GROUPS.done_when ?? "Every group has concluded and this room has adopted one proposal that answers the task, challenged and verified.")!,
    groups: GROUPS.groups,
    verifier_directive: flag("verify", GROUPS.verifier_directive ?? "Check the concrete claims in each group's conclusion and in the final proposal against the files, transcripts or commands they cite; agree only with evidence.")!,
  };
  log(`groups file: ${plan.groups.map((g) => `${g.title} ×${g.workers}`).join(" | ")}`);
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
const FLAT_TARGETS = FLAT && !NO_SEAT_TARGETS && seatTarget(task, 1, LENSES) ? (i: number) => seatTarget(task, i, LENSES) : undefined;
const groupRooms = FLAT ? [] : plan.groups.map((g) => `${SWARM_ID}-${g.id}`);
if (PF.resource) RESOURCES.push(PF.resource);
if (RESOURCES.length) {
  try {
    for (const line of await seedResources(URL_, [...groupRooms, leadsRoom], RESOURCES, { headers: launcherHeaders(launcherToken) })) log(line);
  } catch (e) {
    log(`not starting any seat: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(2);
  }
}
const runs: Promise<SeatRun>[] = [];
/** Every seat this launcher started and the room it was told to join (checked once by the join check below). */
const launched: LaunchedSeat[] = [];
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
    // a flat room has no lead seat, so its only worker may be the alt seat (bugs.md 6: `--flat --agents 2 --codex 1`
    // silently launched Claude); a group keeps its first seat, the lead, on Claude
    if ((FLAT || g.workers > 1) && i > (FLAT ? 0 : 1)) altSlots.add(`${g.id}:${i}`);
  }
}
{
  const asked = Number(flag("codex", "0")) + Number(flag("openrouter", "0"));
  // fewer alt seats than asked is said, never silent: a model-specific benchmark run was mislabelled that way
  if (asked > altSlots.size) log(`asked for ${asked} alternate-provider seat(s); this run has room for ${altSlots.size} (the verifier${FLAT ? "" : " and each group's lead"} stay on Claude), so ${asked - altSlots.size} run as Claude instead`);
}
let workerIndex = 0;

// verifier joins the leads room first so it is present for every report
const verifierTools = APPLY || FULL ? WRITE_TOOLS : READ_TOOLS;
/**
 * Appended to every seat's launch prompt: which room messages carry the owner's word. A seat's brief is its user
 * message and a room message is tool output, so an owner instruction in the room that changes the brief is ignored or
 * refused unless the brief itself delegates to that channel (sources/2404.13208; "a message in the room does not carry
 * that authority for me", swarm-115621-079m-benchmark #18). The tags it names are the hub's (Hub.speakerTag).
 * OFF unless the run is launched with --owner-word: it makes a token-tagged room message part of every seat's brief,
 * and the token is only as secret as this machine's process table (review/a9060d5e-verifier). The owner turns it on
 * for a run they mean to steer.
 */
const OWNER_WORD = OWNER_WORD_ON ? "\n\n" + readFileSync(resolve(repoRoot, "prompts", "owner-word.md"), "utf8").trim() : "";
const verifierText = PF.text + SETTLED + "\n" + prompt("verifier.md", {
      NAME: "verifier",
      AGENT: VERIFIER_OPENROUTER ? "openrouter" : "claude",
      TOTAL,
      CWD,
      TASK: task,
      DONE_WHEN: plan.done_when,
      GROUP_LIST: FLAT ? "none: every agent is in this one room with you, and may recruit or break out into sub-rooms"
        // hand-written groups run for hours before a lead reports: the verifier is told where each one works, so it can
        // check results as they land on a group's board and answer a group that asks it for a ruling
        : GROUPS ? plan.groups.map((g) => `${g.title}, in room \`${SWARM_ID}-${g.id}\` (read its board and conclusion at ${URL_}/rooms/${SWARM_ID}-${g.id} with curl, without joining it)`).join("; ") +
          `. The groups do not read each other's rooms and report here only at the end. Until then, check what lands on their boards; a group asks you for a ruling with post_to_room into this room (it arrives as inbox/<its room>/<key>), and you answer with post_to_room (from_room="${leadsRoom}", to_room=<its room>)`
        : plan.groups.map((g) => g.title).join("; "),
      VERIFIER_DIRECTIVE: plan.verifier_directive,
      LEADS_ROOM: leadsRoom,
      LEADS_N: FLAT ? TOTAL : plan.groups.length + 1,
      APPLY_CLAUSE:
        APPLY || FULL
          ? "You MAY modify files to apply the agreed fix on a new git branch and run the tests to prove it works; report the branch name in your vote." +
            (FULL && isGitRepo ? ` Workers may have committed on branches named swarm/${SWARM_ID}/<name>; inspect and merge or cherry-pick from them as needed.` : "")
          : "Do NOT modify any files; verify by reading and running read-only commands only.",
    });
// the launcher fixes the room's policy and topic before any seat joins (join_room settings only apply at creation), with
// or without policy flags: the flat briefs no longer pass topic= to join_room (it put the topic in every seat's context a
// second and third time, scripts/topic-once-regression.ts), so the first seat to join must not be the one creating it
{
  try {
    const r = await fetch(`${URL_}/rooms/${encodeURIComponent(leadsRoom)}/create`, { method: "POST", headers: launcherHeaders(launcherToken), body: JSON.stringify({ topic: task, expected_participants: FLAT ? TOTAL : plan.groups.length + 1, require_verification: REQUIRE_VERIFICATION, quorum: QUORUM ?? "unanimous", ...(CHAIR ? { chair: CHAIR } : {}) }) });
    log(`${leadsRoom} created with quorum=${QUORUM ?? "unanimous"}${REQUIRE_VERIFICATION ? ", require_verification" : ""}${CHAIR ? `, chair ${CHAIR}${((await r.clone().json().catch(() => ({}))) as { chair_named?: boolean }).chair_named ? " (named)" : " (NOT named: the hub did not accept this launcher's token, so the chair will read as self-claimed)"}` : ""} (${r.status})`);
  } catch (e) {
    log(`could not pre-create ${leadsRoom}: ${e instanceof Error ? e.message : String(e)}${e instanceof Error && e.cause ? ` (cause: ${(e.cause as NodeJS.ErrnoException).code ?? (e.cause as Error).message})` : ""}`);
  }
}
if (REQUIRE_VERIFICATION || QUORUM || CHAIR) {
  // a hand-written group works for hours and concludes its own proposal, so its room gets the run's policy too. It is a
  // breakout of the leads room (parent): the hub carries its conclusion onto the leads board, the leads room's last call
  // waits for it, and it is told when the leads room concludes (swarm-123021-1nwp: leads concluded 92 min before internal)
  for (const g of GROUPS ? plan.groups : []) {
    const room = `${SWARM_ID}-${g.id}`;
    try {
      const r = await fetch(`${URL_}/rooms/${encodeURIComponent(room)}/create`, { method: "POST", headers: launcherHeaders(launcherToken), body: JSON.stringify({ topic: `${g.title}: ${g.directive}`, expected_participants: g.workers, require_verification: REQUIRE_VERIFICATION, quorum: QUORUM ?? "unanimous", parent: leadsRoom }) });
      log(`${room} created with quorum=${QUORUM ?? "unanimous"}${REQUIRE_VERIFICATION ? ", require_verification" : ""} (${r.status})`);
    } catch (e) {
      log(`could not pre-create ${room}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}
launched.push({ name: "verifier", room: leadsRoom });
runs.push(
  withRespawn("verifier", leadsRoom, VERIFIER_OPENROUTER ? undefined : VERIFIER_MODEL, (nm, note) => (VERIFIER_OPENROUTER ? runOpenRouter(nm, verifierText.split("verifier\"").join(`${nm}\"`) + OWNER_WORD + note, CWD, VERIFIER_OPENROUTER, APPLY || FULL) : runClaude(nm, verifierText + OWNER_WORD + note, verifierTools, CWD, VERIFIER_MODEL))).then((o) => ({ name: "verifier", text: o.text, usage: o.usage })),
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
        ? `You MAY modify files and run anything; you are on your own git branch in ${wcwd}. Commit what you want the verifier to test and say so in the room.${devHubRule(CWD, SANDBOX)}`
        : "Do NOT modify any files.";
    const buildText = (nm: string) => PF.text + (FLAT
      ? SETTLED +
        "\n" +
        prompt(FLAT_PROMPT, { NAME: nm, N: TOTAL, ROOM: room, TOPIC: task, AGENT: agent }) +
        // a distinct starting item per flat seat, so one brief does not put every seat on one target (src/seat-targets.ts)
        (FLAT_TARGETS ? `\n${FLAT_TARGETS(i)}` : "") +
        `\nWorking directory: ${wcwd}; you may read the project and run commands. ${writeRule} A verifier named "verifier" sits in the room and the final proposal needs its agree vote. Organise yourselves: claim areas on the board, recruit or break out into sub-rooms with request_agent when depth is needed, and bring results back here.`
      : SETTLED + "\n" + (GROUPS
        ? prompt("group.md", { ...vars, NAME: nm, GROUPS_N: plan.groups.length, WRITE_RULE: `Working directory: ${wcwd}; you may read the project and run commands. ${writeRule}` })
        : prompt("worker.md", { ...vars, NAME: nm, CWD: wcwd, WRITE_RULE: writeRule })));
    const mayWrite = FULL && !readOnlyWorkers.has(name);
    const mk = (nm: string, note: string) => {
      // Replacements reuse the original successful worktree but commit under their new seat name.
      if (writeWorkers.has(name)) writeWorkers.add(nm);
      return agent === "codex"
        ? runCodex(nm, buildText(nm) + OWNER_WORD + note, wcwd, model, mayWrite)
        : agent === "openrouter"
          ? runOpenRouter(nm, buildText(nm) + OWNER_WORD + note, wcwd, model, mayWrite)
          : runClaude(nm, buildText(nm) + OWNER_WORD + note, mayWrite ? WRITE_TOOLS : READ_TOOLS, wcwd, model);
    };
    launched.push({ name, room });
    runs.push(withRespawn(name, room, agent === "claude" ? model : undefined, mk).then((o) => ({ name, text: o.text, usage: o.usage })));
  }
}

/**
 * c.kill() reaches the seats themselves only. What a seat started in its own process group (a dev hub it detached, as
 * devHubRule tells write seats to start) survives that and outlives the run, so the launcher also stops whatever still
 * runs inside this run's own worktrees, with the lsof-cwd sweep pool-run uses (src/strays.ts; docs/reuse-survey-
 * 2026-09-23.md, "Process containment and the stray sweep"). Only .swarm-worktrees/<run>/ is swept, never the project
 * checkout: that also holds the user's shells and editors and anything else started there. Sweeps run one at a time.
 */
let sweeping: Promise<void> = Promise.resolve();
function sweepStrays(why: string): Promise<void> {
  const root = resolve(CWD, ".swarm-worktrees", SWARM_ID);
  if (!existsSync(root)) return sweeping;
  sweeping = sweeping
    .then(async () => {
      const n = await stopStrays(realpathSync(root)); // lsof reports real paths (/private/tmp, not /tmp)
      if (n) log(`${why}: stopped ${n} process(es) still running in this run's worktrees`);
    })
    .catch((e) => log(`${why}: stray sweep failed: ${e instanceof Error ? e.message : String(e)}`));
  return sweeping;
}
// stopping the launcher stops its seats: an orphaned seat keeps polling the provider with nobody to collect its result
/** Tell the hub why this run ended, in each of its rooms (run_end in the room log, one line in the room). Never fails the run:
 * a hub that does not know the route (an older build on this port) answers 404 and the run goes on. */
const postRunEnd = (cause: "concluded" | "timeout" | "operator_stop" | "seats_exited", detail?: string) =>
  Promise.all([...new Set([leadsRoom, ...groupRooms])].map((room) =>
    fetch(`${URL_}/rooms/${encodeURIComponent(room)}/run-end`, { method: "POST", headers: launcherHeaders(launcherToken), body: JSON.stringify({ cause, ...(detail ? { detail } : {}) }), signal: AbortSignal.timeout(2_000) })
      .then((r) => { if (!r.ok && r.status !== 404) log(`${room}: hub did not take the run end (${r.status})`); })
      .catch(() => {})));
for (const sig of ["SIGTERM", "SIGINT"] as const) process.on(sig, () => {
  STOPPING = true;
  log(`${sig}: stopping ${children.length} agent(s)`);
  void postRunEnd("operator_stop", `launcher received ${sig}`);
  for (const c of children) c.kill();
  const swept = sweepStrays(sig);
  setTimeout(() => void swept.finally(() => process.exit(130)), 3000).unref();
});
const tail = setInterval(() => tailRooms([...groupRooms, leadsRoom]), 2000);
// the hub is told when the seats will be killed, so it can say so in the room while there is still time to propose or
// hand off; a hub that refuses (an older build already on this port) or does not answer never fails the run
for (const room of [...groupRooms, leadsRoom]) {
  fetch(`${URL_}/rooms/${encodeURIComponent(room)}/deadline`, { method: "POST", headers: launcherHeaders(launcherToken), body: JSON.stringify({ at: new Date(Date.now() + TIMEOUT_MIN * 60_000).toISOString() }), signal: AbortSignal.timeout(5_000) })
    .then((r) => { if (!r.ok) log(`${room}: hub did not take the run deadline (${r.status})`); })
    .catch((e) => log(`${room}: could not post the run deadline: ${e instanceof Error ? e.message : String(e)}`));
  fetch(`${URL_}/rooms/${encodeURIComponent(room)}/carried`, { method: "POST", headers: launcherHeaders(launcherToken), body: JSON.stringify({ text: SETTLED, no_carry: NO_CARRY }), signal: AbortSignal.timeout(5_000) }).catch(() => {}); // what every seat was told was already read (inputs/owner-4)
}
/** Consolidation passes (--digest-every): started on a timer while group seats run, never two at once, and none in the
 * last five minutes, when a pass could not be acted on. Their usage is rolled into the run's with the seats'. */
const digestRuns: SeatRun[] = [];
const digestPasses: { pass: number; name: string; startedAt: string; finishedAt?: string; cost?: number | null }[] = [];
const digestPending: Promise<void>[] = [];
let digestPass = 0, digestRunning = false, groupsDone = false;
/** Group rooms that can still take a note: a concluded or closed room refuses post_to_room. A room the hub does not
 * answer for counts as open, so a slow hub never ends the passes. */
const openGroupRooms = async (): Promise<string[]> => (await Promise.all(groupRooms.map(async (room) => {
  try { return ["concluded", "closed"].includes(String(((await (await fetch(`${URL_}/rooms/${encodeURIComponent(room)}`, { signal: AbortSignal.timeout(3_000) })).json()) as { state?: string }).state)) ? "" : room; } catch { return room; }
}))).filter(Boolean);
const digestTimer: ReturnType<typeof setInterval> | undefined = DIGEST_EVERY_MIN ? setInterval(async () => {
  if (STOPPING || groupsDone || Date.now() > RUN_STARTED + TIMEOUT_MIN * 60_000 - Math.min(5, TIMEOUT_MIN / 2) * 60_000) return;
  if (digestRunning) return log(`digest pass ${digestPass} is still running; the next one waits for it`);
  // a pass with fewer than two groups left to carry findings between is a seat spent on nothing
  digestRunning = true;
  const open = await openGroupRooms();
  digestRunning = false;
  if (open.length < 2) {
    log(`no further digest pass: ${groupRooms.length - open.length} of ${groupRooms.length} group rooms have concluded`);
    return clearInterval(digestTimer);
  }
  const n = ++digestPass, name = `digest-${n}`;
  digestRunning = true;
  const record: (typeof digestPasses)[number] = { pass: n, name, startedAt: new Date().toISOString() };
  digestPasses.push(record);
  log(`digest pass ${n}: started ${name}`);
  const text = prompt("consolidator.md", {
    NAME: name, AGENT: "claude", PASS: n, PREVIOUS: n - 1, TASK: task, LEADS_ROOM: leadsRoom, URL: URL_, GROUPS_N: plan.groups.length, EVERY: DIGEST_EVERY_MIN,
    GROUP_LIST: plan.groups.map((g) => `- room \`${SWARM_ID}-${g.id}\` (${g.title}), read it at ${URL_}/rooms/${SWARM_ID}-${g.id} and ${URL_}/rooms/${SWARM_ID}-${g.id}/messages?since=<seq>. Its brief: ${g.directive}`).join("\n"),
  });
  digestPending.push(runClaude(name, text, READ_TOOLS, CWD, VERIFIER_MODEL).then((o) => {
    digestRuns.push({ name, text: o.text, usage: o.usage });
    // a pass the timeout killed has no finish time and an unknown cost
    if (!killedAtTimeout.has(name)) Object.assign(record, { finishedAt: new Date().toISOString(), cost: o.usage?.cost ?? null });
    digestRunning = false;
    log(`digest pass ${n}: ${name} finished`);
  }));
}, DIGEST_EVERY_MIN * 60_000) : undefined;
let timedOut = false;
/**
 * A seat the hub never saw is working alone (bugs.md 2: the hub refused every connection, the room was created anyway
 * and five seats overwrote each other). JOIN_CHECK_MS after launch the launcher compares the seats it started with the
 * rooms' participants and says who is missing, here and in the run's collectionErrors. When none arrived it looks once
 * more a minute later and then stops the run: nobody is coordinating, and write seats share a repository.
 */
const JOIN_CHECK_MS = Number(process.env.CHATROOM_JOIN_CHECK_MS ?? 180_000);
const joinNotes: string[] = [];
let joinChecked = false;
/** first: on the timer; second: a minute after a first look that found nobody; final: as the run ends, if no check finished (seats that cannot connect exit within seconds). */
async function joinCheck(when: "first" | "second" | "final" = "first"): Promise<void> {
  if (joinChecked || (when !== "final" && (STOPPING || groupsDone))) return;
  const c = await checkJoined(launched, roomNames(URL_));
  const afterS = Math.round((Date.now() - RUN_STARTED) / 1000);
  if (c.none && when === "first") { log(`no seat has joined after ${afterS} s; checking once more in 60 s`); setTimeout(() => void joinCheck("second"), 60_000).unref(); return; }
  if (joinChecked) return;
  joinChecked = true;
  const lines = joinLines(c, afterS);
  for (const line of lines) { log(line); joinNotes.push(line); }
  if (!lines.length) log(`join check: all ${launched.length} seats reached their rooms (${afterS} s)`);
  if (c.none && when === "second") {
    log("stopping the run: no seat is in a room");
    STOPPING = true;
    for (const ch of children) ch.kill();
    void sweepStrays("no seat joined");
  }
}
const joinTimer = JOIN_CHECK_MS > 0 ? setTimeout(() => void joinCheck().catch(() => {}), JOIN_CHECK_MS) : undefined;
joinTimer?.unref();
/** The lead room just before the timeout kills its seats: afterwards every seat has left and blockers read as such. */
let leadAtTimeout: Record<string, any> | null = null;
const timeout = setTimeout(async () => {
  log(`timeout after ${TIMEOUT_MIN} min; stopping agents`);
  timedOut = true;
  try { leadAtTimeout = await (await fetch(`${URL_}/rooms/${encodeURIComponent(leadsRoom)}`, { signal: AbortSignal.timeout(3_000) })).json() as Record<string, any>; } catch {}
  for (const [name, c] of seatChildren) if (c.exitCode === null && c.signalCode === null) killedAtTimeout.add(name);
  for (const c of children) c.kill();
  void sweepStrays("timeout");
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
    usage: rollupUsage(done), ...(PF.result ? { preflight: PF.result } : {}),
  });
};
const completedRuns: SeatRun[] = [];
const results = await Promise.all(runs.map(async (p) => { const r = await p; completedRuns.push(r); persistIncremental(completedRuns); return r; }));
if (JOIN_CHECK_MS > 0) await joinCheck("final").catch((e) => log(`join check failed: ${e instanceof Error ? e.message : String(e)}`));
groupsDone = true;
if (digestTimer) clearInterval(digestTimer);
await Promise.all(digestPending); // a pass in flight ends with its own seat (or the timeout's kill)
clearTimeout(timeout);
// every seat has exited; a dev hub one of them left behind has not
await sweepStrays("end of run");
clearInterval(tail);
await tailRooms([...groupRooms, leadsRoom]);

// ---------- report ----------
const collectionErrors: string[] = [...joinNotes];
const fetchText = async (url: string) => {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);
  return response.text();
};
// Fetch full GET payload for every room, including dynamically created break-outs, by name and by parent link (src/launch/run-rooms.ts).
try {
  groupRooms.push(...runRooms(JSON.parse(await fetchText(`${URL_}/rooms`)), SWARM_ID, [leadsRoom, ...groupRooms], log));
} catch (e) { collectionErrors.push(`Room discovery: ${String(e)}`); }
const snapshots: RoomSnapshot[] = [];
for (const name of new Set([leadsRoom, ...groupRooms])) {
  const snapshot = await collectRoomSnapshot(URL_, name);
  if (snapshot.error) collectionErrors.push(`${name} payload: ${snapshot.error}`);
  if (snapshot.transcript.error) collectionErrors.push(`${name} transcript: ${snapshot.transcript.error}`);
  snapshots.push(snapshot);
}
const leads = snapshots.find(r => r.name === leadsRoom)?.payload ?? { state: "missing", conclusion: null };
// why the run ended, as this launcher saw it; after the snapshots, so the line it adds is not in this run's own transcript
await postRunEnd(timedOut ? "timeout" : (leads as { state?: string }).state === "concluded" ? "concluded" : "seats_exited", timedOut ? `after ${TIMEOUT_MIN} min` : undefined);
// headline numbers by code, from the hub's own log; a hub without one (in memory) answers 404 and the report omits them
let metrics: RunResult["metrics"];
try { metrics = JSON.parse(await fetchText(`${URL_}/rooms/${encodeURIComponent(leadsRoom)}/metrics`)); } catch (e) { collectionErrors.push(`${leadsRoom} metrics: ${String(e)}`); }
const artifactPath = resolve(flag("result-path", resolve(OUT, "result.json"))!);
const artifact: RunResult = {
  schemaVersion: 1,
  run: { id: SWARM_ID, startedAt: new Date(RUN_STARTED).toISOString(), completedAt: new Date().toISOString(), task, doneWhen: plan.done_when },
  project: PROJECT_IDENTITY,
  leadRoom: leadsRoom,
  rooms: snapshots,
  verifier: { name: "verifier", output: results.find(r => r.name === "verifier")?.text ?? null },
  reportPath: resolve(OUT, "report.md"), artifactPath, collectionErrors, usage: rollupUsage([...results, ...replacedRuns, ...digestRuns]),
  outcome: classifyOutcome(snapshots.find(r => r.name === leadsRoom)?.payload, { timedOut, atTimeout: leadAtTimeout }),
  hubUsage: hubUsageRollup(snapshots),
  scorecard: seatScorecard(snapshots, Object.fromEntries([...exitCodes].map(([name, exitCode]) => [name, { exitCode, cost: seatCosts.get(name), killedAtTimeout: killedAtTimeout.has(name), commits: branchCommits(name), ...(seatTranscripts.has(name) ? { transcript: seatTranscripts.get(name) } : {}) }]))),
  ...(metrics ? { metrics } : {}), ...(PF.result ? { preflight: PF.result } : {}), ...(SIZING ? { sizing: SIZING } : {}), prompts: promptDigests(resolve(repoRoot, "prompts"), ["verifier.md", FLAT ? FLAT_PROMPT : GROUPS ? "group.md" : "worker.md", "recruit.md", ...(FLAT ? [] : ["lead-tail.md"]), ...(OWNER_WORD_ON ? ["owner-word.md"] : [])]),
};
if (digestPasses.length) {
  const board = (room: string) => snapshots.find((r) => r.name === room)?.payload?.board as Record<string, { text?: string; updated_at?: string }> | undefined;
  artifact.digests = digestRecords(digestPasses, board(leadsRoom));
  artifact.digestAcks = digestAcks(leadsRoom, Object.fromEntries(plan.groups.map((g) => [`${SWARM_ID}-${g.id}`, board(`${SWARM_ID}-${g.id}`)])));
}
// the decision record is filed where the next run's settledAxes() can find it once a human promotes it: one proposed decision
// per Target, from the newest place the verifier wrote it, not only the CLI's last turn (RSI-4; src/launch/decision-record.ts)
artifact.decisionRecord = fileRunDecisionRecord({ finalText: results.find((r) => r.name === "verifier")?.text,
  transcripts: [...seatTranscripts].filter(([n]) => isVerifierSeat(n)).map(([, path]) => path), roomTranscript: snapshots.find((r) => r.name === leadsRoom)?.transcript.text },
  { runId: SWARM_ID, state: String(leads.state), outDir: OUT, dir: proposedDecisionDir(PROJECT_IDENTITY, OUT, existsSync(resolve(CWD, "docs", "decisions"))) });
log(decisionRecordLine(artifact.decisionRecord));
writeRunResult(resolve(OUT, "result.json"), artifact);
if (artifactPath !== resolve(OUT, "result.json")) writeRunResult(artifactPath, artifact);
writeFileSync(artifact.reportPath, renderRunReport(artifact));

console.log("\n==================== FINAL ANSWER ====================");
console.log(leads.conclusion?.text ?? "NO CONSENSUS");
console.log("\n==================== VERIFIER ====================");
console.log(results.find((r) => r.name === "verifier")?.text ?? "(none)");
if (FULL && isGitRepo) console.log(`worker branches: git -C "${CWD}" branch --list "swarm/${SWARM_ID}/*"   (worktrees under .swarm-worktrees/${SWARM_ID}/)`);
console.log(`\nreport: ${resolve(OUT, "report.md")}`);
process.exit(leads.conclusion ? 0 : 1);
