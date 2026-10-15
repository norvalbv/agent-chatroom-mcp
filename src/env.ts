/**
 * A gitignored `.env` in the repo root fills in variables the process was not started with, so the hub,
 * the launcher and a seat all find OPENROUTER_API_KEY however they were launched. A hub started by hand
 * without the key otherwise refuses every `request_agent` for an OpenRouter recruit, and the only way
 * an agent can fix that mid-run is to paste a key into the room, which persists it in the transcript.
 * Exported variables win; nothing here overrides them.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Minimize human-control credentials in seats; this is not a same-user filesystem sandbox.
 * A seat also does not learn where its hub lives. It reaches the hub by its MCP URL, and with the hub's PORT in its
 * shell every script that defaults to process.env.PORT drives the live hub: in swarm-000525-jcz8-room a recruit's bare
 * `npx tsx scripts/seat-exit-regression.ts` created a room on the hub it was talking through, which then launched a
 * real agent in the operator's checkout. The recruit pin and the caps stay: a private hub a seat starts keeps them.
 */
export const SEAT_ENV_EXCLUSIONS: readonly string[] = Object.freeze([
  "CHATROOM_HUMAN_TOKEN",
  "CHATROOM_LAUNCHER_TOKEN",
  "CHATROOM_INSECURE_LOCAL",
  // scripts/guard-baseline-freeze.mjs: bypasses the .devkit/baselines/** self-freeze guard. Maintainer-only.
  "CHATROOM_BASELINE_FREEZE_OVERRIDE",
  "PORT",
  "CHATROOM_DATA_DIR",
  "CHATROOM_LOG_DIR",
  "CHATROOM_DEFAULT_CWD",
]);

/**
 * Keys that spend money outside the operator's subscription. Only a seat that runs on that provider gets one: the hub
 * and the launcher load OPENROUTER_API_KEY from .env for OpenRouter seats, and every Claude and Codex seat inherited it
 * too (swarm-123021-1nwp: seats on a benchmark spent 16 dollars of credit nobody approved). An empty value exported by
 * the launcher covers the seats it starts, never the recruits of a hub that read .env itself.
 */
export const SEAT_PAID_KEYS: readonly string[] = Object.freeze(["OPENROUTER_API_KEY"]);

/**
 * CHATROOM_* is the parent hub's configuration, and a seat that starts a private hub (smoke, a dev room) hands it on:
 * a recruit of a hub started with CHATROOM_FRESH_CHALLENGER=1 ran smoke under the challenger and failed at smoke.ts:135.
 * So a seat gets an allowlist, not a denylist: every other CHATROOM_* key, including mechanisms added later, is dropped.
 * Kept: the seat's own wiring (seat key, heartbeat, MCP URL) and the guards that keep a seat's private hub inside the
 * room's rules (recruit model pin, caps, no-recruit, lean/sandbox mode).
 */
const SEAT_ENV_KEEP: readonly RegExp[] = [
  /^CHATROOM_(SEAT_KEY|HEARTBEAT_URL|MCP_URL|NO_RECRUIT|RECRUIT_AGENT|RECRUIT_MODEL|CLAUDE_FULL|SANDBOX)$/,
  /^CHATROOM_MAX_/,
];

/** Per-seat commit attribution without changing shared repository or global git config. */
export function seatGitIdentity(name: string): NodeJS.ProcessEnv {
  return {
    GIT_AUTHOR_NAME: name,
    GIT_AUTHOR_EMAIL: `${name}@swarm.local`,
    GIT_COMMITTER_NAME: name,
    GIT_COMMITTER_EMAIL: `${name}@swarm.local`,
  };
}

/** The smallest window at which a reading-heavy dev room ran through a compaction and concluded (swarm-010140-vgxm, 2 of 2 seats). */
export const COMPACT_WINDOW_TESTED = 200_000;
/**
 * --compact-at <tokens> / CHATROOM_SEAT_COMPACT_WINDOW: the transcript size at which a Claude seat compacts. A seat
 * re-reads its whole transcript on every request, and unset, Claude Code compacts only near the model's limit: in
 * swarm-094251-5y46 six seats sat at 0.45-0.9M tokens for five hours and cache read was 65% of the run's $296.
 * Claude Code takes a plain integer from 100000 to 1000000 and reads "200k" as 200, clamped to its minimum, so
 * anything else is refused here (null) instead of compacting at a size nobody asked for.
 */
export function compactWindow(raw: string | undefined): number | null {
  if (raw === undefined || !/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  return n >= 100_000 && n <= 1_000_000 ? n : null;
}

/**
 * The window a seat compacts at when nobody set one (evidence/compaction-replay, swarm-092526-89rn): in swarm-180216-182a
 * seats on the 1M window re-read a mean 456k tokens per request and compacted 5 times, at ~962k; mrw4's 24 seats
 * compacted 87 times at ~268k without thrashing. Replaying 182a's transcripts at 300k puts cache read at 0.33x actual.
 * "--compact-at 1000000" restores the full window; "off" or CHATROOM_CLAUDE_FULL=1 leaves Claude Code's own default.
 */
export const SEAT_COMPACT_DEFAULT = 300_000;

/** The CLAUDE_CODE_AUTO_COMPACT_WINDOW a seat gets from this environment, or null for Claude Code's own default. The
 * default goes to Claude seats only (`claude`): codex and OpenRouter seats never read it, so their env stays as it was. */
export function seatCompactWindow(env: NodeJS.ProcessEnv, claude = true): number | null {
  const set = compactWindow(env.CHATROOM_SEAT_COMPACT_WINDOW);
  if (set !== null) return set;
  if (!claude || env.CHATROOM_SEAT_COMPACT_WINDOW === "off" || env.CHATROOM_CLAUDE_FULL === "1" || env.CLAUDE_CODE_AUTO_COMPACT_WINDOW) return null;
  return SEAT_COMPACT_DEFAULT;
}

/** Clone rather than mutate the launcher/hub's environment: controller auth must keep working. `claude`: the child is a
 * `claude` seat, which gets SEAT_COMPACT_DEFAULT when no window was set. */
export function seatChildEnv(env: NodeJS.ProcessEnv = process.env, name?: string, paid = false, claude = false): NodeJS.ProcessEnv {
  const childEnv: NodeJS.ProcessEnv = { ...env, MCP_TOOL_TIMEOUT: "120000" };
  const window = seatCompactWindow(env, claude);
  if (window !== null) childEnv.CLAUDE_CODE_AUTO_COMPACT_WINDOW = String(window);
  for (const key of Object.keys(childEnv)) if (key.startsWith("CHATROOM_") && !SEAT_ENV_KEEP.some((re) => re.test(key))) delete childEnv[key];
  for (const key of SEAT_ENV_EXCLUSIONS) delete childEnv[key];
  if (!paid) for (const key of SEAT_PAID_KEYS) delete childEnv[key];
  if (name !== undefined) Object.assign(childEnv, seatGitIdentity(name));
  if (env.CHATROOM_SEAT_AI_GATES !== "on") for (const key of SEAT_AI_GATES_OFF) childEnv[key] ??= "1";
  return childEnv;
}

/**
 * Seat commits run a repository's deterministic gates but not its AI reviewer gates (owner ruling, #985: "the whole
 * point is to peer review. you *can* use deterministc gates, but bypass ai"). Since c3d2d088 seat worktrees carry
 * the hooks, and devkit's pre-commit runs an LLM reviewer fleet, a completeness judge, a decisions LLM and a qavis
 * vision route on every commit (evidence/seat-hooks-cost-and-bypass). These are devkit's own documented off
 * switches (gate-engine/config.mts reads GUARD_ or FRINK_), and devkit records each as a gate bypass. A value the
 * operator exported is kept; CHATROOM_SEAT_AI_GATES=on (the launcher's --seat-ai-gates on) sets none of them.
 */
export const SEAT_AI_GATES_OFF: readonly string[] = Object.freeze(["GUARD_DECISION_NO_LLM", "GUARD_NO_REVIEW", "GUARD_NO_COMPLETENESS", "GUARD_NO_QAVIS_ADVISORY", "GUARD_NO_SENTRY_JUDGE"]);

/** One line for a launcher or recruit log: which AI gate switches a seat's commits carry. */
export function aiGatesLine(seatEnv: NodeJS.ProcessEnv): string {
  const off = SEAT_AI_GATES_OFF.filter((k) => seatEnv[k] && seatEnv[k] !== "0");
  return off.length ? `AI reviewer gates off for seat commits (${off.join(", ")}); deterministic gates still run` : "AI reviewer gates ON for seat commits (--seat-ai-gates on)";
}

/**
 * --no-carry: a seat starts from the brief alone. The launcher drops the settled decision axes and the PRIOR RUNS
 * list it normally puts in front of every prompt, and this turns off Claude Code's auto-memory, which otherwise
 * loads the operator's per-project MEMORY.md into every seat (swarm-092653-202z: 12886 vs 7378 first-turn prompt
 * tokens). Used to test whether shared carried-forward context is what makes same-model seats open alike.
 */
export function carrySettings(noCarry: boolean, base: string): string {
  return noCarry ? JSON.stringify({ ...(base ? JSON.parse(base) : {}), autoMemoryEnabled: false }) : base;
}

/**
 * When the project a seat may edit is this hub, the seat can run its build as a private hub and put agents on
 * it. In swarm-083203-kooz every hub change was verified by a command exiting 0, so mechanics shipped that no
 * agent had used (a seat's friction note: executable challenges were "shipped but unexercised live"), and only
 * one of 15 seats ever started its own hub. The launcher's --port already starts a hub from the calling
 * checkout's dist and data dir; CHATROOM_INSECURE_LOCAL is stripped from seats (SEAT_ENV_EXCLUSIONS), and
 * without it that private hub refuses the launcher's room create (403) and the room runs on default policy.
 */
export function devHubRule(cwd: string, sandboxed = false): string {
  // A protocol-fixed run (a benchmark hub, CHATROOM_NO_RECRUIT=1) has exactly its stated seats: no private dev rooms either.
  if (process.env.CHATROOM_NO_RECRUIT === "1") return "";
  try {
    if (JSON.parse(readFileSync(resolve(cwd, "package.json"), "utf8")).name !== "agent-chatroom-mcp") return "";
  } catch {
    return "";
  }
  // --sandbox (src/sandbox.ts): each Bash command is its own sandbox, so a hub started in one command cannot be stopped
  // from a later one (probed: EPERM), and agents cannot be launched from inside it (a nested claude -p is denied
  // api.anthropic.com, and macOS sandboxes do not nest). The same-command form below is the one that works.
  if (sandboxed)
    return (
      " This project is the hub you are talking through, so run your change, not only its tests. Your commands run in an OS sandbox: each command is its own sandbox, so a process you start in one command cannot be stopped from a later one, and agents cannot be launched from inside it. " +
      "Start a private hub from your build and stop it in the same command: `npm run build && (CHATROOM_INSECURE_LOCAL=1 CHATROOM_NO_RECRUIT=1 PORT=<free port> CHATROOM_DATA_DIR=./data node dist/index.js > hub.log 2>&1 & H=$!; sleep 2; <exercise it with curl>; kill $H)`. " +
      "If the change needs agents on a hub to be verified, say so in the room with the exact command; the launcher's operator runs that room outside the sandbox."
    );
  return (
    " This project is the hub you are talking through, so run your change, not only its tests: in your worktree run `npm run build`, then in the background " +
    '`CHATROOM_INSECURE_LOCAL=1 node dist/swarm.js "<what the agents should do>" --flat --agents 3 --models claude-opus-5-5 --verifier-model claude-opus-5-5 --timeout 10 --port <free port>`. ' +
    "That starts a private hub from your build and puts agents in a room on it; the room log lands in your worktree's data/ and the report in swarms/. " +
    "Stop that hub by PID when you are done (`lsof -ti :<port> -sTCP:LISTEN`), never by name. " +
    "Tests show the code does what you expected; a change to how agents work together is verified once you have watched agents use it on a hub like that, so name the dev room you watched when you ask for review. " +
    "Keep a dev room to 3 agents on claude-opus-5-5: this machine and its usage are shared."
  );
}

export interface DotEnvOptions {
  /** Keys that must not be reintroduced from .env (e.g. human-control credentials in seats). */
  exclude?: readonly string[];
  /** Skip any .env line whose key matches (e.g. provider credentials for a hub that must never hold one). */
  excludePattern?: RegExp;
  /** Injectable target for synthetic tests; controller callers retain process.env by default. */
  env?: NodeJS.ProcessEnv;
}

/** A hub that must hold no provider key: a bench hub with recruitment refused (CHATROOM_NO_RECRUIT=1) or one that
 * recruits only claude seats, which authenticate on their own (CHATROOM_STRIP_SECRETS=1, scripts/bench-hub-env.ts). */
export function hubDotEnvOptions(env: NodeJS.ProcessEnv = process.env): DotEnvOptions {
  return env.CHATROOM_NO_RECRUIT === "1" || env.CHATROOM_STRIP_SECRETS === "1" ? { excludePattern: /API_KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL/i } : {};
}

export function loadDotEnv(dir = repoRoot, options: DotEnvOptions = {}): string[] {
  const env = options.env ?? process.env;
  const excluded = new Set(options.exclude ?? []);
  const file = resolve(dir, ".env");
  if (!existsSync(file)) return [];
  const loaded: string[] = [];
  for (const raw of readFileSync(file, "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m || excluded.has(m[1]) || (options.excludePattern && options.excludePattern.test(m[1]))) continue;
    let value = m[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (env[m[1]] === undefined) {
      env[m[1]] = value;
      loaded.push(m[1]);
    }
  }
  return loaded;
}

/**
 * Seat heartbeat wiring (every seat type heartbeats without a room turn). The launcher gives each seat process a random
 * key: in its MCP URL (?seat=<key>, so the hub binds the key to that connection) and in its env, where the claude -p
 * tool hook (scripts/heartbeat-hook.mjs) reads it to POST <hub>/heartbeat on every local tool call.
 */
export const HEARTBEAT_HOOK = resolve(repoRoot, "scripts", "heartbeat-hook.mjs");
/**
 * Seats share one machine: a seat's Bash may not kill by command-line pattern, nor a PID another seat started
 * (scripts/seat-guard-hook.mjs; swarm-094251-5y46, where one seat's pkill killed another's script three times).
 * SEAT_PROCS is what the refusal offers instead: list or stop this seat's own processes, told apart by the
 * CHATROOM_SEAT_KEY they inherit. CHATROOM_SEAT_GUARD=0 on the launcher leaves the guard out.
 */
export const SEAT_GUARD_HOOK = resolve(repoRoot, "scripts", "seat-guard-hook.mjs");
export const SEAT_PROCS = resolve(repoRoot, "scripts", "seat-procs.mjs");

export interface SeatBeat { key: string; mcpUrl: string; env: NodeJS.ProcessEnv }

/** `worktree`: the directory the seat works in, so the hub can stamp its claim/* entries with branch and path. */
/**
 * Why a process that is itself a seat may not start a launcher on this port, or null. A seat's shell has no hub of
 * its own: with nothing named, the launcher falls back to 7717 (the operator's hub) and would put a room of agents
 * on it. A seat names a private port, and never the hub it is talking through.
 */
/** The launcher's default hub: the operator's own, never a seat's private one. */
const OPERATOR_PORT = 7717;
export function seatPortError(env: NodeJS.ProcessEnv, portFlag: string | undefined): string | null {
  if (!env.CHATROOM_SEAT_KEY) return null;
  const raw = portFlag || env.PORT;
  if (!raw) return "This shell belongs to a seat: pass --port <a free private port> so the run gets its own hub. With none, the launcher would use the operator's hub.";
  // compared as the number the launcher will use, so "07741" is 7741
  const port = Number(raw);
  let own = Number.NaN;
  try { own = Number(new URL(env.CHATROOM_HEARTBEAT_URL ?? "").port); } catch {}
  if (port === own) return `Port ${port} is the hub this seat is talking through; pass --port <a free private port>.`;
  if (port === OPERATOR_PORT) return `Port ${OPERATOR_PORT} is the operator's hub; a seat passes --port <a free private port>.`;
  return null;
}

/**
 * Env for a hub the launcher starts itself: it stops on its own after `idleMin` minutes with no request, so a dev room's
 * hub does not outlive the work (in swarm-000525-jcz8 every dev hub had to be found and killed by PID) but still answers
 * a reviewer who reads the room after the run. 0 means never. A hub the launcher finds already running gets nothing.
 */
/** How long the launcher waits for a hub it started to answer (CHATROOM_HUB_START_MS). 10 s was too short on a shared
 * machine at load average 150-200, where a hub took 12-20 s to start (swarm-180216-182a, friction/machine-load). */
export const HUB_START_MS = startMs(process.env.CHATROOM_HUB_START_MS);
/** A positive number of ms, else the 90 s default (CHATROOM_HUB_START_MS=abc used to give NaN: no wait at all; review/07b6b507). */
export function startMs(v: string | undefined): number {
  const n = Number(v);
  return v !== undefined && v.trim() !== "" && Number.isFinite(n) && n > 0 ? n : 90_000;
}

/** True once `url` answers within `ms`, polling every 200 ms; false if it never does, or as soon as `gone()` says the
 * process that should serve it has exited (a hub that dies at start is reported at once, not after the whole window). */
export async function waitForHub(url: string, ms = HUB_START_MS, gone: () => boolean = () => false): Promise<boolean> {
  const t0 = Date.now();
  while (Date.now() - t0 < ms && !gone()) {
    try { await fetch(url, { signal: AbortSignal.timeout(Math.max(200, Math.min(2000, ms - (Date.now() - t0)))) }); return true; } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

export function ownHubEnv(idleMin: number, port?: number): Record<string, string> {
  // 7717 is the operator's dashboard hub, which a launcher starts when none is running; it stays up
  return idleMin > 0 && port !== 7717 ? { CHATROOM_IDLE_EXIT_MIN: String(idleMin) } : {};
}

/**
 * Why a hub found already running on the port is not this run's build, or null. GET / reports the checkout and head
 * the hub started from; a hub left over from another seat's dev room, or from before this branch's last commit, would
 * run someone else's code under this run's name.
 */
export function reusedHubProblem(hubBuild: { root?: string; head?: string } | undefined, own: { root: string; head: string }): string | null {
  if (!hubBuild?.root || !hubBuild.head) return "the hub on this port does not report its build (it predates the build field), so this run cannot tell whose code it runs";
  if (hubBuild.root !== own.root) return `the hub on this port was built from ${hubBuild.root}, not this checkout (${own.root})`;
  if (hubBuild.head !== own.head) return `the hub on this port runs ${hubBuild.head}, not this checkout's ${own.head}; it was started before the last commit`;
  return null;
}

/**
 * Claude Code's own OTLP log export, pointed at the hub: one `claude_code.api_request` record per model call, with its
 * tokens and cost, every second (src/hub/usage.ts, board sources/claude-code-otel). Only the
 * logs signal and only the logs-specific variables, so an operator's own OTEL_EXPORTER_OTLP_ENDPOINT for metrics or
 * traces is left alone. A seat's other runtimes (codex, openrouter) ignore these. CHATROOM_SEAT_TELEMETRY=0 turns it off.
 */
function seatTelemetryEnv(mcpUrl: URL, key: string): NodeJS.ProcessEnv {
  if (process.env.CHATROOM_SEAT_TELEMETRY === "0") return {};
  return {
    CLAUDE_CODE_ENABLE_TELEMETRY: "1",
    OTEL_LOGS_EXPORTER: "otlp",
    OTEL_EXPORTER_OTLP_LOGS_PROTOCOL: "http/json",
    OTEL_EXPORTER_OTLP_LOGS_ENDPOINT: new URL("/otlp/v1/logs", mcpUrl).toString(),
    OTEL_EXPORTER_OTLP_LOGS_HEADERS: `x-chatroom-seat-key=${key}`,
    // a SIGKILLed seat loses whatever its exporter had not flushed: at 5000 ms a probe lost 3 of 8 calls, at 1000 ms
    // 0 of 5 (the exporter posts only when it has records: about one POST every 2-3 s from a busy seat)
    OTEL_LOGS_EXPORT_INTERVAL: "1000",
  };
}

/**
 * How long a launched Claude seat's connection holds an empty wait_for_messages (claim/empty-waits). A wait returned
 * empty after 55 s, a cap set for Codex's 60 s client timeout, and each empty return is a model request that re-reads
 * the seat's whole context: scripts/wait-cost.ts over the last 21 room logs gives 2,050 such requests, $163.62 of
 * $1,427.97 (12%; 22% in the grouped Polymarket run), $0.08 each. Four minutes, because in the same records a seat's
 * request 240-360 s after its last one still hit the prompt cache (1 miss in 45), so a longer hold does not trade polls
 * for a context rewrite. CHATROOM_SEAT_HOLD_MS sets it; 0 turns it off.
 */
export const MAX_SEAT_HOLD_MS = 240_000;
const MIN_SEAT_HOLD_MS = 55_000;
export function seatHoldMs(raw: string | undefined = process.env.CHATROOM_SEAT_HOLD_MS): number | undefined {
  if (raw?.trim() === "0") return undefined;
  const n = Number(raw);
  return Number.isFinite(n) && n >= MIN_SEAT_HOLD_MS ? Math.min(Math.round(n), MAX_SEAT_HOLD_MS) : MAX_SEAT_HOLD_MS;
}
/** The hub's reading of a connection's ?hold=<ms>: a number in range, or no hold. A client cannot make the hub hold longer than the cap. */
export function holdFromQuery(raw: unknown): number | undefined {
  const n = typeof raw === "string" && /^\d+$/.test(raw) ? Number(raw) : NaN;
  return n >= MIN_SEAT_HOLD_MS ? Math.min(n, MAX_SEAT_HOLD_MS) : undefined;
}

/** `holdMs`: only for a seat whose client tool timeout this launcher sets (a claude seat): the hub is told in the URL, and
 * the seat's MCP_TOOL_TIMEOUT is a minute longer, so a held wait never ends as a client-side tool timeout. */
export function seatBeat(mcpUrl: string, key: string, worktree?: string, holdMs?: number, topicHeld?: string): SeatBeat {
  const u = new URL(mcpUrl);
  u.searchParams.set("seat", key);
  if (worktree) u.searchParams.set("worktree", worktree);
  if (holdMs) u.searchParams.set("hold", String(holdMs));
  // the digest of a room topic this seat's brief already carries: that room's join_room ships only its opening
  if (topicHeld) u.searchParams.set("topic_held", topicHeld);
  // the seat's memory budget, when the hub enforces one (src/hub/memory.ts): its tools can size themselves to it
  const budget = Number(process.env.CHATROOM_SEAT_MEMORY_MB) > 0 ? { CHATROOM_SEAT_MEMORY_MB: String(Number(process.env.CHATROOM_SEAT_MEMORY_MB)) } : {};
  return { key, mcpUrl: u.toString(), env: { CHATROOM_SEAT_KEY: key, CHATROOM_HEARTBEAT_URL: new URL("/heartbeat", u).toString(), ...budget, ...seatTelemetryEnv(u, key), ...(holdMs ? { MCP_TOOL_TIMEOUT: String(holdMs + 60_000) } : {}) } };
}

/**
 * --settings JSON for a claude -p seat: a PreToolUse hook, so a long Bash shows as the seat's current step while it
 * runs, and the same hook on PostToolUse, so an @-mention that lands during that Bash is steered into the turn when it
 * ends (hook additionalContext reaches the model from both events; probed on claude 2.1.288). A second PreToolUse
 * hook, on Bash only, is the seat guard above.
 */
export function heartbeatHookSettings(hook = HEARTBEAT_HOOK, guard = SEAT_GUARD_HOOK): string {
  const entry = [{ matcher: "*", hooks: [{ type: "command", command: `node ${JSON.stringify(hook)}`, timeout: 5 }] }];
  const guarded = process.env.CHATROOM_SEAT_GUARD === "0" ? [] : [{ matcher: "Bash", hooks: [{ type: "command", command: `node ${JSON.stringify(guard)}`, timeout: 5 }] }];
  return JSON.stringify({ hooks: { PreToolUse: [...entry, ...guarded], PostToolUse: entry } });
}

/** A launcher's heartbeat from a seat's output (codex exec has no tool hooks): at most one per `everyMs`, with the last line as detail. */
export function outputHeartbeat(send: (detail: string) => void, everyMs = 10_000): (chunk: unknown) => void {
  let last = 0;
  return (chunk) => {
    const t = Date.now();
    if (t - last < everyMs) return;
    const line = String(chunk).split("\n").map((l) => l.trim()).filter(Boolean).at(-1);
    if (!line) return;
    last = t;
    send(line);
  };
}

// ---------- a supervised hub's files (src/hubd.ts writes them, src/swarm.ts reads them) ----------
type Env = Record<string, string | undefined>;

/** `<checkout>/logs` unless CHATROOM_HUBD_LOG_DIR says otherwise (tests; a hub whose checkout is read-only). */
export const hubLogDir = (root: string, env: Env = process.env) => resolve(env.CHATROOM_HUBD_LOG_DIR ?? resolve(root, "logs"));
export const hubLogFile = (root: string, port: number, env: Env = process.env) => resolve(hubLogDir(root, env), `hub-${port}.log`);
export const launcherTokenFile = (root: string, port: number, env: Env = process.env) => resolve(hubLogDir(root, env), `hub-${port}-token`);

/** The launcher token of the supervised hub on `port` started from checkout `root`; undefined when there is none. */
export function readLauncherToken(root: string, port: number, env: Env = process.env): string | undefined {
  try { return readFileSync(launcherTokenFile(root, port, env), "utf8").trim() || undefined; } catch { return undefined; }
}

/** Headers for the launcher's own calls to a hub (room create, run deadline, resources): its launcher token, which a hub
 * accepts on exactly those routes (a hubd hub has no human token), and the human token when the operator gave one. */
export function launcherHeaders(launcherToken: string | undefined, humanToken: string | undefined = process.env.CHATROOM_HUMAN_TOKEN): Record<string, string> {
  return { "content-type": "application/json", ...(launcherToken ? { "x-chatroom-launcher-token": launcherToken } : {}), ...(humanToken ? { "x-chatroom-token": humanToken } : {}) };
}

/** The line a launcher prints at launch when --respawn cannot work, or null. */
export function respawnTokenProblem(respawn: boolean, token: string | undefined, port: number): string | null {
  if (!respawn || token) return null;
  return `WARNING: --respawn WILL NOT WORK on :${port}: this launcher has no CHATROOM_LAUNCHER_TOKEN and the hub left no token file, so the hub will refuse every replacement seat. Start the hub with \`npm run hubd\` (it writes logs/hub-${port}-token), or set CHATROOM_LAUNCHER_TOKEN to the hub's token.`;
}
