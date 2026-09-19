/** Oracle-free selection for arm K (paper/amendments.md, "Arm K - settled definition").
 * Nothing here takes a task directory: candidates are attempt workspaces, and probe inputs are generated
 * from the task's PUBLIC spec (README.md, argument classes) so oracle/ and fixtures/ are never read.
 * Primary for code tasks: MBR-exec (arXiv:2204.11454). Exploratory secondary: plurality of whole execution
 * signatures (self-consistency, arXiv:2203.11171, applied to CodeT-style agreement classes, arXiv:2207.10397).
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export type Probe = { fmt: string; args: (number | string | { n: string })[] };
/** One string per probe, or null when the candidate could not be loaded/run at all (no vote). */
export type Signature = string[] | null;

const FLAG_SETS = ["", "-", "+", " ", "0", "#", "-+", "+0", "#0", " 0"];

/** Probe inputs derived only from public/README.md: every conversion x flag set x width x precision over the
 * value classes the README allows. Deterministic, ~1.5k probes. */
export function printfProbes(): Probe[] {
  const out: Probe[] = [];
  const ints = [0, 1, -1, 7, 42, -42, 255, 9007199254740991, -9007199254740991, { n: "12345678901234567890" }];
  const nonneg = [0, 1, 8, 255, 4096, 9007199254740991, { n: "18446744073709551615" }];
  const floats = [0, -0, 0.5, 1.5, 2.5, 0.125, 2.675, 0.1, 1e-7, 1e-5, 123456789.123, 1e21, 1e100, 5e-324, Infinity, -Infinity, NaN];
  const widths = ["", "1", "8", "20"];
  const precs = ["", ".", ".0", ".3", ".17"];
  const add = (conv: string, values: unknown[], flagSets: string[], ws: string[], ps: string[]) => {
    for (const v of values) for (const f of flagSets) for (const w of ws) for (const p of ps) out.push({ fmt: `[%${f}${w}${p}${conv}]`, args: [v as never] });
  };
  for (const c of ["d", "i"]) add(c, ints, FLAG_SETS.filter((f) => !f.includes("#")), widths, ["", ".0", ".5"]);
  for (const c of ["x", "X", "o"]) add(c, nonneg, ["", "-", "0", "#", "-#", "#0"], widths, ["", ".0", ".5"]);
  for (const c of ["e", "E", "f", "F", "g", "G"]) add(c, floats, ["", "-", "+", " ", "0", "#"], ["", "12"], precs);
  add("s", ["", "abc", "hello world"], ["", "-"], widths, ["", ".", ".2"]);
  add("c", ["a", " ", "%"], ["", "-"], widths, [""]);
  out.push({ fmt: "100%% of %d%% %s", args: [5, "x"] }, { fmt: "%d-%s-%c-%5.2f", args: [1, "a", "b", 3.14159] });
  return out;
}

// Absolute, so a workspace outside the repo (no node_modules above it) still loads the TypeScript candidate.
const tsxUrl = import.meta.resolve("tsx");

const DRIVER = `import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
const [entry, probeFile] = process.argv.slice(2);
const probes = JSON.parse(readFileSync(probeFile, "utf8"));
const mod = await import(pathToFileURL(entry).href);
const fn = mod.format;
if (typeof fn !== "function") { console.log(JSON.stringify(null)); process.exit(0); }
const conv = (a) => (a && typeof a === "object" ? BigInt(a.n) : a);
const res = probes.map((p) => { try { return "ok:" + String(fn(p.fmt, ...p.args.map(conv))); } catch (e) { return "throw"; } });
console.log(JSON.stringify(res));
`;

/** Run one candidate workspace's format.ts on the probes in a child process with a hard timeout. */
export function runCandidate(workspace: string, probes: Probe[], timeoutMs = 30000): Signature {
  const tmp = mkdtempSync(join(tmpdir(), "ak-probe-"));
  try {
    const driver = join(tmp, "driver.mjs");
    const probeFile = join(tmp, "probes.json");
    writeFileSync(driver, DRIVER);
    writeFileSync(probeFile, JSON.stringify(probes));
    const run = spawnSync(process.execPath, ["--import", tsxUrl, driver, join(workspace, "format.ts"), probeFile], { encoding: "utf8", timeout: timeoutMs, cwd: workspace, killSignal: "SIGKILL", maxBuffer: 1 << 26 });
    if (run.error || run.status !== 0) return null;
    const parsed = JSON.parse(run.stdout.trim().split("\n").pop() ?? "null");
    return Array.isArray(parsed) && parsed.length === probes.length ? (parsed as string[]) : null;
  } catch {
    return null;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

export interface Selection {
  rule: string;
  winnerIndex: number;
  scores: (number | null)[];
}

/** MBR-exec: a candidate's score is the number of (other candidate, probe) pairs on which its output equals
 * the other's (0/1 loss summed over probes). Highest wins; ties and the no-signal case break to the lowest index. */
export function selectByMbrExec(sigs: Signature[]): Selection {
  const scores = sigs.map((s, i) => (s === null ? null : sigs.reduce((sum, o, j) => (j === i || o === null ? sum : sum + s.reduce((n, v, p) => n + (v === o[p] ? 1 : 0), 0)), 0)));
  return { rule: "mbr-exec", winnerIndex: argmax(scores), scores };
}

/** Exploratory: plurality of whole signatures (all probes must agree); a candidate's score is its class size. */
export function selectBySignaturePlurality(sigs: Signature[]): Selection {
  const key = sigs.map((s) => (s === null ? null : JSON.stringify(s)));
  const scores = key.map((k) => (k === null ? null : key.filter((o) => o === k).length));
  return { rule: "signature-plurality", winnerIndex: argmax(scores), scores };
}

function argmax(scores: (number | null)[]): number {
  let best = -1;
  let idx = 0;
  scores.forEach((s, i) => {
    if (s !== null && s > best) {
      best = s;
      idx = i;
    }
  });
  return idx;
}
