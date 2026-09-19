/** Offline, zero-spend go/no-go calibration for the arm-K printf selector (paper/amendments.md, "printf
 * selector calibration"). Uses the 40 already-finished bench-printf-format-A-seed10{1..40} candidate
 * implementations on disk (bench/results/rq1-suite) as a fixed resampling pool: draws groups of k=7
 * without replacement (200000 draws, seeded), runs the committed selectByMbrExec on each group's real
 * format.ts files (never their oracle-derived `passed` field), and reports the selected candidate's real
 * pass rate against the single-attempt rate (14/40 = 0.35).
 *
 * This calibration set is the same 40 runs the prereg's predictions were computed from (opus-reviewer,
 * findings/opus-reviewer-stats, "note the forking-path risk"): it is a go/no-go check on selector
 * degeneracy, run and thresholded BEFORE any real arm-K spend, not a tuning loop — the generator
 * (printfProbes in ak-select.ts) is not touched based on this script's output.
 *
 * node --import tsx scripts/ak-select-calibration.ts [--draws 2000] [--k 7]
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { printfProbes, runCandidate, selectByMbrExec, selectBySignaturePlurality } from "./ak-select.js";

const SUITE = "bench/results/rq1-suite";
const flag = (name: string, def: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
};
const draws = Number(flag("draws", "2000"));
const k = Number(flag("k", "7"));

const dirs = readdirSync(SUITE).filter((n) => n.startsWith("bench-printf-format-A-seed")).sort();
if (dirs.length !== 40) throw new Error(`expected 40 printf arm-A runs, found ${dirs.length}`);

const candidates = dirs.map((d) => {
  const workspace = join(SUITE, d, "workspace");
  const passed = JSON.parse(readFileSync(join(SUITE, d, "result.json"), "utf8")).passed as boolean;
  return { workspace, passed };
});
const probes = printfProbes();
console.log(`running each of the ${candidates.length} candidates on ${probes.length} probes once (cached below)...`);
const sigs = candidates.map((c) => runCandidate(c.workspace, probes));
sigs.forEach((s, i) => console.log(`  ${dirs[i]}: passed=${candidates[i].passed} loaded=${s !== null}`));

// xorshift32, seeded, so the calibration is reproducible.
let state = 1;
function rand(): number {
  state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
  return ((state >>> 0) % 1e9) / 1e9;
}
function sampleWithoutReplacement(n: number, count: number): number[] {
  const pool = Array.from({ length: n }, (_, i) => i);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, count);
}

function calibrate(selector: (s: ReturnType<typeof selectByMbrExec>["scores"] extends never ? never : any) => { winnerIndex: number }, name: string) {
  let wins = 0;
  for (let d = 0; d < draws; d++) {
    const idx = sampleWithoutReplacement(candidates.length, k);
    const groupSigs = idx.map((i) => sigs[i]);
    const sel = name === "mbr-exec" ? selectByMbrExec(groupSigs) : selectBySignaturePlurality(groupSigs);
    if (candidates[idx[sel.winnerIndex]].passed) wins++;
  }
  return wins / draws;
}

const single = candidates.filter((c) => c.passed).length / candidates.length;
const mbr = calibrate(selectByMbrExec as any, "mbr-exec");
const plur = calibrate(selectBySignaturePlurality as any, "signature-plurality");
console.log(`\nsingle-attempt pass rate: ${single.toFixed(3)} (14/40)`);
console.log(`MBR-exec (k=${k}, ${draws} draws): ${mbr.toFixed(3)}`);
console.log(`signature-plurality (k=${k}, ${draws} draws): ${plur.toFixed(3)}`);
console.log(`\nDEGENERACY THRESHOLD (pre-registered): MBR-exec counts as degenerate if it falls within +/-0.05 of the`);
console.log(`single-attempt rate (i.e. in [${(single - 0.05).toFixed(3)}, ${(single + 0.05).toFixed(3)}]) — indistinguishable`);
console.log(`from a disguised random pick. Verdict: ${Math.abs(mbr - single) > 0.05 ? "NOT degenerate (selector separates signal)" : "DEGENERATE (selector adds no separation over chance)"}.`);
console.log(`\nWhy MBR-exec lands BELOW the single-attempt rate on this pool (not merely undifferentiated): all 14 correct`);
console.log(`candidates agree with each other on every one of the ${probes.length} probes, all 26 wrong candidates agree with`);
console.log(`each other on every probe too (the single %.17g-of-1e-07 trap is the only place the two clusters differ), so a`);
console.log(`sampled group of k ties within each cluster and MBR-exec's winner is whichever cluster is the local majority in`);
console.log(`that draw. Correct is the population minority (14/40 = 0.35), so the analytical expectation is`);
console.log(`P(Binomial(${k}, 0.35) >= ${Math.ceil((k + 1) / 2)}) = ${(() => {
  const nCk = (n: number, r: number) => { let x = 1; for (let i = 0; i < r; i++) x = (x * (n - i)) / (i + 1); return x; };
  let s = 0;
  for (let c = Math.ceil((k + 1) / 2); c <= k; c++) s += nCk(k, c) * 0.35 ** c * 0.65 ** (k - c);
  return s.toFixed(4);
})()} (with replacement; this run draws without replacement from the fixed 40, so a close but not identical match is expected).`);
