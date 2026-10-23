/**
 * `swarm --preflight "<cmd>"`: the environment checks a kit declares, run by the launcher before any seat starts.
 *
 * Why: the 13 Oct Polymarket room found its link was a VPN (196 ms RTT, 5% loss, "1013 slow consumer") and lost an hour
 * of live data before the owner switched it off; that fact reached RULEBOOK.md and the chair's memory, then was trimmed
 * out of the 22 Oct live-money room's resources ("0.05 s p50 from this laptop on a clean link") and its --no-carry seats
 * never saw it (swarm-073112-zcd7 evidence/earlier-rooms). A precondition carried as prose decays at each hand-over
 * (sources/arXiv:2504.00025); one carried as a command runs every time.
 *
 * Contract: the command prints one JSON object per line, {"check","status":"ok|warn|fail","value","why"?,"fix"?}; any
 * other line is ignored. It exits 0 even when checks fail: status decides. A command that cannot run, times out or
 * prints no check is itself a fail, never a silent pass.
 */
import { spawnSync } from "node:child_process";
import type { Resource } from "../resources.js";

export type PreflightStatus = "ok" | "warn" | "fail";
export interface PreflightCheck { check: string; status: PreflightStatus; value: string; why?: string; fix?: string }
export interface PreflightResult {
  cmd: string;
  ranAt: string;
  durationMs: number;
  exitCode: number | null;
  checks: PreflightCheck[];
  fails: number;
  warns: number;
  /** lines that were not a check object, so a kit author sees a format slip */
  ignoredLines: number;
  /** why the command itself did not give a usable answer; such a run counts as one fail */
  error?: string;
}

export const PREFLIGHT_RESOURCE_KEY = "resource/preflight-environment-at-launch";
const STATUSES = new Set(["ok", "warn", "fail"]);
const clip = (s: unknown, n: number) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);

export function parsePreflight(cmd: string, stdout: string, exitCode: number | null, durationMs: number, ranAt: string, spawnError?: string): PreflightResult {
  const checks: PreflightCheck[] = [];
  let ignoredLines = 0;
  for (const raw of stdout.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    let o: any;
    try { o = JSON.parse(line); } catch { ignoredLines++; continue; }
    if (!o || typeof o !== "object" || typeof o.check !== "string" || !STATUSES.has(o.status)) { ignoredLines++; continue; }
    checks.push({ check: clip(o.check, 60), status: o.status, value: clip(o.value, 200), ...(o.why ? { why: clip(o.why, 300) } : {}), ...(o.fix ? { fix: clip(o.fix, 300) } : {}) });
  }
  const error = spawnError ?? (exitCode === null ? "did not finish (timed out or was killed)" : exitCode !== 0 && !checks.length ? `exited ${exitCode} with no check lines` : !checks.length ? "printed no check lines" : undefined);
  const fails = checks.filter((c) => c.status === "fail").length + (error ? 1 : 0);
  const warns = checks.filter((c) => c.status === "warn").length;
  return { cmd, ranAt, durationMs, exitCode, checks, fails, warns, ignoredLines, ...(error ? { error } : {}) };
}

export function runPreflight(cmd: string, cwd: string, timeoutMs = 120_000): PreflightResult {
  const ranAt = new Date().toISOString();
  const t0 = Date.now();
  const r = spawnSync(cmd, { cwd, shell: true, encoding: "utf8", timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 });
  return parsePreflight(cmd, r.stdout ?? "", r.status, Date.now() - t0, ranAt, r.error ? `could not run (${(r.error as NodeJS.ErrnoException).code ?? r.error.message})` : undefined);
}

const line = (c: PreflightCheck) => `- ${c.status.toUpperCase()} ${c.check}: ${c.value}${c.why ? ` — ${c.why}` : ""}${c.fix ? ` (owner fix: ${c.fix})` : ""}`;
export const preflightVerdict = (r: PreflightResult) => r.fails ? `${r.fails} FAIL, ${r.warns} WARN` : r.warns ? `${r.warns} WARN` : "all OK";

/** Every seat's brief opens with this when a preflight ran: the environment as measured, and what to do if it bears on
 * the work. A run with only OK lines gets one line, so a clean machine costs the brief almost nothing. */
export function preflightBrief(r: PreflightResult): string {
  const head = `ENVIRONMENT AT LAUNCH (measured by the launcher's preflight at ${r.ranAt.slice(0, 16).replace("T", " ")} UTC: ${preflightVerdict(r)}; full result on the board as ${PREFLIGHT_RESOURCE_KEY}).`;
  if (!r.fails && !r.warns) return head + "\n";
  const bad = r.checks.filter((c) => c.status !== "ok");
  return [
    head,
    ...(r.error ? [`- FAIL preflight: the check command ${r.error}, so the environment is UNKNOWN`] : []),
    ...bad.map(line),
    "These lines measure this machine, not the market: a FAIL says a number taken here would be the machine's, it does not answer your question. Before you experiment, decide whether any FAIL or WARN blocks or invalidates what you are about to measure. If it does: do not route around it and do not start that work. Write needs/<name> on the board (what, why, what it unblocks, how you would check it worked, and a `blocks: claim/...` line) and tell the chair, then work on what it does not block, such as what can be measured from exchange timestamps or recorded data rather than this machine's clock.",
    "",
  ].join("\n");
}

export function preflightResource(r: PreflightResult): Resource {
  const text = [
    `preflight environment at launch (${preflightVerdict(r)})`,
    `Ran \`${r.cmd.slice(0, 300)}\` at ${r.ranAt} in ${r.durationMs} ms (exit ${r.exitCode ?? "none"}). Measured once, before any seat started: re-run it before you rely on a number, the machine changes.`,
    ...(r.error ? [`- FAIL preflight: the check command ${r.error}`] : []),
    ...r.checks.map(line),
    ...(r.ignoredLines ? [`(${r.ignoredLines} non-check output line(s) ignored)`] : []),
  ].join("\n");
  return { key: PREFLIGHT_RESOURCE_KEY, text: text.slice(0, 8000) };
}

export function renderPreflight(r: PreflightResult | undefined): string {
  if (!r) return "";
  return `## Preflight\n\n${preflightResource(r).text}\n\n`;
}

/** Refusal text for --preflight-strict, or null when the launch may go on. */
export function strictRefusal(r: PreflightResult): string | null {
  if (!r.fails) return null;
  return `--preflight-strict: not starting any seat, the preflight has ${preflightVerdict(r)}:\n${[...(r.error ? [`- FAIL preflight: the check command ${r.error}`] : []), ...r.checks.filter((c) => c.status === "fail").map(line)].join("\n")}`;
}

/**
 * The launcher's whole use of this file (src/swarm.ts): `--preflight "<cmd>"` reports, `--preflight-strict "<cmd>"` also
 * refuses the launch (exit 2, before a hub or seat starts) on any FAIL. Returns the brief block every seat's prompt opens
 * with and the board resource; both empty when neither flag was given.
 */
export function preflightAtLaunch(argv: string[], cwd: string, timeoutMs = Number(process.env.CHATROOM_PREFLIGHT_TIMEOUT_MS ?? 120_000)): { result?: PreflightResult; text: string; resource?: Resource } {
  const at = (name: string) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
  const strict = at("--preflight-strict");
  const cmd = strict ?? at("--preflight");
  if (cmd === undefined) return { text: "" };
  const result = runPreflight(cmd, cwd, timeoutMs);
  const refusal = strict !== undefined ? strictRefusal(result) : null;
  if (refusal) { console.error(refusal); process.exit(2); }
  console.log(`preflight: ${preflightVerdict(result)} in ${result.durationMs} ms (${result.checks.length} check${result.checks.length === 1 ? "" : "s"}${result.error ? `; the command ${result.error}` : ""})`);
  // whoever launches reads what to install here, before the seats start, not later on the board
  for (const c of result.checks) if (c.status !== "ok") console.log(line(c));
  return { result, text: preflightBrief(result) + "\n", resource: preflightResource(result) };
}
