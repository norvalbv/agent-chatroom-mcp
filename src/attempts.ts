#!/usr/bin/env node
/**
 * Independent attempts, selected by a check: the no-chat path the evidence supports.
 *
 *   npx tsx src/attempts.ts "<task>" --check "<shell command, exit 0 = pass>" --protect <paths the check reads,...> [--n 3] [--cwd dir] [--model sonnet] [--timeout 20]
 *
 * The check is hidden from the attempts: each attempt works in a fresh, history-less export of base outside the
 * repo with the --protect paths left out, and its diff (minus anything under --protect) is replayed onto a branch
 * from base before the check runs. So an attempt can neither iterate against the judge nor edit it (hdju
 * verifier's objection to 0079450). It is not a sandbox: an attempt with Bash can still search the disk.
 *
 * Why (evidence/oracle-at-k, swarm-232020-hdju; paper/sections/results.tex): on bench-printf-format a
 * 3-seat chatroom passed 6/40 and agreement-selection over 7 attempts 7/40, while three unseen attempts
 * picked by a discriminating check would have passed ~26.5/40 (unbiased pass@3 over the stored arm-K
 * attempts). Discussion and agreement both converge on the modal answer; only a check separates a
 * correct minority. So: with a check, N isolated attempts and the check picks; without one, run one
 * agent. There is no room, no hub and no chat here.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
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
 * check reads) are absent from its tree and history. A seat that can run the judge iterates to it or edits it, and the
 * check stops discriminating; the oracle-at-k evidence came from a hidden oracle (hdju verifier on 0079450).
 */
export function attemptPrompt(task: string): string {
  return `${task}\n\nWork alone in this directory. When you are done, stop. Your work is judged afterwards by a hidden check.`;
}

const git = (dir: string, ...a: string[]) =>
  spawnSync("git", ["-C", dir, "-c", "user.name=attempts", "-c", "user.email=attempts@local", ...a], { encoding: "utf8", maxBuffer: 256 << 20 });
const excludes = (paths: readonly string[]) => paths.map((p) => `:(exclude)${p}`);

/**
 * A fresh repo at `dir` holding base's tree minus the protected paths, with one commit and no link to the source
 * repo: the tests are not in the tree, in its history or in a shared object store. Returns the start sha.
 */
export function exportAttemptTree(repo: string, base: string, dir: string, protect: readonly string[]): string {
  mkdirSync(dir, { recursive: true });
  const tar = spawnSync("git", ["-C", repo, "archive", base, "--", ".", ...excludes(protect)], { maxBuffer: 1 << 30 });
  if (tar.status !== 0) throw new Error(`git archive failed: ${tar.stderr}`);
  const x = spawnSync("tar", ["-x", "-C", dir], { input: tar.stdout });
  if (x.status !== 0) throw new Error(`tar failed: ${x.stderr}`);
  git(dir, "init", "-q");
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "--no-verify", "--allow-empty", "-m", "attempt start");
  return git(dir, "rev-parse", "HEAD").stdout.trim();
}

/**
 * Replay what the attempt changed since `start`, minus anything under the protected paths, onto `checkDir` (a
 * worktree of the source repo at base) and commit it there. Returns the protected-path files the attempt wrote,
 * which were dropped, and whether the replay applied.
 */
export function landAttempt(attemptDir: string, start: string, checkDir: string, protect: readonly string[], message: string): { tampered: string[]; applied: boolean } {
  git(attemptDir, "add", "-A");
  git(attemptDir, "commit", "-q", "--no-verify", "-m", "attempt end");
  const tampered = protect.length ? git(attemptDir, "diff", "--name-only", start, "HEAD", "--", ...protect).stdout.split("\n").filter(Boolean) : [];
  const patch = git(attemptDir, "diff", "--binary", start, "HEAD", "--", ".", ...excludes(protect)).stdout;
  if (!patch.trim()) return { tampered, applied: true };
  const ap = spawnSync("git", ["-C", checkDir, "apply", "--index", "--whitespace=nowarn", "-"], { input: patch, encoding: "utf8" });
  if (ap.status !== 0) return { tampered, applied: false };
  git(checkDir, "commit", "-q", "--no-verify", "-m", message);
  return { tampered, applied: true };
}

const EDIT_TOOLS = ["Read", "Grep", "Glob", "Bash", "Edit", "Write", "MultiEdit"];

function runAttempt(task: string, check: string, protect: readonly string[], cwd: string, id: string, index: number, model: string | undefined, timeoutMs: number): Promise<AttemptResult> {
  // the attempt works outside the repo; the branch the check runs on is a worktree made only after it finishes
  const work = resolve(mkdtempSync(join(tmpdir(), `${id}-${index}-`)), "work");
  const dir = resolve(cwd, ".swarm-worktrees", id, `attempt-${index}`);
  const branch = `attempts/${id}/${index}`;
  const result: AttemptResult = { index, branch, dir, ran: false, passed: false, check_exit: null, cost_usd: null, tampered: [] };
  const baseSha = git(cwd, "rev-parse", "HEAD").stdout.trim();
  let start: string;
  try {
    start = exportAttemptTree(cwd, baseSha, work, protect);
  } catch (e) {
    console.error(`attempt ${index}: ${(e as Error).message}`);
    return Promise.resolve(result);
  }
  const mods = resolve(cwd, "node_modules");
  if (existsSync(mods) && !existsSync(resolve(work, "node_modules"))) {
    symlinkSync(mods, resolve(work, "node_modules"), "dir");
    writeFileSync(resolve(work, ".git", "info", "exclude"), "/node_modules\n");
  }
  const args = claudeArgs({ mcpJson: JSON.stringify({ mcpServers: {} }), tools: EDIT_TOOLS, model });
  return new Promise((done) => {
    const child = spawn("claude", args, { cwd: work, stdio: ["pipe", "pipe", "inherit"] });
    child.stdin.on("error", () => {});
    child.stdin.end(attemptPrompt(task)); // the prompt, never argv (claude-args.ts)
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    const timer = setTimeout(() => child.kill("SIGTERM"), timeoutMs);
    child.on("close", (code) => {
      clearTimeout(timer);
      const usage = parseClaudeCliOutput(out).usage;
      const ran = { ...result, ran: code === 0, cost_usd: usage?.cost ?? null };
      const wt = git(cwd, "worktree", "add", "-q", "-b", branch, dir, baseSha);
      if (wt.status !== 0) {
        console.error(`attempt ${index}: worktree failed: ${wt.stderr.trim()}`);
        return done(ran);
      }
      const landed = landAttempt(work, start, dir, protect, `attempt ${index}`);
      if (!landed.applied) {
        console.error(`attempt ${index}: its diff did not apply to base (left in ${work})`);
        return done({ ...ran, ran: false, tampered: landed.tampered });
      }
      rmSync(resolve(work, ".."), { recursive: true, force: true });
      if (existsSync(mods) && !existsSync(resolve(dir, "node_modules"))) symlinkSync(mods, resolve(dir, "node_modules"), "dir");
      const c = spawnSync("sh", ["-c", check], { cwd: dir, encoding: "utf8", timeout: 600_000 });
      done({ ...ran, passed: c.status === 0, check_exit: c.status, tampered: landed.tampered });
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
