/**
 * Step (c) of "settle disagreements against the spec, not by count": can a model, given only the task's public
 * README and ONE input on which two drafts disagree, pick the output the spec requires?
 *
 *   node --import tsx scripts/adjudicator-trial.ts [--n 5] [--model sonnet] [--out DIR] [--dry-run]
 *
 * Each case is asked n times in each presentation order (correct output as A, then as B), so a position bias
 * cannot pass for accuracy. The control case is the same input at %.16g, where the spec's answer is the SHORT
 * one ("1e-07"): a judge that always prefers the long exact-looking digits fails it. Expected outputs are the
 * C library's printf (`printf '%.17g\n' 1e-07`), independent of the oracle fixtures, which this never reads.
 */
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export type Case = { id: string; call: string; right: string; wrong: string };

export const CASES: Case[] = [
  { id: "g17-1e-7", call: 'format("%.17g", 1e-7)', right: "9.9999999999999995e-08", wrong: "1e-07" },
  { id: "g16-1e-7-control", call: 'format("%.16g", 1e-7)', right: "1e-07", wrong: "9.999999999999999e-08" },
];

export function buildPrompt(readme: string, c: Case, rightIsA: boolean): string {
  const [a, b] = rightIsA ? [c.right, c.wrong] : [c.wrong, c.right];
  return `Below is a specification.\n\n${readme.trimEnd()}\n\nTwo independent implementations of this spec disagree on exactly one input: ${c.call}.\nImplementation A outputs: ${a}\nImplementation B outputs: ${b}\nWhich output does the specification require? Reason from the spec text and exact arithmetic. End your answer with a final line of exactly FINAL: A or FINAL: B.\n`;
}

/** The last "FINAL: A|B" line wins; anything else is no verdict (counted as wrong, never dropped). */
export function parseVerdict(text: string): "A" | "B" | null {
  const m = [...text.matchAll(/^\s*\**FINAL:\s*([AB])\b/gm)];
  return m.length ? (m[m.length - 1][1] as "A" | "B") : null;
}

export function score(verdict: "A" | "B" | null, rightIsA: boolean): boolean {
  return verdict !== null && (verdict === "A") === rightIsA;
}

function ask(prompt: string, model: string): Promise<string> {
  return new Promise((done) => {
    const child = spawn("claude", ["-p", "--model", model, "--tools", ""], { stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("close", () => done(out));
    child.stdin.end(prompt);
  });
}

async function main() {
  const arg = (k: string, d: string) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
  const n = Number(arg("--n", "5"));
  const model = arg("--model", "sonnet");
  const out = resolve(arg("--out", join("bench/results/adjudicator", new Date().toISOString().replace(/[:.]/g, "-"))));
  const readme = readFileSync("tasks/bench-printf-format/public/README.md", "utf8");
  const jobs = CASES.flatMap((c) => [true, false].flatMap((rightIsA) => Array.from({ length: n }, (_, i) => ({ c, rightIsA, i }))));
  if (process.argv.includes("--dry-run")) { console.log(buildPrompt(readme, CASES[0], true)); console.log(`${jobs.length} trials`); return; }
  mkdirSync(out, { recursive: true });
  const rows = await Promise.all(jobs.map(async ({ c, rightIsA, i }) => {
    const text = await ask(buildPrompt(readme, c, rightIsA), model);
    const file = `${c.id}-${rightIsA ? "rightA" : "rightB"}-${i + 1}.txt`;
    writeFileSync(join(out, file), text);
    const verdict = parseVerdict(text);
    return { case: c.id, rightIsA, trial: i + 1, verdict, correct: score(verdict, rightIsA), file };
  }));
  const summary = Object.fromEntries(CASES.map((c) => {
    const r = rows.filter((x) => x.case === c.id);
    return [c.id, { correct: r.filter((x) => x.correct).length, of: r.length, noVerdict: r.filter((x) => x.verdict === null).length }];
  }));
  writeFileSync(join(out, "summary.json"), JSON.stringify({ model, n, summary, rows }, null, 2));
  console.log(JSON.stringify({ model, out, summary }));
}

if (import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
