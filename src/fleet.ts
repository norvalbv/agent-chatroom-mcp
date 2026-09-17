#!/usr/bin/env node
/**
 * Fleet: many flat swarms at once, one per area, on one hub. Each run is an ordinary `dist/swarm.js`
 * launch (12 seats: 11 workers + a verifier, all on one OpenRouter model when the model is free), so
 * every hub mechanic applies unchanged; the fleet only staggers the launches, keeps the machine and
 * the provider within bounds, and gathers every run's conclusion into one summary the human (or the
 * next swarm) reads. Runs are read-only by default: they find, reproduce, rank and hand back a
 * consensus; building it is a separate step with its own tests.
 *
 *   node dist/fleet.js fleet/self-improvement.json --model stealth/union-alpha [--agents 12] [--timeout 50]
 *        [--stagger 20] [--only hub,seat] [--skip ui] [--full-access] [--cwd dir] [--port 7717]
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadDotEnv } from "./env.js";
loadDotEnv();

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");
const argv = process.argv.slice(2);
const flag = (name: string, def?: string) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : def;
};
const has = (name: string) => argv.includes(`--${name}`);
const BOOL = new Set(["--full-access", "--consolidate"]);
const file = argv.find((a, i) => !a.startsWith("--") && (i === 0 || !argv[i - 1].startsWith("--") || BOOL.has(argv[i - 1])));
if (!file || !existsSync(file)) {
  console.error("usage: fleet <areas.json> --model <openrouter slug> [--agents 12] [--timeout 50] [--stagger 20] [--only a,b|none] [--skip c] [--consolidate] [--consolidate-from summary.md,...] [--full-access] [--cwd dir] [--port 7717]");
  process.exit(2);
}
interface Area {
  id: string;
  title: string;
  brief: string;
  /** competing variants: one room per lens on the same area, merged at consolidation (the grouped-run pattern) */
  lenses?: string[];
}
interface Spec {
  preamble: string;
  areas: Area[];
}
const spec = JSON.parse(readFileSync(file, "utf8")) as Spec;
const MODEL = flag("model", process.env.OPENROUTER_MODEL ?? "stealth/union-alpha")!;
const AGENTS = Number(flag("agents", "12"));
const TIMEOUT = Number(flag("timeout", "50"));
const STAGGER = Number(flag("stagger", "20"));
const CWD = resolve(flag("cwd", process.cwd())!);
const PORT = flag("port", process.env.PORT ?? "7717")!;
const FULL = has("full-access");
/** --consolidate: after the areas finish, one more run merges every conclusion into a single ranked consensus */
const CONSOLIDATE = has("consolidate");
/** --consolidate-from <summary.md>[,<summary.md>]: consolidate earlier fleets' summaries as well (or instead: with --only none) */
const CONSOLIDATE_FROM = (flag("consolidate-from") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const only = (flag("only") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const skip = (flag("skip") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const areas = (only[0] === "none" ? [] : spec.areas.filter((a) => (!only.length || only.includes(a.id)) && !skip.includes(a.id)))
  // an area with lenses becomes one room per lens: competing variants of the same question, merged at consolidation
  .flatMap((a) => (a.lenses?.length ? a.lenses.map((lens, i) => ({ id: `${a.id}-${String.fromCharCode(97 + i)}`, title: `${a.title} (${lens.split(":")[0]})`, brief: `${a.brief}\n${lens}\nAnother room works the same area through a different lens; you will be merged at consolidation, so state your evidence so it can be compared.` })) : [a]));
if (!process.env.OPENROUTER_API_KEY) {
  console.error("OPENROUTER_API_KEY is not set (export it or put it in .env)");
  process.exit(2);
}
if (AGENTS > 12) {
  console.error("a flat room holds 12 live agents; use more areas, not bigger rooms");
  process.exit(2);
}

const FLEET_ID = `fleet-${new Date().toISOString().slice(11, 19).replace(/:/g, "")}`;
const OUT = resolve(repoRoot, "swarms", FLEET_ID);
mkdirSync(OUT, { recursive: true });
const log = (s: string) => console.log(`\x1b[2m[${new Date().toISOString().slice(11, 19)}]\x1b[0m ${s}`);
log(`${FLEET_ID}: ${areas.length} run(s) × ${AGENTS} seats on ${MODEL} (${areas.length * AGENTS} agents), ${TIMEOUT} min each, ${STAGGER}s apart; summary at ${OUT}/summary.md`);

interface Result {
  area: Area;
  swarmId?: string;
  exitCode: number | null;
  conclusion: string;
  verdict: string;
  rateLimited: number;
  exits: string[];
  reportPath?: string;
}
const results: Result[] = [];
const children: ReturnType<typeof spawn>[] = [];
process.on("SIGINT", () => {
  for (const c of children) c.kill();
  process.exit(130);
});

function runArea(area: Area): Promise<Result> {
  return new Promise((res) => {
    const task = `${spec.preamble}\n\nYOUR AREA: ${area.title}\n${area.brief}`;
    const args = [resolve(repoRoot, "dist/swarm.js"), task, "--flat", "--agents", String(AGENTS), "--openrouter", String(AGENTS - 1), "--openrouter-models", MODEL, "--verifier-openrouter", MODEL, "--timeout", String(TIMEOUT), "--cwd", CWD, "--port", PORT];
    if (FULL) args.push("--full-access");
    const child = spawn(process.execPath, args, { cwd: repoRoot, env: process.env, stdio: ["ignore", "pipe", "pipe"] });
    children.push(child);
    const logFile = resolve(OUT, `${area.id}.log`);
    let buf = "";
    let swarmId: string | undefined;
    let rateLimited = 0;
    const exits: string[] = [];
    const onData = (d: Buffer) => {
      const text = String(d);
      buf += text;
      for (const line of text.split("\n")) {
        const m = /swarm (swarm-[0-9]{6}-[a-z0-9]{4}):/.exec(line);
        if (m && !swarmId) {
          swarmId = m[1];
          log(`${area.id} → ${swarmId}`);
        }
        if (/rate-limited|429/.test(line)) rateLimited++;
        const ex = /^\S*\s(\S+) exited \((\S+)\)/.exec(line.replace(/\x1b\[[0-9;]*m/g, ""));
        if (ex) exits.push(`${ex[1]}:${ex[2]}`);
        if (/CONSENSUS REACHED|NO CONSENSUS|timeout after|provider error|rate-limited/.test(line)) log(`${area.id}: ${line.replace(/\x1b\[[0-9;]*m/g, "").slice(0, 140)}`);
      }
    };
    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);
    child.on("close", (code) => {
      writeFileSync(logFile, buf);
      let conclusion = "";
      let verdict = "";
      let reportPath: string | undefined;
      if (swarmId) {
        reportPath = resolve(repoRoot, "swarms", swarmId, "report.md");
        if (existsSync(reportPath)) {
          const report = readFileSync(reportPath, "utf8");
          conclusion = (/## Final answer[^\n]*\n\n([\s\S]*?)\n\n## /.exec(report)?.[1] ?? "").trim();
          verdict = (/## Verifier[^\n]*\n\n([\s\S]*?)\n\n## /.exec(report)?.[1] ?? "").trim();
        }
      }
      log(`${area.id} finished (exit ${code}${rateLimited ? `, ${rateLimited} rate-limit lines` : ""})`);
      res({ area, swarmId, exitCode: code, conclusion, verdict, rateLimited, exits, reportPath });
    });
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const running: Promise<Result>[] = [];
for (const [i, area] of areas.entries()) {
  if (i) await sleep(STAGGER * 1000);
  log(`launching ${area.id}: ${area.title}`);
  running.push(runArea(area).then((r) => (results.push(r), r)));
}
await Promise.all(running);

const concluded = results.filter((r) => r.exitCode === 0 && r.conclusion);
const summary = [
  `# ${FLEET_ID}`,
  "",
  `${areas.length} runs × ${AGENTS} seats on ${MODEL}; ${concluded.length} concluded, ${results.length - concluded.length} did not.`,
  "",
  ...results.map((r) =>
    [
      `## ${r.area.id}: ${r.area.title}`,
      "",
      `Run: ${r.swarmId ?? "(never started)"} · exit ${r.exitCode} · ${r.exits.filter((e) => !/:0$/.test(e)).length} abnormal exit(s)${r.rateLimited ? ` · ${r.rateLimited} rate-limit lines` : ""}${r.reportPath ? ` · report: ${r.reportPath.replace(repoRoot + "/", "")}` : ""}`,
      "",
      r.conclusion ? `### Conclusion\n\n${r.conclusion}` : "### No conclusion",
      "",
      r.verdict ? `### Verifier\n\n${r.verdict}` : "",
      "",
    ].join("\n"),
  ),
].join("\n");
writeFileSync(resolve(OUT, "summary.md"), summary);
log(`fleet done: ${concluded.length}/${results.length} concluded; ${OUT}/summary.md`);

if (CONSOLIDATE) {
  // The rooms never saw each other. A consolidation room reads every conclusion (this fleet's and any earlier
  // summaries named) and merges them into one ranked consensus with the contradictions between areas named,
  // so the maintainer builds from one document with one decision record instead of twelve.
  const inputs = [...CONSOLIDATE_FROM.map((f) => readFileSync(resolve(f), "utf8")), ...(results.length ? [summary] : [])];
  const digest = inputs
    .map((t) => t.replace(/\n### Verifier[\s\S]*?(?=\n## |$)/g, "\n"))
    .join("\n\n---\n\n")
    .slice(0, 60_000);
  const consolidationFile = resolve(OUT, "consolidation-input.md");
  writeFileSync(consolidationFile, digest);
  const task = `CONSOLIDATE THE FLEET. Rooms in a fleet of self-improvement swarms each concluded a ranked list for one area of this repository; they never saw each other. Their conclusions are in ${consolidationFile.replace(repoRoot + "/", "")} (read it with read_file; it is the only input that matters, the reports it names are under swarms/). Produce ONE ranked list across all areas: merge duplicates (name which areas raised each item), drop anything whose evidence does not hold when you check it against the code (file:line) or the transcripts, name every contradiction between areas and resolve it or mark it open, and keep for each item: what to change, the evidence, how to build it, where it belongs (enforce-in-hub | seat-side | launcher | prompt-only | docs), cost, and which areas proposed it. Rank by impact on convergence quality, correctness and context cost. This run is READ-ONLY. Someone other than the proposer challenges the weakest claim; the verifier reproduces the top five items before agreeing and ends with a DECISION RECORD. Never pkill or killall.`;
  log(`consolidating ${inputs.length} summary file(s) (${digest.length} chars) in one more run`);
  const r = await new Promise<Result>((res) => {
    const args = [resolve(repoRoot, "dist/swarm.js"), task, "--flat", "--agents", String(AGENTS), "--openrouter", String(AGENTS - 1), "--openrouter-models", MODEL, "--verifier-openrouter", MODEL, "--timeout", String(TIMEOUT), "--cwd", CWD, "--port", PORT];
    const child = spawn(process.execPath, args, { cwd: repoRoot, env: process.env, stdio: ["ignore", "pipe", "pipe"] });
    children.push(child);
    let buf = "";
    let swarmId: string | undefined;
    const onData = (d: Buffer) => {
      buf += String(d);
      const m = /swarm (swarm-[0-9]{6}-[a-z0-9]{4}):/.exec(String(d));
      if (m && !swarmId) log(`consolidation → ${m[1]}`), (swarmId = m[1]);
    };
    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);
    child.on("close", (code) => {
      writeFileSync(resolve(OUT, "consolidation.log"), buf);
      const reportPath = swarmId ? resolve(repoRoot, "swarms", swarmId, "report.md") : undefined;
      const report = reportPath && existsSync(reportPath) ? readFileSync(reportPath, "utf8") : "";
      res({ area: { id: "consolidation", title: "Consolidation", brief: "" }, swarmId, exitCode: code, conclusion: (/## Final answer[^\n]*\n\n([\s\S]*?)\n\n## /.exec(report)?.[1] ?? "").trim(), verdict: (/## Verifier[^\n]*\n\n([\s\S]*?)\n\n## /.exec(report)?.[1] ?? "").trim(), rateLimited: 0, exits: [], reportPath });
    });
  });
  writeFileSync(resolve(OUT, "consolidated.md"), `# ${FLEET_ID}: consolidated consensus\n\nRun: ${r.swarmId ?? "?"} · exit ${r.exitCode}${r.reportPath ? ` · ${r.reportPath.replace(repoRoot + "/", "")}` : ""}\n\n${r.conclusion || "_no consensus_"}\n\n## Verifier\n\n${r.verdict}\n`);
  log(`consolidation ${r.exitCode === 0 && r.conclusion ? "concluded" : "did not conclude"}: ${OUT}/consolidated.md`);
  process.exit(r.exitCode === 0 && r.conclusion ? 0 : 1);
}
process.exit(concluded.length === results.length ? 0 : 1);
