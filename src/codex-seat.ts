/**
 * One place that builds the argv for every `codex exec` seat (src/swarm.ts runCodex and the spawner's codex recruits),
 * and the parser for the usage `codex exec --json` reports. Source: docs/reuse-survey-2026-09-23.md, "Codex seats:
 * prompt, usage and sandbox" (ADOPT OpenAI Codex CLI's own `codex exec` features, Apache-2.0), checked against the
 * local `codex exec --help` (codex-cli 0.155.0-alpha.16.3).
 */
import { StringDecoder } from "node:string_decoder";

export interface CodexArgsOptions {
  /** the seat's working root (-C) */
  cwd: string;
  /** the chatroom MCP URL carrying this seat's heartbeat key */
  mcpUrl: string;
  model?: string;
  /** a seat that may not modify files: `-s read-only` */
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
 * "never", so a seat that passes no -s runs unsandboxed. A read-only seat gets `-s read-only`. A write seat keeps
 * whatever the user's config says: `-s workspace-write` marks the gitdir behind a linked worktree's .git file
 * read-only (codex-rs protocol/src/permissions.rs, default_read_only_subpaths_for_writable_root, per the survey's
 * skeptic check), so a write seat could not commit on its swarm/<run>/<seat> branch, which the verifier, --apply and
 * pool-run all read. The survey's alternative for write seats, wrapping the whole seat process in srt, is not done here.
 */
export function codexArgs({ cwd, mcpUrl, model, readOnly, outFile, json }: CodexArgsOptions): string[] {
  const args = ["exec", "--skip-git-repo-check", "-C", cwd, "-c", `mcp_servers.chatroom.url="${mcpUrl}"`, "-c", "mcp_servers.chatroom.tool_timeout_sec=120"];
  if (readOnly) args.push("-s", "read-only");
  if (json) args.push("--json");
  if (outFile) args.push("-o", outFile);
  if (model) args.push("-m", model);
  args.push("-");
  return args;
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
