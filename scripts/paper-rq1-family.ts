/**
 * Family-level statistics for the results section (paper/amendments.md, 2026-09-18 "swarm-150725-3vny-room":
 * "the statistical unit is the family, not the instance" — stamp-interpreter and stamp-2 share one
 * specification and mechanism (scope-capture) and must be pooled before testing; bench-printf-format is its
 * own family). This script adds exactly one thing rq1-table.md/rq1-arm-k-table.md do not already compute:
 * Fisher-exact (never the z-approximation, per the arm-K precedent in paper/amendments.md's "settled
 * definition" entry) A-vs-C tests pooled at the family level, Holm-Bonferroni across the two families
 * (m=2), plus the two exploratory family-pooled K numbers already reported in amendments.md (K vs C, K vs
 * A on the interpreter family; printf stays single-task since it is already one family). Every count is
 * read from bench/results/rq1-suite and bench/results/rq1-arm-k, never hand-typed; this script has no
 * literal pass/fail numbers in it.
 *
 * Usage: node --import tsx scripts/paper-rq1-family.ts SUITE_DIR ARM_K_DIR [--out PREFIX]
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { computeCell, loadRunResults, type RunResult } from "./paper-rq1-table.js";
import { buildArmKTable, loadKGroups } from "./paper-rq1-armk.js";
import { fisherExactTest, holmBonferroni } from "./rq1-stats.js";

/** paper/amendments.md, 2026-09-18: stamp-interpreter and stamp-2 are one family (byte-identical STAMP
 * specification, both scope-capture); bench-printf-format is its own family (libc-exact-number). */
export const FAMILIES: Record<string, string[]> = {
  "interpreter (stamp-interpreter + stamp-2)": ["stamp-interpreter", "stamp-2"],
  "printf (bench-printf-format)": ["bench-printf-format"],
};

export interface FamilyCell {
  family: string;
  arm: string;
  pass: number;
  fail: number;
  n: number;
}

export interface FamilyTest {
  family: string;
  a: FamilyCell;
  c: FamilyCell;
  test: "fisher";
  p_value: number | null;
  p_holm: number | null;
  significant_holm_0_05: boolean | null;
}

function poolCell(family: string, arm: string, taskIds: string[], runs: RunResult[]): FamilyCell {
  let pass = 0, fail = 0, n = 0;
  for (const t of taskIds) {
    const cell = computeCell(t, arm, runs.filter((r) => r.task_id === t && r.arm === arm));
    pass += cell.task_pass; fail += cell.task_fail; n += cell.n;
  }
  return { family, arm, pass, fail, n };
}

export function buildFamilyTests(runs: RunResult[]): FamilyTest[] {
  const tests: FamilyTest[] = [];
  for (const [family, taskIds] of Object.entries(FAMILIES)) {
    const a = poolCell(family, "A", taskIds, runs);
    const c = poolCell(family, "C", taskIds, runs);
    const f = fisherExactTest(a.pass, a.fail, c.pass, c.fail);
    tests.push({ family, a, c, test: "fisher", p_value: f.p_value, p_holm: null, significant_holm_0_05: null });
  }
  const pvals = tests.map((t) => t.p_value ?? 1);
  const adj = holmBonferroni(pvals);
  tests.forEach((t, i) => { t.p_holm = adj[i]; t.significant_holm_0_05 = adj[i] < 0.05; });
  return tests;
}

/** Exploratory (outside every pre-registered Holm family, per paper/amendments.md, "Arm K result" entry):
 * K pooled over the interpreter family (stamp-interpreter + stamp-2) vs C and vs A, same pooling. Printf is
 * already single-task so its arm-K row in rq1-arm-k-table.md is this number; not repeated here. */
export interface ExploratoryK {
  label: string;
  k: { pass: number; n: number };
  other: { pass: number; n: number };
  vs: "C" | "A";
  p_value: number | null;
}

export function buildExploratoryK(suiteRuns: RunResult[], kGroups: ReturnType<typeof loadKGroups>["groups"]): ExploratoryK[] {
  const interpTasks = FAMILIES["interpreter (stamp-interpreter + stamp-2)"];
  const kRows = interpTasks.map((t) => {
    const gs = kGroups.filter((g) => g.task_id === t && g.seed >= 101 && g.seed <= 140);
    return { task: t, pass: gs.filter((g) => g.passed).length, n: gs.length };
  });
  const kPass = kRows.reduce((a, r) => a + r.pass, 0);
  const kN = kRows.reduce((a, r) => a + r.n, 0);
  const out: ExploratoryK[] = [];
  for (const vs of ["C", "A"] as const) {
    const c = poolCell("interpreter", vs, interpTasks, suiteRuns);
    const f = fisherExactTest(kPass, kN - kPass, c.pass, c.fail);
    out.push({ label: "interpreter family, K pooled", k: { pass: kPass, n: kN }, other: { pass: c.pass, n: c.pass + c.fail }, vs, p_value: f.p_value });
  }
  return out;
}

function fmtP(n: number | null): string {
  return n === null ? "n/a" : n.toFixed(6);
}

export function renderMarkdown(tests: FamilyTest[], exploratory: ExploratoryK[], warnings: string[]): string {
  let md = "# RQ1 family-pooled statistics (generated, do not hand-edit)\n\n";
  md += "Statistical unit is the family, not the task (paper/amendments.md, 2026-09-18). Fisher exact, two-sided, ";
  md += "never the z-approximation (matches the arm-K precedent in paper/amendments.md's settled definition). ";
  md += "Holm-Bonferroni across the two families below (m=2), fixed before this script ran (one row per family, ";
  md += "the family list itself is fixed by the task-admission record, tasks/SUITE.json).\n\n";
  if (warnings.length) md += `**Warnings:**\n${warnings.map((w) => `- ${w}`).join("\n")}\n\n`;
  md += "## Arm A vs Arm C, family-pooled (primary RQ1 test)\n\n";
  md += "| family | A pass/n | C pass/n | Fisher p (raw) | Holm p (m=2) | significant (Holm, 0.05) |\n|---|---|---|---|---|---|\n";
  for (const t of tests) {
    md += `| ${t.family} | ${t.a.pass}/${t.a.n} | ${t.c.pass}/${t.c.n} | ${fmtP(t.p_value)} | ${fmtP(t.p_holm)} | ${t.significant_holm_0_05 ?? "n/a"} |\n`;
  }
  md += "\n## Arm K, family-pooled, exploratory (paper/amendments.md: \"outside the Holm family\" — reported, never used to override the pre-registered per-task arm-K family in bench/results/rq1-arm-k/rq1-armk-table.md)\n\n";
  md += "| comparison | K pass/n | other pass/n | vs | Fisher p (raw, not Holm-adjusted, not a test of this family) |\n|---|---|---|---|---|\n";
  for (const e of exploratory) md += `| ${e.label} | ${e.k.pass}/${e.k.n} | ${e.other.pass}/${e.other.n} | ${e.vs} | ${fmtP(e.p_value)} |\n`;
  return md;
}

async function main() {
  const argv = process.argv.slice(2);
  const suite = argv.shift(), armK = argv.shift();
  if (!suite || !armK) throw Error("Usage: paper-rq1-family.ts SUITE_DIR ARM_K_DIR [--out PREFIX]");
  let out: string | undefined;
  while (argv.length) {
    const opt = argv.shift();
    if (opt === "--out") out = argv.shift();
    else throw Error(`Unknown option ${opt}`);
  }
  const { runs, warnings: w1 } = loadRunResults(resolve(suite));
  const { groups, warnings: w2 } = loadKGroups(resolve(armK));
  const tests = buildFamilyTests(runs);
  const exploratory = buildExploratoryK(runs, groups);
  const md = renderMarkdown(tests, exploratory, [...w1, ...w2]);
  const prefix = resolve(out ?? join(resolve(suite), "rq1-family-table"));
  mkdirSync(dirname(prefix), { recursive: true });
  writeFileSync(`${prefix}.md`, md);
  writeFileSync(`${prefix}.json`, JSON.stringify({ tests, exploratory }, null, 2));
  console.log(md);
  console.error(`Wrote ${prefix}.md and ${prefix}.json`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(String(error)); process.exitCode = 1; });
}
