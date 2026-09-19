/**
 * Renders the results-section LaTeX tables straight from the same computations rq1-table.md,
 * rq1-arm-k-table.md and rq1-family-table.md already use (imports their functions, never re-derives
 * numbers by hand). Writes paper/tables/*.tex, each a bare `tabular` environment meant to be \input from
 * paper/sections/results.tex inside a `table`/`booktabs` wrapper (kept out of the generated file so the
 * caption/label/placement can be edited without regenerating).
 *
 * Usage: node --import tsx scripts/paper-rq1-tex.ts SUITE_DIR ARM_K_DIR [--out-dir paper/tables]
 */
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { computeCell, loadRunResults } from "./paper-rq1-table.js";
import { buildArmKTable, loadKGroups } from "./paper-rq1-armk.js";
import { buildExploratoryK, buildFamilyTests } from "./paper-rq1-family.js";

function esc(s: string): string {
  return s.replace(/_/g, "\\_");
}
function pct(n: number | null): string {
  return n === null ? "n/a" : `${(n * 100).toFixed(1)}\\%`;
}
function money(n: number | "undefined" | "unknown"): string {
  if (n === "undefined") return "undef.";
  if (n === "unknown") return "unknown";
  return `\\$${n.toFixed(2)}`;
}
function pnum(n: number | null, d = 4): string {
  return n === null ? "n/a" : n.toFixed(d);
}

const TASK_LABEL: Record<string, string> = {
  "stamp-interpreter": "stamp-interpreter",
  "stamp-2": "stamp-2",
  "bench-printf-format": "bench-printf-format",
};

function tablePerTask(suiteRuns: ReturnType<typeof loadRunResults>["runs"], kTable: ReturnType<typeof buildArmKTable>): string {
  const tasks = ["stamp-interpreter", "stamp-2", "bench-printf-format"];
  let tex = "\\begin{tabular}{llrrl}\n\\toprule\nTask & Arm & Pass/$n$ & Success rate & Cost/correct \\\\\n\\midrule\n";
  for (const task of tasks) {
    for (const arm of ["A", "C"] as const) {
      const cell = computeCell(task, arm, suiteRuns.filter((r) => r.task_id === task && r.arm === arm));
      tex += `${esc(TASK_LABEL[task])} & ${arm} & ${cell.task_pass}/${cell.success_denominator} & ${pct(cell.success_rate)} & ${money(cell.cost_per_correct)} \\\\\n`;
    }
    const kRow = kTable.tasks.find((t) => t.task === task);
    if (kRow) {
      const rate = kRow.k_groups ? kRow.k_pass / kRow.k_groups : null;
      tex += `${esc(TASK_LABEL[task])} & K & ${kRow.k_pass}/${kRow.k_groups} & ${pct(rate)} & ${money(kRow.cost_per_correct)} \\\\\n`;
    }
    tex += "\\addlinespace\n";
  }
  tex += "\\bottomrule\n\\end{tabular}\n";
  return tex;
}

function tableFamily(tests: ReturnType<typeof buildFamilyTests>): string {
  let tex = "\\begin{tabular}{lrrrrl}\n\\toprule\nFamily & A pass/$n$ & C pass/$n$ & Fisher $p$ (raw) & Holm $p$ ($m=2$) & Sig. \\\\\n\\midrule\n";
  for (const t of tests) {
    tex += `${esc(t.family)} & ${t.a.pass}/${t.a.n} & ${t.c.pass}/${t.c.n} & ${pnum(t.p_value, 6)} & ${pnum(t.p_holm, 6)} & ${t.significant_holm_0_05 ? "yes" : "no"} \\\\\n`;
  }
  tex += "\\bottomrule\n\\end{tabular}\n";
  return tex;
}

function tableArmK(kTable: ReturnType<typeof buildArmKTable>): string {
  let tex = "\\begin{tabular}{llrrrl}\n\\toprule\nTask & vs & K pass/$n$ & other pass/$n$ & Holm $p$ ($m=6$) & Sig. \\\\\n\\midrule\n";
  for (const row of kTable.tasks) {
    for (const c of row.comparisons) {
      tex += `${esc(TASK_LABEL[row.task] ?? row.task)} & ${c.vs} & ${c.k_pass}/${c.k_n} & ${c.other_pass}/${c.other_n} & ${pnum(c.p_holm, 6)} & ${c.significant_holm_0_05 ? "yes" : "no"} \\\\\n`;
    }
  }
  tex += "\\bottomrule\n\\end{tabular}\n";
  return tex;
}

function tableExploratory(exploratory: ReturnType<typeof buildExploratoryK>): string {
  let tex = "\\begin{tabular}{llrrr}\n\\toprule\nComparison & vs & K pass/$n$ & other pass/$n$ & Fisher $p$ (raw, exploratory) \\\\\n\\midrule\n";
  for (const e of exploratory) {
    tex += `${esc(e.label)} & ${e.vs} & ${e.k.pass}/${e.k.n} & ${e.other.pass}/${e.other.n} & ${pnum(e.p_value, 4)} \\\\\n`;
  }
  tex += "\\bottomrule\n\\end{tabular}\n";
  return tex;
}

function windowControlStatus(suiteDirRoot: string): string {
  const dir = join(suiteDirRoot, "..", "rq1-window-control");
  const target = 80; // 20 seeds x 2 arms x 2 tasks, per the room brief's control design
  const design = "design: 20 seeds (201--220) of arm C and arm K interleaved per seed on both interpreter tasks (\\texttt{bench/results/rq1-window-control}, log \\texttt{logs/rq1-window-control.log}), to test whether arm C's 40/40 on the interpreter family survives measurement in the same time window as arm K";
  const total = existsSync(dir) ? readdirSync(dir).filter((n) => existsSync(join(dir, n, "result.json"))).length : 0;
  if (total >= target) return `\\emph{Window control: complete, ${total}/${target} runs committed at generation time; ${design}.}\n`;
  return `\\emph{Window control: PENDING (${total}/${target} runs committed to this branch at generation time); ${design}. Not reported as a result until all ${target} land.}\n`;
}

async function main() {
  const argv = process.argv.slice(2);
  const suite = argv.shift(), armK = argv.shift();
  if (!suite || !armK) throw Error("Usage: paper-rq1-tex.ts SUITE_DIR ARM_K_DIR [--out-dir DIR]");
  let outDir = "paper/tables";
  while (argv.length) {
    const opt = argv.shift();
    if (opt === "--out-dir") outDir = argv.shift()!;
    else throw Error(`Unknown option ${opt}`);
  }
  const { runs } = loadRunResults(resolve(suite));
  const { groups } = loadKGroups(resolve(armK));
  const kTable = buildArmKTable(runs, groups);
  const familyTests = buildFamilyTests(runs);
  const exploratory = buildExploratoryK(runs, groups);

  const dir = resolve(outDir);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "results-per-task.tex"), tablePerTask(runs, kTable));
  writeFileSync(join(dir, "results-family.tex"), tableFamily(familyTests));
  writeFileSync(join(dir, "results-armk.tex"), tableArmK(kTable));
  writeFileSync(join(dir, "results-armk-exploratory.tex"), tableExploratory(exploratory));
  writeFileSync(join(dir, "window-control-status.tex"), windowControlStatus(resolve(suite)));
  console.error(`Wrote ${dir}/results-per-task.tex, results-family.tex, results-armk.tex, results-armk-exploratory.tex, window-control-status.tex`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(String(error)); process.exitCode = 1; });
}
