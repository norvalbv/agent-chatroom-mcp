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
export const SEAT_ENV_EXCLUSIONS: readonly string[] = Object.freeze(["CHATROOM_HUMAN_TOKEN", "CHATROOM_LAUNCHER_TOKEN"]);

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

export interface DotEnvOptions {
  /** Keys that must not be reintroduced from .env (e.g. human-control credentials in seats). */
  exclude?: readonly string[];
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
    if (!m || excluded.has(m[1])) continue;
    let value = m[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (env[m[1]] === undefined) {
      env[m[1]] = value;
      loaded.push(m[1]);
    }
  }
  return loaded;
}
