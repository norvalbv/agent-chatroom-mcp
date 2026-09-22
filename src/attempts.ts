#!/usr/bin/env node
/**
 * Independent attempts, selected by a check: the no-chat path the evidence supports.
 *
 *   npx tsx src/attempts.ts "<task>" --check "<shell command, exit 0 = pass>" [--n 3] [--cwd dir] [--model sonnet] [--timeout 20]
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

const EDIT_TOOLS = ["Read", "Grep", "Glob", "Bash", "Edit", "Write", "MultiEdit"];

function runAttempt(task: string, check: string, cwd: string, id: string, index: number, model: string | undefined, timeoutMs: number): Promise<AttemptResult> {
  const dir = resolve(cwd, ".swarm-worktrees", id, `attempt-${index}`);
  const branch = `attempts/${id}/${index}`;
  const base: AttemptResult = { index, branch, dir, ran: false, passed: false, check_exit: null, cost_usd: null };
  const wt = spawnSync("git", ["-C", cwd, "worktree", "add", "-b", branch, dir], { encoding: "utf8" });
  if (wt.status !== 0) {
    console.error(`attempt ${index}: worktree failed: ${wt.stderr.trim()}`);
    return Promise.resolve(base);
  }
  const mods = resolve(cwd, "node_modules");
  if (existsSync(mods) && !existsSync(resolve(dir, "node_modules"))) symlinkSync(mods, resolve(dir, "node_modules"), "dir");
  const text = `${task}\n\nWork alone in this directory. When you are done, stop; your work is judged by running: ${check}`;
  const args = claudeArgs({ text, mcpJson: JSON.stringify({ mcpServers: {} }), tools: EDIT_TOOLS, model });
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
      const c = spawnSync("sh", ["-c", check], { cwd: dir, encoding: "utf8", timeout: 600_000 });
      done({ ...base, ran: code === 0, passed: c.status === 0, check_exit: c.status, cost_usd: usage?.cost ?? null });
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
    console.error(!task ? 'usage: attempts "<task>" --check "<cmd>" [--n 3] [--cwd dir] [--model m] [--timeout 20]' : plan.ok ? "" : plan.reason);
    process.exit(2);
  }
  const cwd = resolve(flag("cwd", process.cwd())!);
  const id = `attempts-${new Date().toISOString().slice(11, 19).replace(/:/g, "")}-${Math.random().toString(36).slice(2, 6)}`;
  const timeoutMs = Number(flag("timeout", "20")) * 60_000;
  const results = await Promise.all(Array.from({ length: plan.n }, (_, i) => runAttempt(task, check!, cwd, id, i + 1, flag("model"), timeoutMs)));
  const winner = pickWinner(results);
  const outDir = resolve(fileURLToPath(new URL("..", import.meta.url)), "swarms", id);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(resolve(outDir, "attempts.json"), JSON.stringify({ task, check, n: plan.n, winner: winner?.index ?? null, results }, null, 2));
  for (const r of results) console.log(`attempt ${r.index}: ${r.passed ? "PASS" : "fail"} (check exit ${r.check_exit}) ${r.branch}${r.cost_usd != null ? ` $${r.cost_usd.toFixed(3)}` : ""}`);
  console.log(winner ? `winner: ${winner.branch} (merge it yourself: git merge ${winner.branch})` : "no attempt passed the check");
  process.exit(winner ? 0 : 1);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) void main();
