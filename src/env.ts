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

/** Minimize human-control credentials in seats; this is not a same-user filesystem sandbox. */
export const SEAT_ENV_EXCLUSIONS: readonly string[] = Object.freeze([
  "CHATROOM_HUMAN_TOKEN",
  "CHATROOM_LAUNCHER_TOKEN",
  "CHATROOM_INSECURE_LOCAL",
  // scripts/guard-baseline-freeze.mjs: bypasses the .devkit/baselines/** self-freeze guard. Maintainer-only.
  "CHATROOM_BASELINE_FREEZE_OVERRIDE",
]);

/** Per-seat commit attribution without changing shared repository or global git config. */
export function seatGitIdentity(name: string): NodeJS.ProcessEnv {
  return {
    GIT_AUTHOR_NAME: name,
    GIT_AUTHOR_EMAIL: `${name}@swarm.local`,
    GIT_COMMITTER_NAME: name,
    GIT_COMMITTER_EMAIL: `${name}@swarm.local`,
  };
}

/** Clone rather than mutate the launcher/hub's environment: controller auth must keep working. */
export function seatChildEnv(env: NodeJS.ProcessEnv = process.env, name?: string): NodeJS.ProcessEnv {
  const childEnv: NodeJS.ProcessEnv = { ...env, MCP_TOOL_TIMEOUT: "120000" };
  for (const key of SEAT_ENV_EXCLUSIONS) delete childEnv[key];
  if (name !== undefined) Object.assign(childEnv, seatGitIdentity(name));
  return childEnv;
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

export interface DotEnvOptions {
  /** Keys that must not be reintroduced from .env (e.g. human-control credentials in seats). */
  exclude?: readonly string[];
  /** Skip any .env line whose key matches (e.g. provider credentials for a hub that must never hold one). */
  excludePattern?: RegExp;
  /** Injectable target for synthetic tests; controller callers retain process.env by default. */
  env?: NodeJS.ProcessEnv;
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

export interface SeatBeat { key: string; mcpUrl: string; env: NodeJS.ProcessEnv }

export function seatBeat(mcpUrl: string, key: string): SeatBeat {
  const u = new URL(mcpUrl);
  u.searchParams.set("seat", key);
  return { key, mcpUrl: u.toString(), env: { CHATROOM_SEAT_KEY: key, CHATROOM_HEARTBEAT_URL: new URL("/heartbeat", u).toString() } };
}

/** --settings JSON for a claude -p seat: a PreToolUse hook, so a long Bash shows as the seat's current step while it runs. */
export function heartbeatHookSettings(hook = HEARTBEAT_HOOK): string {
  return JSON.stringify({ hooks: { PreToolUse: [{ matcher: "*", hooks: [{ type: "command", command: `node ${JSON.stringify(hook)}`, timeout: 5 }] }] } });
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
