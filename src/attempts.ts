#!/usr/bin/env node
/**
 * Independent attempts, selected by a check: the no-chat path the evidence supports.
 *
 *   npx tsx src/attempts.ts "<task>" --check "<shell command, exit 0 = pass>" --protect <paths the check reads,...> [--n 3] [--cwd dir] [--model sonnet] [--timeout 20]
 *
 * The check is hidden from the attempts and --protect paths are restored from base before it runs, so an
 * attempt can neither iterate against the judge nor edit it (hdju verifier's objection to 0079450).
 *
 * Why (evidence/oracle-at-k, swarm-232020-hdju; paper/sections/results.tex): on bench-printf-format a
 * 3-seat chatroom passed 6/40 and agreement-selection over 7 attempts 7/40, while three unseen attempts
 * picked by a discriminating check would have passed ~26.5/40 (unbiased pass@3 over the stored arm-K
 * attempts). Discussion and agreement both converge on the modal answer; only a check separates a
 * correct minority. So: with a check, N isolated attempts and the check picks; without one, run one
 * agent. There is no room, no hub and no chat here.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { claudeArgs } from "./claude-args.js";
import { parseClaudeCliOutput } from "./result.js";

export interface AttemptResult {
  index: number;
  branch: string;
  dir: string;
  /** claude exited 0 */
  ran: boolean;
  /** the check command exited 0 in this attempt's worktree */
  passed: boolean;
  check_exit: number | null;
  cost_usd: number | null;
  /** files the attempt wrote under protected paths (discarded before the check ran) */
  tampered: string[];
}

/** The winner is the lowest-index attempt whose check passed; null when none did (report, never guess). */
export function pickWinner(results: readonly AttemptResult[]): AttemptResult | null {
  return [...results].sort((a, b) => a.index - b.index).find((r) => r.ran && r.passed) ?? null;
}

/** No check means no way to tell a correct minority from the modal answer, so extra attempts buy nothing: refuse and say so. */
export function planAttempts(opts: { n: number; check?: string }): { ok: true; n: number } | { ok: false; reason: string } {
  if (!opts.check?.trim()) return { ok: false, reason: "no --check: without a discriminating check, extra attempts (or a chatroom) converge on the modal answer; run one agent instead" };
  if (!Number.isInteger(opts.n) || opts.n < 1) return { ok: false, reason: `--n must be a positive integer (got ${opts.n})` };
  return { ok: true, n: opts.n };
}

/**
 * The attempt never sees the check: the command is not in its prompt and the --protect paths (the tests the
 * check reads) are removed from its tree. A seat that can run the judge iterates to it or edits it, and the
 * check stops discriminating; the oracle-at-k evidence came from a hidden oracle (hdju verifier on 0079450).
 */
export function attemptPrompt(task: string): string {
  return `${task}\n\nWork alone in this directory. When you are done, stop. Your work is judged afterwards by a hidden check.`;
}

const git = (dir: string, ...a: string[]) => spawnSync("git", ["-C", dir, ...a], { encoding: "utf8" });

/** Remove the protected paths from the attempt's tree and commit; returns the sha the attempt starts from. */
export function hideProtected(dir: string, paths: readonly string[]): string {
  if (paths.length) {
    git(dir, "rm", "-r", "-q", "--ignore-unmatch", "--", ...paths);
    git(dir, "commit", "-q", "--no-verify", "-m", "attempts: hide protected paths");
  }
  return git(dir, "rev-parse", "HEAD").stdout.trim();
}

/**
 * Put every protected path back to its state at `base` (anything the attempt wrote there removed) and commit,
 * so the check, and a later merge of the winner, see pristine tests. Returns what the attempt had written under
 * protected paths since `hidden`.
 */
export function restoreProtected(dir: string, base: string, hidden: string, paths: readonly string[]): string[] {
  if (!paths.length) return [];
  const tampered = git(dir, "diff", "--name-only", hidden, "HEAD", "--", ...paths).stdout.split("\n").filter(Boolean);
  git(dir, "rm", "-r", "-q", "--ignore-unmatch", "--", ...paths);
  const present = paths.filter((p) => git(dir, "cat-file", "-e", `${base}:${p.replace(/\/$/, "")}`).status === 0);
  if (present.length) git(dir, "checkout", base, "--", ...present);
  git(dir, "commit", "-q", "--no-verify", "-m", "attempts: restore protected paths");
  return tampered;
}

const EDIT_TOOLS = ["Read", "Grep", "Glob", "Bash", "Edit", "Write", "MultiEdit"];

function runAttempt(task: string, check: string, protect: readonly string[], cwd: string, id: string, index: number, model: string | undefined, timeoutMs: number): Promise<AttemptResult> {
  const dir = resolve(cwd, ".swarm-worktrees", id, `attempt-${index}`);
  const branch = `attempts/${id}/${index}`;
  const base: AttemptResult = { index, branch, dir, ran: false, passed: false, check_exit: null, cost_usd: null, tampered: [] };
  const baseSha = spawnSync("git", ["-C", cwd, "rev-parse", "HEAD"], { encoding: "utf8" }).stdout.trim();
  const wt = spawnSync("git", ["-C", cwd, "worktree", "add", "-b", branch, dir], { encoding: "utf8" });
  if (wt.status !== 0) {
    console.error(`attempt ${index}: worktree failed: ${wt.stderr.trim()}`);
    return Promise.resolve(base);
  }
  const mods = resolve(cwd, "node_modules");
  if (existsSync(mods) && !existsSync(resolve(dir, "node_modules"))) symlinkSync(mods, resolve(dir, "node_modules"), "dir");
  const hidden = hideProtected(dir, protect);
  const args = claudeArgs({ text: attemptPrompt(task), mcpJson: JSON.stringify({ mcpServers: {} }), tools: EDIT_TOOLS, model });
  return new Promise((done) => {
    const child = spawn("claude", args, { cwd: dir, stdio: ["ignore", "pipe", "inherit"] });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    const timer = setTimeout(() => child.kill("SIGTERM"), timeoutMs);
    child.on("close", (code) => {
      clearTimeout(timer);
      const usage = parseClaudeCliOutput(out).usage;
      spawnSync("git", ["-C", dir, "add", "-A"]);
      spawnSync("git", ["-C", dir, "commit", "-q", "--no-verify", "-m", `attempt ${index}`], { encoding: "utf8" });
      const tampered = restoreProtected(dir, baseSha, hidden, protect);
      const c = spawnSync("sh", ["-c", check], { cwd: dir, encoding: "utf8", timeout: 600_000 });
      done({ ...base, ran: code === 0, passed: c.status === 0, check_exit: c.status, cost_usd: usage?.cost ?? null, tampered });
    });
  });
}

async function main() {
  const argv = process.argv.slice(2);
  const flag = (name: string, def?: string) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : def;
  };
  const task = argv.find((a, i) => !a.startsWith("--") && (i === 0 || !argv[i - 1].startsWith("--")));
  const check = flag("check");
  const plan = planAttempts({ n: Number(flag("n", "3")), check });
  if (!task || !plan.ok) {
    console.error(!task ? 'usage: attempts "<task>" --check "<cmd>" [--protect tests/,fixtures/] [--n 3] [--cwd dir] [--model m] [--timeout 20]' : plan.ok ? "" : plan.reason);
    process.exit(2);
  }
  const cwd = resolve(flag("cwd", process.cwd())!);
  const id = `attempts-${new Date().toISOString().slice(11, 19).replace(/:/g, "")}-${Math.random().toString(36).slice(2, 6)}`;
  const timeoutMs = Number(flag("timeout", "20")) * 60_000;
  const protect = (flag("protect") ?? "").split(",").map((p) => p.trim()).filter(Boolean);
  if (!protect.length) console.error("warning: no --protect paths; an attempt could edit the files the check reads");
  const results = await Promise.all(Array.from({ length: plan.n }, (_, i) => runAttempt(task, check!, protect, cwd, id, i + 1, flag("model"), timeoutMs)));
  const winner = pickWinner(results);
  const outDir = resolve(fileURLToPath(new URL("..", import.meta.url)), "swarms", id);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(resolve(outDir, "attempts.json"), JSON.stringify({ task, check, protect, n: plan.n, winner: winner?.index ?? null, results }, null, 2));
  for (const r of results) console.log(`attempt ${r.index}: ${r.passed ? "PASS" : "fail"} (check exit ${r.check_exit}) ${r.branch}${r.cost_usd != null ? ` $${r.cost_usd.toFixed(3)}` : ""}${r.tampered.length ? ` (reverted edits to ${r.tampered.join(", ")})` : ""}`);
  console.log(winner ? `winner: ${winner.branch} (merge it yourself: git merge ${winner.branch})` : "no attempt passed the check");
  process.exit(winner ? 0 : 1);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) void main();
