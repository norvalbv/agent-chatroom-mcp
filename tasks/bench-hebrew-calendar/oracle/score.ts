/** Private deterministic oracle for bench-hebrew-calendar. Never copied into public/.
 * node --import tsx tasks/bench-hebrew-calendar/oracle/score.ts WORKSPACE
 * exit 0: all pass; exit 1: failure; exit 2: invocation error. Expected values come from ICU's Hebrew calendar
 * (see oracle/gen-cases.ts); Intl, child processes and other realms are removed before the submission loads.
 */
import cp from "node:child_process";
import { readFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import vm from "node:vm";
import wt from "node:worker_threads";
const here = dirname(fileURLToPath(import.meta.url));
const { cases } = JSON.parse(readFileSync(join(here, "cases.json"), "utf8")) as { cases: { g: number[]; h: number[] }[] };
const forbidden = () => { throw new Error("forbidden"); };
for (const k of ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"]) (cp as unknown as Record<string, unknown>)[k] = forbidden;
for (const k of ["runInNewContext", "runInContext", "runInThisContext", "compileFunction", "createContext"]) (vm as unknown as Record<string, unknown>)[k] = forbidden;
(vm as unknown as Record<string, unknown>).Script = forbidden;
(wt as unknown as Record<string, unknown>).Worker = forbidden;
syncBuiltinESMExports();
delete (globalThis as Record<string, unknown>).Intl;
for (const k of ["toLocaleDateString", "toLocaleString", "toLocaleTimeString"]) delete (Date.prototype as unknown as Record<string, unknown>)[k];
const workspace = process.argv[2];
if (!workspace) {
  console.error("usage: score.ts WORKSPACE");
  process.exit(2);
}
const oracle_results: { name: string; exit_code: number }[] = [];
try {
  const source = readFileSync(join(resolve(workspace), "hebrew.ts"), "utf8");
  if (/Intl|toLocale|child_process|execSync|spawnSync|\bspawn\(|node:(util|vm|worker_threads|module|process)|require\(|\bimport\s*\(|process\.(binding|getBuiltinModule)/.test(source)) throw new Error("forbidden");
  const { toHebrew } = await import(pathToFileURL(join(resolve(workspace), "hebrew.ts")).href);
  if (typeof toHebrew !== "function") throw new Error("no toHebrew");
  cases.forEach((c, i) => {
    let ok = false;
    try {
      const r = toHebrew(c.g[0], c.g[1], c.g[2]);
      ok = r && r.year === c.h[0] && r.month === c.h[1] && r.day === c.h[2];
    } catch {}
    oracle_results.push({ name: `case-${String(i + 1).padStart(4, "0")}`, exit_code: ok ? 0 : 1 });
  });
} catch {
  oracle_results.push({ name: "artifact-load", exit_code: 1 });
}
const score = Number(oracle_results.length === cases.length && oracle_results.every((r) => r.exit_code === 0));
console.log(JSON.stringify({ score, oracle_results }));
process.exit(score === 1 ? 0 : 1);
