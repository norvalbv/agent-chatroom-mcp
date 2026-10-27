/**
 * One place that builds the argv for every `codex exec` seat (src/swarm.ts runCodex and the spawner's codex recruits),
 * and the parser for the usage `codex exec --json` reports. Source: docs/reuse-survey-2026-09-23.md, "Codex seats:
 * prompt, usage and sandbox" (ADOPT OpenAI Codex CLI's own `codex exec` features, Apache-2.0), checked against the
 * local `codex exec --help` (codex-cli 0.155.0-alpha.16.3).
 */
import { StringDecoder } from "node:string_decoder";
import { spawnSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import { repoRoot } from "./env.js";

export function codexConfigArgs(mcpUrl: string): string[] {
  return ["-c", `mcp_servers.chatroom.url=${JSON.stringify(mcpUrl)}`, "-c", "mcp_servers.chatroom.tool_timeout_sec=120", "-c", 'mcp_servers.chatroom.default_tools_approval_mode="approve"'];
}

export function codexSeatCommand(options: CodexArgsOptions & { usageSidecar?: string }): { cmd: string; args: string[] } {
  const built = resolve(repoRoot, "dist/codex/cli.js");
  return { cmd: process.execPath, args: [...(existsSync(built) ? [built] : ["--import", import.meta.resolve("tsx"), resolve(repoRoot, "src/codex/cli.ts")]), ...codexArgs(options), ...(options.usageSidecar ? ["--usage-sidecar", options.usageSidecar] : [])] };
}

export interface CodexArgsOptions {
  /** the seat's working root (-C) */
  cwd: string;
  /** the chatroom MCP URL carrying this seat's heartbeat key */
  mcpUrl: string;
  model?: string;
  /** a seat that may not modify files: `-s read-only`; otherwise `-s workspace-write` scoped by codexGitWriteRoots */
  readOnly: boolean;
  /** -o: codex writes the seat's final message here (the launcher's <name>.out) */
  outFile?: string;
  /** --json: events as JSONL on stdout, which is where turn.completed usage comes from */
  json?: boolean;
}

/**
 * The prompt is NOT in the returned argv: the trailing `-` makes codex read it from stdin ("If not provided as an
 * argument (or if `-` is used), instructions are read from stdin", `codex exec --help`), and the caller writes it
 * there. argv is visible to every process on the host and `pkill -f <word>` matches it: in pool run room15-rep2
 * (2026-09-23) one seat's `pkill -f "offline-runner"` matched the brief in 14 of 15 seats' argv (src/claude-args.ts).
 *
 * Sandbox: ~/.codex/config.toml on this machine sets sandbox_mode = "danger-full-access" with approval_policy =
 * "never", so a seat that passes no -s runs unsandboxed. A read-only seat gets `-s read-only`. A write seat gets
 * `-s workspace-write` (its cwd, $TMPDIR and /tmp) plus the git paths codexGitWriteRoots names, so it can still commit
 * on its swarm/<run>/<seat> branch, which the verifier, --apply and pool-run all read: workspace-write alone keeps every
 * .git under a writable root read-only (codex-rs default_read_only_subpaths_for_writable_root), and the shared .git
 * as a root is carved out the same way, so the roots are its subdirectories. Probed with codex-cli 0.164.0's
 * `codex sandbox` (scripts/codex-write-scope.test.ts). Before this a write seat inherited danger-full-access and could
 * write anywhere the user can; CHATROOM_CODEX_WRITE_SANDBOX=inherit restores that.
 *
 * Under -s read-only codex asks for approval before every MCP tool call, and with approval_policy = "never" it
 * refuses them: a live gpt-6-astra seat's join_room failed with "MCP tool call requires approval, but approval policy
 * is never" and never reached the room, while the same list_rooms call without -s succeeded. So every seat approves
 * the chatroom server's tools up front (mcp_servers.<name>.default_tools_approval_mode, one of auto | prompt | writes |
 * approve in codex 0.155; probed live: with it, list_rooms succeeds and `touch` in the seat's cwd is still refused).
 * Only the chatroom server is approved; other MCP servers in the user's config stay behind the sandbox's approval.
 */
export function codexArgs({ cwd, mcpUrl, model, readOnly, outFile, json }: CodexArgsOptions): string[] {
  const args = ["exec", "--skip-git-repo-check", "-C", cwd, ...codexConfigArgs(mcpUrl)];
  const mode = codexSandboxMode(readOnly);
  if (mode === "read-only") args.push("-s", "read-only");
  if (mode === "workspace-write") args.push("-s", "workspace-write", ...codexWriteScopeArgs(codexGitWriteRoots(cwd)));
  if (json) args.push("--json");
  if (outFile) args.push("-o", outFile);
  if (model) args.push("-m", model);
  args.push("-");
  return args;
}

/** The sandbox a seat runs: "inherited" is whatever ~/.codex/config.toml says (CHATROOM_CODEX_WRITE_SANDBOX=inherit). */
export function codexSandboxMode(readOnly: boolean): "read-only" | "workspace-write" | "inherited" {
  if (readOnly) return "read-only";
  return process.env.CHATROOM_CODEX_WRITE_SANDBOX === "inherit" ? "inherited" : "workspace-write";
}

/**
 * What a commit on a linked worktree's branch writes outside the worktree: its own gitdir (index, HEAD) and the shared
 * objects, refs and logs. Never the shared config or hooks. [] outside git, and for a plain checkout, whose .git codex
 * keeps read-only whatever the roots; both launchers give a write seat its own linked worktree.
 */
export function codexGitWriteRoots(cwd: string): string[] {
  const r = spawnSync("git", ["-C", cwd, "rev-parse", "--path-format=absolute", "--git-dir", "--git-common-dir"], { encoding: "utf8" });
  if (r.status !== 0) return [];
  const [gitDir, common] = r.stdout.trim().split("\n").map((p) => { try { return realpathSync(p); } catch { return p; } });
  if (!gitDir || !common || gitDir === common) return [];
  return [gitDir, join(common, "objects"), join(common, "refs"), join(common, "logs")];
}

/** -c overrides for workspace-write: extra roots, and the network (a seat's smoke starts a hub on localhost). */
export function codexWriteScopeArgs(roots: string[]): string[] {
  return ["-c", `sandbox_workspace_write.writable_roots=${JSON.stringify(roots)}`, "-c", "sandbox_workspace_write.network_access=true"];
}

/** turn.completed's usage object as codex 0.155 emits it. */
export interface CodexTurnUsage {
  input_tokens: number;
  cached_input_tokens?: number;
  cache_write_input_tokens?: number;
  output_tokens: number;
  reasoning_output_tokens?: number;
}

/**
 * What runCodex writes to <name>.usage.json, in the sidecar's field names (steps, prompt_tokens, completion_tokens,
 * cost). codex reports no USD figure, so `cost` is null: unknown, never 0 (src/result.ts rollupUsage). readSeatUsage
 * in src/swarm.ts accepts only a numeric cost, so a codex seat still counts as unknown in the run's rollup until a
 * price row exists (todo/price-table-from-litellm.md); the tokens are here for that.
 */
export interface CodexUsageSidecar {
  /** turns completed; codex exec reports usage per turn, never per model request, and one exec run is one turn */
  steps: number;
  /** input_tokens, cached input included (19390 input with 12160 cached in the recorded fixture) */
  prompt_tokens: number;
  completion_tokens: number;
  cost: null;
  codex_usage: CodexTurnUsage;
}

const NUMERIC = ["input_tokens", "cached_input_tokens", "cache_write_input_tokens", "output_tokens", "reasoning_output_tokens"] as const;

/** The usage on a turn.completed JSONL line; null for any other line. */
export function turnCompletedUsage(line: string): CodexTurnUsage | null {
  let e: { type?: unknown; usage?: Record<string, unknown> };
  try { e = JSON.parse(line); } catch { return null; }
  const u = e?.type === "turn.completed" ? e.usage : undefined;
  if (!u || typeof u.input_tokens !== "number" || typeof u.output_tokens !== "number") return null;
  const out: Record<string, number> = {};
  for (const k of NUMERIC) if (typeof u[k] === "number") out[k] = u[k] as number;
  return out as unknown as CodexTurnUsage;
}

/**
 * Feed it codex's stdout as it arrives; it calls onUsage after every turn.completed with the seat's usage so far.
 * turn.completed carries the thread's running total, not the turn's own usage: a real two-turn gpt-6-astra thread
 * (exec, then exec resume) reported output_tokens 6 and then 12 for two one-word replies, and codex-rs
 * exec/src/event_processor_with_jsonl_output.rs fills it from ThreadTokenUsage.total (the survey's skeptic check).
 * So the last event is the total and turns are never summed.
 */
export function codexUsageTracker(onUsage: (usage: CodexUsageSidecar) => void): (chunk: Buffer | string) => void {
  const decoder = new StringDecoder("utf8");
  let partial = "";
  let turns = 0;
  return (chunk) => {
    partial += typeof chunk === "string" ? chunk : decoder.write(chunk);
    let nl: number;
    while ((nl = partial.indexOf("\n")) >= 0) {
      const usage = turnCompletedUsage(partial.slice(0, nl).trim());
      partial = partial.slice(nl + 1);
      if (usage) onUsage({ steps: ++turns, prompt_tokens: usage.input_tokens, completion_tokens: usage.output_tokens, cost: null, codex_usage: usage });
    }
  };
}
