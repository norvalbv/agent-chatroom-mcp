/** Offline replay of disagreement adjudication on the retained arm-K printf pools (bench/results/rq1-arm-k).
 *
 * MBR-exec picks the attempt that agrees with the most others, so when the wrong build is the common one it
 * loses (paper/sections/results.tex: K 7/40 selected of a 37/40 ceiling). Adjudication instead finds the probes
 * the group's attempts disagree on and settles each one against the public spec. Each disputed probe is shown to
 * a judge that sees only public/README.md, the format string, the args and the distinct outputs, never which
 * attempt produced them or how many did. The attempt matching the most verdicts wins; ties go to MBR.
 *
 * Verdicts are cached in bench/results/adjudication-replay/verdicts.json, so a replay with the cache committed is
 * deterministic and costs nothing. Oracle `passed` fields are read only to score the result, never to select.
 *
 *   node --import tsx scripts/adjudication-replay.ts --stats          # disputes only, zero spend
 *   node --import tsx scripts/adjudication-replay.ts --judge sonnet   # fill missing verdicts via claude -p
 *   node --import tsx scripts/adjudication-replay.ts                  # replay from the cache
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Probe, printfProbes, runCandidate, selectByMbrExec, type Signature } from "./ak-select.js";

const POOL = "bench/results/rq1-arm-k";
const OUT = "bench/results/adjudication-replay";
// 280 attempts x 9650 probes is ~100 MB of outputs: cached outside the repo, recomputed (~4 min) when absent.
const SIG_CACHE = join(tmpdir(), "adjudication-replay-signatures.json");
const VERDICTS = join(OUT, "verdicts.json");
const README = "tasks/bench-printf-format/public/README.md";

const flag = (name: string) => process.argv.includes(`--${name}`);
const opt = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const judgeModel = opt("judge");
const repeats = Number(opt("repeats") ?? "1");
// Sensitivity: score using only each dispute's first N cached votes (e.g. --use-votes 1 for a single-shot judge).
const useVotes = Number(opt("use-votes") ?? "Infinity");

mkdirSync(OUT, { recursive: true });
const probes = printfProbes();
const groups = readdirSync(POOL).filter((n) => n.startsWith("bench-printf-format-K-seed")).sort();

type Group = { name: string; attempts: { sig: Signature; passed: boolean }[] };
const sigCache: Record<string, Signature> = existsSync(SIG_CACHE) ? JSON.parse(readFileSync(SIG_CACHE, "utf8")) : {};
const data: Group[] = groups.map((g) => {
  const dir = join(POOL, g);
  const attempts = readdirSync(dir).filter((n) => n.startsWith("attempt-")).sort((a, b) => Number(a.slice(8)) - Number(b.slice(8)));
  return {
    name: g,
    attempts: attempts.map((a) => {
      const ws = join(dir, a, "workspace");
      const key = `${g}/${a}`;
      if (!(key in sigCache)) sigCache[key] = existsSync(join(ws, "format.ts")) ? runCandidate(ws, probes) : null;
      const passed = JSON.parse(readFileSync(join(dir, a, "result.json"), "utf8")).passed === true;
      return { sig: sigCache[key], passed };
    }),
  };
});
writeFileSync(SIG_CACHE, JSON.stringify(sigCache));

/** Probe indices where the group's loaded attempts do not all return the same output. */
function disputed(sigs: Signature[]): number[] {
  const live = sigs.filter((s): s is string[] => s !== null);
  const out: number[] = [];
  for (let p = 0; p < probes.length; p++) if (live.some((s) => s[p] !== live[0][p])) out.push(p);
  return out;
}

const verdictKey = (p: number, outputs: string[]) => JSON.stringify([probes[p], [...outputs].sort()]);
const verdicts: Record<string, { pick: string | null; votes: (string | null)[] }> = existsSync(VERDICTS) ? JSON.parse(readFileSync(VERDICTS, "utf8")) : {};

const describeArg = (a: Probe["args"][number]) =>
  typeof a === "object" ? ("n" in a ? `${a.n}n (bigint)` : { nan: "NaN", inf: "Infinity", "-inf": "-Infinity", "-0": "-0" }[a.special]) : JSON.stringify(a);
const show = (o: string) => (o === "throw" ? "(throws an error)" : JSON.stringify(o.slice(3)));

/** Strict plurality of the judge's votes; a tie (e.g. 2-2) is no verdict, so it cannot favour either cluster. */
function pickOf(votes: (string | null)[]): string | null {
  const tally = new Map<string | null, number>();
  for (const v of votes) tally.set(v, (tally.get(v) ?? 0) + 1);
  const ranked = [...tally.entries()].sort((a, b) => b[1] - a[1]);
  return ranked.length > 1 && ranked[0][1] === ranked[1][1] ? null : ranked[0][0];
}

async function askJudge(p: number, outputs: string[]): Promise<string | null> {
  const readme = readFileSync(README, "utf8");
  const options = outputs.map((o, i) => `${String.fromCharCode(65 + i)}: ${show(o)}`).join("\n");
  const prompt = `You are checking implementations of the formatter specified below. They disagree on one call.\n\n<spec>\n${readme}\n</spec>\n\nCall: format(${JSON.stringify(probes[p].fmt)}, ${probes[p].args.map(describeArg).join(", ")})\n\nCandidate results:\n${options}\n\nWork out from the spec (and C printf semantics where the spec defers to them) exactly what this call must return. Reply with your reasoning, then a final line "ANSWER: <letter>" naming the correct candidate, or "ANSWER: NONE" if none is correct.`;
  const stdout = await new Promise<string>((res) => {
    const c = spawn("claude", ["-p", "--model", judgeModel as string, "--tools", "", "--disable-slash-commands", "--setting-sources", "project"]);
    let buf = "";
    c.stdout.on("data", (d) => (buf += d));
    c.on("close", () => res(buf));
    c.stdin.end(prompt);
  });
  const m = /ANSWER:\s*([A-Z]+)\s*$/m.exec(stdout);
  if (!m || m[1] === "NONE") return null;
  const i = m[1].charCodeAt(0) - 65;
  return i >= 0 && i < outputs.length ? outputs[i] : null;
}

let dispTotal = 0;
const needed = new Map<string, [number, string[]]>();
for (const g of data) {
  const sigs = g.attempts.map((a) => a.sig);
  const d = disputed(sigs);
  dispTotal += d.length;
  for (const p of d) {
    const outs = [...new Set(sigs.filter((s): s is string[] => s !== null).map((s) => s[p]))];
    needed.set(verdictKey(p, outs), [p, outs]);
  }
}
console.log(`groups=${data.length} disputed probe-instances=${dispTotal} distinct disputes=${needed.size} cached verdicts=${[...needed.keys()].filter((k) => k in verdicts).length}`);

if (flag("stats")) {
  const byProbe = [...needed.values()].map(([p, outs]) => `${probes[p].fmt} ${JSON.stringify(probes[p].args)} -> ${outs.map(show).join(" | ")}`);
  for (const line of byProbe.slice(0, 60)) console.log(`  ${line}`);
  process.exit(0);
}

if (judgeModel) {
  const todo = [...needed].filter(([k]) => !(k in verdicts && verdicts[k].votes.length >= repeats));
  const run = async ([k, [p, outs]]: (typeof todo)[number]) => {
    const votes = verdicts[k]?.votes ?? [];
    const asks: Promise<string | null>[] = [];
    // Alternate the option order so a judge with a position bias cannot look consistent.
    for (let i = votes.length; i < repeats; i++) asks.push(askJudge(p, i % 2 ? [...outs].reverse() : outs));
    votes.push(...(await Promise.all(asks)));
    const pick = pickOf(votes);
    verdicts[k] = { pick, votes };
    writeFileSync(VERDICTS, JSON.stringify(verdicts, null, 1));
    console.log(`  judged ${probes[p].fmt} ${JSON.stringify(probes[p].args)}: ${pick === null ? "NONE" : show(pick)} (${votes.map((v) => (v === null ? "NONE" : show(v))).join(", ")})`);
  };
  const width = Number(opt("parallel") ?? "6");
  for (let i = 0; i < todo.length; i += width) await Promise.all(todo.slice(i, i + width).map(run));
}

let mbrPass = 0;
let adjPass = 0;
let ceiling = 0;
let missing = 0;
// Scoring only: the output that oracle-passing attempts give on each disputed probe, to report the judge's accuracy.
const truth = new Map<string, string>();
for (const g of data) {
  const sigs = g.attempts.map((a) => a.sig);
  const mbr = selectByMbrExec(sigs);
  const d = disputed(sigs);
  const outsAt = (p: number) => [...new Set(sigs.filter((s): s is string[] => s !== null).map((s) => s[p]))];
  const right = g.attempts.find((a) => a.passed && a.sig !== null)?.sig;
  if (right) for (const p of d) truth.set(verdictKey(p, outsAt(p)), right[p]);
  const score = sigs.map((s) => {
    if (s === null) return -1;
    let n = 0;
    for (const p of d) {
      const v = verdicts[verdictKey(p, outsAt(p))];
      const pick = v ? pickOf(v.votes.slice(0, useVotes)) : null;
      if (!v) missing++;
      else if (pick !== null && s[p] === pick) n++;
    }
    return n;
  });
  const best = Math.max(...score);
  const tied = score.map((s, i) => (s === best ? i : -1)).filter((i) => i >= 0);
  const winner = tied.sort((a, b) => (mbr.scores[b] ?? -1) - (mbr.scores[a] ?? -1) || a - b)[0];
  if (g.attempts[mbr.winnerIndex].passed) mbrPass++;
  if (g.attempts[winner].passed) adjPass++;
  if (g.attempts.some((a) => a.passed)) ceiling++;
}
console.log(`MBR-exec ${mbrPass}/${data.length}  adjudication ${adjPass}/${data.length}  oracle ceiling ${ceiling}/${data.length}${missing ? `  (missing verdicts: ${missing} probe-instances scored as no-match)` : ""}`);
const judged = [...truth].filter(([k]) => k in verdicts);
const votes = judged.flatMap(([k, t]) => verdicts[k].votes.slice(0, useVotes).map((v) => v === t));
const picks = judged.map(([k, t]) => pickOf(verdicts[k].votes.slice(0, useVotes)));
const right = picks.filter((p, i) => p === judged[i][1]).length;
const none = picks.filter((p) => p === null).length;
console.log(`judge: single votes correct ${votes.filter(Boolean).length}/${votes.length}; verdicts ${right} correct, ${none} no verdict (tie/NONE), ${picks.length - right - none} wrong, of ${picks.length}`);
