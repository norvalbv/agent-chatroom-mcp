/** Seat process and provenance helpers adapted from bench-rq1 at 98e17b2.
 * Kept separate because the concurrent RQ runner is executable, not an importable library.
 * Shared argument, environment and usage parsing still use src helpers. */
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, lstatSync, cpSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join, resolve, relative } from "node:path";
import { createServer } from "node:net";
import { pathToFileURL, fileURLToPath } from "node:url";
import { claudeArgs } from "../src/claude-args.js";
import { parseClaudeCliOutput, rollupUsage, type SeatUsageRollup } from "../src/result.js";
import { seatChildEnv } from "../src/env.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");

export const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
export const json = (path: string, value: unknown) => writeFileSync(path, JSON.stringify(value, null, 2) + "\n");

export function hashTree(path: string, excluded = new Set<string>()): string {
  const hash = createHash("sha256");
  const visit = (p: string) => {
    const st = lstatSync(p);
    if (st.isSymbolicLink()) throw new Error(`Symlink not permitted: ${p}`);
    if (st.isDirectory()) {
      for (const name of readdirSync(p).sort()) if (!excluded.has(name)) visit(join(p, name));
    } else if (st.isFile()) {
      hash.update(relative(path, p));
      hash.update("\0");
      hash.update(readFileSync(p));
      hash.update("\0");
    }
  };
  visit(path);
  return hash.digest("hex");
}
export function hashFile(path: string): string | null {
  return existsSync(path) ? createHash("sha256").update(readFileSync(path)).digest("hex") : null;
}
export function revision(dir: string): string | null {
  try {
    return execFileSync("git", ["-C", dir, "rev-parse", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}
export async function stop(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null || !child.pid) return;
  killTracked(child, "SIGTERM");
  await Promise.race([new Promise<void>((ok) => child.once("exit", () => ok())), delay(500)]);
  if (child.exitCode === null && child.signalCode === null) {
    killTracked(child, "SIGKILL");
    await Promise.race([new Promise<void>((ok) => child.once("exit", () => ok())), delay(500)]);
  }
}

// Item 5 (orphans): the hub and every claude seat are tracked here so a SIGINT/SIGTERM/uncaught exit of
// this script kills them too, instead of leaving them reparented to pid 1. `exit` handlers must be
// synchronous, so this issues SIGKILL directly rather than the graceful stop() above.
const trackedChildren = new Set<ChildProcess>();
const groupedChildren = new WeakSet<ChildProcess>();
function killTracked(child: ChildProcess, signal: NodeJS.Signals) {
  if (!child.pid) return;
  try {
    if (groupedChildren.has(child)) process.kill(-child.pid, signal);
    else child.kill(signal);
  } catch (error: any) { if (error.code !== 'ESRCH') throw error; }
}
export function track(child: ChildProcess, grouped = false): ChildProcess {
  if (grouped) groupedChildren.add(child);
  trackedChildren.add(child);
  child.once("exit", () => {
    if (grouped) killTracked(child, 'SIGKILL');
    trackedChildren.delete(child);
  });
  return child;
}
process.on("exit", () => {
  for (const child of trackedChildren) {
    if (child.exitCode === null && child.signalCode === null && child.pid) {
      try {
        killTracked(child, "SIGKILL");
      } catch {}
    }
  }
});
process.on("SIGINT", () => process.exit(130));
process.on("SIGTERM", () => process.exit(143));

/** Token signal salvaged from `--output-format stream-json` messages seen before a seat was killed —
 * item 3: claude's real cost figure (`total_cost_usd`) only exists on the final `result` event, so a
 * killed seat's cost genuinely stays unknown (usage:null, exactly as an unmodified clean-exit failure
 * already reads), but the per-turn token counts on `type:"assistant"` events do survive a kill and are
 * worth keeping as forensic signal distinct from the authoritative `usage` field. */
export interface PartialUsage {
  output_tokens: number;
  input_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
  assistant_messages_observed: number;
}

export interface SeatRecord {
  name: string;
  argv: string[];
  exit_code: number | null;
  signal: string | null;
  started_at: string;
  completed_at: string;
  text: string;
  result_subtype: string | null;
  terminal_reason: string | null;
  usage: SeatUsageRollup | null;
  num_turns: number | null;
  duration_ms: number | null;
  duration_api_ms: number | null;
  stderr_tail: string;
  /** true only when *our* deadline timer sent the kill signal, distinct from any other exit/signal. */
  killed_by_deadline: boolean;
  /** Non-null only when the seat was killed before a `result` event arrived but at least one
   * `assistant` event was observed first; null (not zero-filled) otherwise. */
  partial_usage: PartialUsage | null;
  /** CLI-reported identifiers, not an attestation of provider weights or reasoning settings. */
  reported_models: { system_init: string[]; assistant: string[]; result_model_usage: string[] } | null;
  /** Unmodified terminal CLI usage by model, including reasoning fields when reported. */
  model_usage: Record<string, unknown> | null;
}

/** Spawn one `claude` seat (bare command name, resolved off PATH so tests can stub it); enforce a wall-clock cap since the CLI has no such flag itself.
 * Seats run with `--output-format stream-json` (see src/claude-args.ts): stdout is NDJSON, one event per
 * line, so a kill mid-run still leaves every event flushed before the kill on disk/in the buffer — a
 * clean-exit-only `--output-format json` blob loses everything to a SIGTERM (item 3). */
export function runClaudeSeat(name: string, args: string[], cwd: string, deadlineMs: number): Promise<SeatRecord> {
  return new Promise((res) => {
    const startedAt = new Date();
    const child = track(spawn("claude", args, { cwd, detached: true, env: seatChildEnv(process.env, name), stdio: ["ignore", "pipe", "pipe"] }), true);
    let buffered = "";
    let resultLine: string | null = null;
    let err = "";
    const partial: PartialUsage = { output_tokens: 0, assistant_messages_observed: 0 };
    const models = { system_init: new Set<string>(), assistant: new Set<string>(), result_model_usage: new Set<string>() };
    const observeModel = (source: keyof typeof models, value: unknown) => {
      if (typeof value === "string" && value.trim()) models[source].add(value);
    };
    let killedByDeadline = false;
    const consumeLine = (line: string) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      let evt: any;
      try {
        evt = JSON.parse(trimmed);
      } catch {
        return;
      }
      // Identity observations must survive usage-free events and a missing terminal result.
      if (evt?.type === "system" && evt.subtype === "init") observeModel("system_init", evt.model);
      if (evt?.type === "assistant") observeModel("assistant", evt.message?.model);
      if (evt?.type === "result") {
        if (evt.modelUsage && typeof evt.modelUsage === "object" && !Array.isArray(evt.modelUsage)) {
          for (const id of Object.keys(evt.modelUsage)) observeModel("result_model_usage", id);
        }
        resultLine = trimmed;
        return;
      }
      if (evt?.type === "assistant" && evt.message?.usage) {
        const u = evt.message.usage;
        partial.assistant_messages_observed += 1;
        if (typeof u.output_tokens === "number") partial.output_tokens += u.output_tokens;
        if (typeof u.input_tokens === "number") partial.input_tokens = u.input_tokens;
        if (typeof u.cache_read_input_tokens === "number") partial.cache_read_input_tokens = u.cache_read_input_tokens;
        if (typeof u.cache_creation_input_tokens === "number") partial.cache_creation_input_tokens = u.cache_creation_input_tokens;
      }
    };
    child.stdout?.on("data", (d) => {
      buffered += d;
      let idx: number;
      while ((idx = buffered.indexOf("\n")) >= 0) {
        consumeLine(buffered.slice(0, idx));
        buffered = buffered.slice(idx + 1);
      }
    });
    child.stderr?.on("data", (d) => (err += d));
    child.once("error", (e) => { err += String(e); });
    const killer = setTimeout(() => {
      killedByDeadline = true;
      killTracked(child, "SIGTERM");
      setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) killTracked(child, "SIGKILL");
      }, 2000).unref();
    }, deadlineMs);
    child.on("close", (code, signal) => {
      clearTimeout(killer);
      if (buffered.trim()) consumeLine(buffered);
      const completedAt = new Date();
      const raw = (resultLine ?? "").trim();
      const { text, usage } = parseClaudeCliOutput(raw);
      let parsed: any = null;
      try {
        parsed = resultLine ? JSON.parse(resultLine) : null;
      } catch {}
      res({
        name,
        argv: ["claude", ...args],
        exit_code: code,
        signal,
        started_at: startedAt.toISOString(),
        completed_at: completedAt.toISOString(),
        text,
        result_subtype: typeof parsed?.subtype === 'string' ? parsed.subtype : null,
        terminal_reason: typeof parsed?.terminal_reason === 'string' ? parsed.terminal_reason : null,
        usage,
        num_turns: typeof parsed?.num_turns === "number" ? parsed.num_turns : null,
        duration_ms: typeof parsed?.duration_ms === "number" ? parsed.duration_ms : null,
        duration_api_ms: typeof parsed?.duration_api_ms === "number" ? parsed.duration_api_ms : null,
        stderr_tail: err.slice(-4000),
        killed_by_deadline: killedByDeadline,
        partial_usage: !resultLine && partial.assistant_messages_observed > 0 ? partial : null,
        reported_models: Object.values(models).some((ids) => ids.size)
          ? { system_init: [...models.system_init], assistant: [...models.assistant], result_model_usage: [...models.result_model_usage] }
          : null,
        model_usage: parsed?.modelUsage && typeof parsed.modelUsage === "object" && !Array.isArray(parsed.modelUsage) ? parsed.modelUsage : null,
      });
    });
  });
}


export const hashWorkspace = (path: string) => hashTree(path, new Set(['.git']));
export const WORKSPACE_HASH_SCRIPT = `import {createHash} from 'node:crypto';
import {lstatSync,readdirSync,readFileSync} from 'node:fs';
import {join,relative,resolve} from 'node:path';
const root=resolve('.'),h=createHash('sha256');
function visit(p){const s=lstatSync(p);if(s.isSymbolicLink())throw Error('symlink');if(s.isDirectory()){for(const n of readdirSync(p).sort())if(n!=='.git')visit(join(p,n));}else if(s.isFile()){h.update(relative(root,p));h.update('\\0');h.update(readFileSync(p));h.update('\\0');}}
visit(root);console.log(h.digest('hex'));
`;
