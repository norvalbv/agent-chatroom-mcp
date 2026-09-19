/**
 * Prose-number audit for paper/sections/*.tex (paper/figures.md: no hand-typed numbers). Tables and figures are
 * checked by paper/regen.sh's diff; this checks the numbers typed into running text. Every decimal (0.059,
 * 1.000), every fraction (33/40) and every percentage in a section must occur in at least one committed source
 * file: a generated table/JSON, a bench/results table, or the pre-registration/amendment record that fixed a
 * design constant. A decimal matches a source number that rounds to it at the prose's precision (prose 0.069
 * matches a source 0.0691650...). Bare integers are not checked (too many are section numbers, seeds, years).
 *
 * Usage: node --import tsx scripts/paper-number-audit.ts   (exit 1 and a list of residue on failure)
 */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(import.meta.url), "../..");

export const SOURCES = [
  "paper/generated",
  "paper/tables",
  "bench/results/rq1-suite/rq1-table.md",
  "bench/results/rq1-arm-k/rq1-armk-table.md",
  "paper/prereg-arm-k.md",
  "paper/amendments.md",
  "paper/protocol.md",
  "paper/budget.md",
  "paper/figures.md",
  "docs/token-round-0918.md",
  "docs/review-round-0918.md",
  "tasks/SUITE.json",
];

function readTree(path: string): string[] {
  const abs = join(ROOT, path);
  if (!existsSync(abs)) return [];
  if (!abs.endsWith(".md") && !abs.endsWith(".json") && !abs.endsWith(".tex") && !abs.includes(".")) {
    return readdirSync(abs).filter((f) => /\.(md|json|tex)$/.test(f)).map((f) => readFileSync(join(abs, f), "utf8"));
  }
  return [readFileSync(abs, "utf8")];
}

/** Strip LaTeX comments, \label/\ref/\cite arguments, and file paths so their digits are not audited. */
export function proseOf(tex: string): string {
  return tex
    .split("\n")
    .map((l) => l.replace(/(^|[^\\])%.*$/, "$1"))
    .join("\n")
    .replace(/\\(label|ref|cite[tp]?|citeauthor|input|includegraphics|texttt|url|href)(\[[^\]]*\])?\{[^}]*\}/g, " ")
    .replace(/arXiv:\S+/g, " ")
    .replace(/\{,\}/g, "")
    .replace(/\\,/g, "");
}

export function proseNumbers(prose: string): string[] {
  const found = new Set<string>();
  for (const m of prose.matchAll(/(?<![\w.])(\d+\/\d+)(?![\w/])/g)) found.add(m[1]);
  // "19 of 40" is the same claim as 19/40 and gets the same check.
  for (const m of prose.matchAll(/(?<![\w.])(\d+)\s+(?:of|out of)\s+(\d+)(?![\w.])/g)) found.add(`${m[1]}/${m[2]}`);
  for (const m of prose.matchAll(/(?<![\w./])(\d*\.\d+)(?![\w.]|\s*\\?%)/g)) found.add(m[1]);
  for (const m of prose.matchAll(/(?<![\w.])(\d+(?:\.\d+)?)\s*\\?%/g)) found.add(`${m[1]}%`);
  return [...found];
}

/** Numeric values that sit together in one JSON object: {exceed_count: 19, paired_n: 40} supports "19 of 40". */
export function jsonNumberSets(texts: string[]): Set<number>[] {
  const sets: Set<number>[] = [];
  const walk = (v: unknown): void => {
    if (Array.isArray(v)) return v.forEach(walk);
    if (v && typeof v === "object") {
      const vals = Object.values(v);
      sets.push(new Set(vals.filter((x): x is number => typeof x === "number")));
      vals.forEach(walk);
    }
  };
  for (const t of texts) {
    try {
      walk(JSON.parse(t));
    } catch {
      // not JSON
    }
  }
  return sets;
}

export function sourceHas(num: string, sourceText: string, sourceDecimals: number[], pairs: Set<number>[] = []): boolean {
  if (num.endsWith("%")) {
    const v = Number(num.slice(0, -1)) / 100;
    const places = (num.slice(0, -1).split(".")[1]?.length ?? 0) + 2;
    return sourceText.includes(num.replace("\\", "")) || sourceDecimals.some((d) => Math.abs(d - v) < 0.5 * 10 ** -places + 1e-12);
  }
  if (num.includes("/")) {
    const [a, b] = num.split("/");
    // "33/40", "33 / 40", "33 of 40" and "33 of the 40" are the same count in a source, and a failure count is
    // the complement of a pass count (34 of 40 failing is 6/40 passing).
    const has = (x: number) => new RegExp(`(?<![\\w.])${x}\\s*(/|of(\\s+the)?)\\s*${b}(?![\\w])`).test(sourceText);
    const inObject = (x: number) => pairs.some((set) => set.has(x) && set.has(Number(b)));
    return has(Number(a)) || has(Number(b) - Number(a)) || inObject(Number(a)) || inObject(Number(b) - Number(a));
  }
  const places = num.split(".")[1].length;
  const v = Number(num);
  return sourceDecimals.some((d) => Math.abs(d - v) < 0.5 * 10 ** -places + 1e-12);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const sourceTexts = SOURCES.flatMap(readTree);
  const sourceText = sourceTexts.join("\n");
  const pairs = jsonNumberSets(sourceTexts);
  const sourceDecimals = [...sourceText.matchAll(/-?\d*\.\d+(?:e-?\d+)?/g)].map((m) => Number(m[0]));
  // Fractions in sources also stand for their decimal value (a table's 36/40 supports prose 0.90).
  for (const m of sourceText.matchAll(/(?<![\w.])(\d+)\s*\/\s*(\d+)(?![\w])/g)) {
    if (Number(m[2]) > 0) sourceDecimals.push(Number(m[1]) / Number(m[2]));
  }
  const dir = join(ROOT, "paper/sections");
  let residue = 0;
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".tex")).sort()) {
    const nums = proseNumbers(proseOf(readFileSync(join(dir, f), "utf8")));
    const missing = nums.filter((n) => !sourceHas(n, sourceText, sourceDecimals, pairs));
    for (const n of missing) console.log(`${f}: ${n}`);
    residue += missing.length;
  }
  if (residue) {
    console.error(`FAIL: ${residue} prose number(s) not found in any committed source (${SOURCES.join(", ")}).`);
    process.exit(1);
  }
  console.error("OK: every prose decimal, fraction and percentage occurs in a committed source.");
}
