/**
 * Account-by-regime table (paper/amendments.md, 2026-09-20 08:00 UTC). Joins a sanitized account-switch log
 * (UTC switch times and account slot numbers only; no email, no token) to every recorded single-seat run in
 * bench/results and reports, per active account, how many runs used long thinking.
 *
 * Usage:
 *   node --import tsx scripts/paper-account-regime.ts SWITCH_LOG_JSON RESULTS_ROOT [--out PREFIX]
 *   node --import tsx scripts/paper-account-regime.ts --extract SWITCHER_LOG [--since ISO] > SWITCH_LOG_JSON
 *
 * --extract reads the switcher's own log ("YYYY-MM-DD HH:MM:SS,mmm - INFO - Switched from account X to Y",
 * local time) and prints the sanitized JSON. It is run by the maintainer; the committed JSON is the source.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const LONG_THINKING_THRESHOLD = 4000; // frozen in paper/prereg-confirmatory.md
export interface Switch { at: string; from: number; to: number }
export interface SwitchLog { note: string; switches: Switch[] }
export interface SeatRow { path: string; task: string; arm: string; started: number; completed: number; thinking: number | null; output: number | null }

export function extractSwitches(logText: string, sinceIso?: string): Switch[] {
  const since = sinceIso ? Date.parse(sinceIso) : -Infinity;
  const out: Switch[] = [];
  for (const line of logText.split("\n")) {
    const m = line.match(/^(\d{4}-\d\d-\d\d) (\d\d:\d\d:\d\d),\d+ - INFO - Switched from account (\d+) to (\d+)\s*$/);
    if (!m) continue;
    const at = new Date(`${m[1]}T${m[2]}`); // local wall-clock time of the machine that wrote the log
    if (at.getTime() >= since) out.push({ at: at.toISOString(), from: Number(m[3]), to: Number(m[4]) });
  }
  return out.sort((a, b) => a.at.localeCompare(b.at));
}

/** Account active at time t, or null before the first logged switch's `from` can be trusted (it can: `from` is the account left). */
export function accountAt(switches: Switch[], t: number): number | null {
  if (switches.length === 0) return null;
  let account: number = switches[0].from;
  for (const s of switches) { if (Date.parse(s.at) <= t) account = s.to; else break; }
  return account;
}

const SKIP = new Set(["workspace", "review-workspace", "node_modules", ".git"]);
export function loadSeatRows(root: string): SeatRow[] {
  const rows: SeatRow[] = [];
  const walk = (dir: string, depth: number) => {
    if (depth > 5) return;
    for (const e of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (!e.isDirectory() || SKIP.has(e.name)) continue;
      const p = join(dir, e.name);
      const rp = join(p, "result.json");
      if (existsSync(rp)) {
        try {
          const r = JSON.parse(readFileSync(rp, "utf8"));
          // Single-seat runs only (arm A, AH, and arm K's attempts, which are arm-A runs): one seat, one model
          // call stream, so the seat's thinking tokens are the run's. Provider-refused seats are not runs.
          if ((r.arm === "A" || r.arm === "AH") && Array.isArray(r.seats) && r.seats.length === 1) {
            const s = r.seats[0];
            const synthetic = (s.reported_models?.assistant ?? []).includes("<synthetic>");
            const usage = Object.values(s.model_usage ?? {}) as Array<Record<string, unknown>>;
            const nums = (k: string) => usage.map((m) => m?.[k]).filter((v): v is number => typeof v === "number");
            const th = nums("thinkingTokens");
            const started = Date.parse(s.started_at), completed = Date.parse(s.completed_at);
            const output = typeof s.usage?.output_tokens === "number" ? s.usage.output_tokens : null;
            if (!synthetic && Number.isFinite(started) && Number.isFinite(completed) && (th.length > 0 || (output ?? 0) > 0)) {
              rows.push({ path: relative(root, p), task: r.task_id, arm: r.arm, started, completed, thinking: th.length ? th.reduce((a, b) => a + b, 0) : null, output });
            }
          }
        } catch { /* unreadable result: not a run */ }
      }
      walk(p, depth + 1);
    }
  };
  walk(root, 0);
  return rows;
}

const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };

export function buildTable(switches: Switch[], rows: SeatRow[]) {
  const first = switches.length ? Date.parse(switches[0].at) : Infinity;
  const inLog = rows.filter((r) => r.started >= first);
  const withAccount = inLog.map((r) => ({ ...r, a0: accountAt(switches, r.started), a1: accountAt(switches, r.completed) }));
  const straddling = withAccount.filter((r) => r.a0 !== r.a1);
  const clean = withAccount.filter((r) => r.a0 === r.a1);
  const accounts = [...new Set(clean.map((r) => r.a0 as number))].sort((a, b) => a - b);
  const thinking = accounts.map((account) => {
    const v = clean.filter((r) => r.a0 === account && r.thinking !== null).map((r) => r.thinking as number);
    return { account, n: v.length, long: v.filter((x) => x >= LONG_THINKING_THRESHOLD).length, median: median(v), min: v.length ? Math.min(...v) : null, max: v.length ? Math.max(...v) : null };
  });
  const output = accounts.flatMap((account) => [...new Set(clean.filter((r) => r.a0 === account).map((r) => r.task))].sort().map((task) => {
    const v = clean.filter((r) => r.a0 === account && r.task === task && r.output !== null).map((r) => r.output as number);
    return { account, task, n: v.length, median: median(v), min: v.length ? Math.min(...v) : null, max: v.length ? Math.max(...v) : null };
  }));
  // Only tasks run under more than one account say anything about the account; the rest are listed nowhere.
  const shared = new Set([...new Set(output.map((o) => o.task))].filter((task) => output.filter((o) => o.task === task && o.n > 0).length > 1));
  const comparable = output.filter((o) => shared.has(o.task)).sort((a, b) => a.task.localeCompare(b.task) || a.account - b.account);
  return { threshold: LONG_THINKING_THRESHOLD, switches_in_log: switches.length, runs_in_log_window: inLog.length, runs_straddling_a_switch: straddling.length, thinking, output: comparable };
}

export function renderMarkdown(t: ReturnType<typeof buildTable>): string {
  const L = [
    "# Thinking regime by active subscription account", "",
    `Single-seat runs (arm A, arm AH, and arm K attempts) in the switch-log window: ${t.runs_in_log_window}; ${t.runs_straddling_a_switch} straddle a switch and are left out. Long thinking means at least ${t.threshold} thinking tokens.`, "",
    "| account | runs with thinking tokens | long-thinking runs | median thinking tokens | min | max |", "|---|---|---|---|---|---|",
    ...t.thinking.map((r) => `| ${r.account} | ${r.n} | ${r.long}/${r.n} | ${r.median ?? "n/a"} | ${r.min ?? "n/a"} | ${r.max ?? "n/a"} |`), "",
    "Output tokens, for tasks run under more than one account (recorded for every run, including runs from before thinking tokens were recorded):", "",
    "| task | account | runs | median output tokens | min | max |", "|---|---|---|---|---|---|",
    ...t.output.map((r) => `| ${r.task} | ${r.account} | ${r.n} | ${r.median ?? "n/a"} | ${r.min ?? "n/a"} | ${r.max ?? "n/a"} |`), "",
  ];
  return L.join("\n");
}

function main() {
  const args = process.argv.slice(2);
  if (args[0] === "--extract") {
    const src = args[1]; let since: string | undefined;
    if (args[2] === "--since") since = args[3];
    if (!src) throw Error("Usage: --extract SWITCHER_LOG [--since ISO]");
    const log: SwitchLog = { note: "Sanitized extract of the maintainer's Claude Code account-switcher log: UTC switch times and account slot numbers only.", switches: extractSwitches(readFileSync(src, "utf8"), since) };
    console.log(JSON.stringify(log, null, 2));
    return;
  }
  const [logPath, root] = args.splice(0, 2); let out: string | undefined;
  while (args.length) { const f = args.shift(); if (f === "--out") out = args.shift(); else throw Error(`Unknown option ${f}`); }
  if (!logPath || !root) throw Error("Usage: paper-account-regime.ts SWITCH_LOG_JSON RESULTS_ROOT [--out PREFIX]");
  const log = JSON.parse(readFileSync(logPath, "utf8")) as SwitchLog;
  const table = buildTable(log.switches, loadSeatRows(resolve(root)));
  const md = renderMarkdown(table);
  if (out) { const prefix = resolve(out); mkdirSync(dirname(prefix), { recursive: true }); writeFileSync(`${prefix}.md`, md); writeFileSync(`${prefix}.json`, JSON.stringify(table, null, 2) + "\n"); }
  console.log(md);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
