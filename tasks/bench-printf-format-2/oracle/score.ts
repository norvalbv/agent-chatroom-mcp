/** Private deterministic oracle for bench-printf-format-2. Never copied into public/.
 * node --import tsx tasks/bench-printf-format/oracle/score.ts WORKSPACE
 * exit 0: all pass; exit 1: failure; exit 2: invocation error. Expected values come from the C library printf.
 */
import cp from "node:child_process";
import { readFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
for (const k of ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"]) {
  (cp as unknown as Record<string, unknown>)[k] = () => {
    throw new Error("child processes are forbidden");
  };
}
syncBuiltinESMExports();
const workspace = process.argv[2];
if (!workspace) {
  console.error("usage: score.ts WORKSPACE");
  process.exit(2);
}
type Arg = number | string | { n: string } | { b: string };
const here = dirname(fileURLToPath(import.meta.url));
const cases = JSON.parse(readFileSync(join(here, "cases.json"), "utf8")) as { fmt: string; args: Arg[]; expected: string }[];
const decode = (a: Arg): number | bigint | string => (typeof a === "object" ? ("b" in a ? BigInt(a.b) : a.n === "-0" ? -0 : Number(a.n)) : a);
const oracle_results: { name: string; exit_code: number }[] = [];
try {
  const source = readFileSync(join(resolve(workspace), "format.ts"), "utf8");
  if (/child_process|execSync|spawnSync|\bspawn\(|node:(util|vm|worker_threads)|require\(|\bimport\s*\(/.test(source)) throw new Error("forbidden");
  const { format } = await import(pathToFileURL(join(resolve(workspace), "format.ts")).href);
  if (typeof format !== "function") throw new Error("no format");
  cases.forEach((c, i) => {
    let ok = false;
    try {
      ok = format(c.fmt, ...c.args.map(decode)) === c.expected;
    } catch {}
    oracle_results.push({ name: `case-${String(i + 1).padStart(4, "0")}`, exit_code: ok ? 0 : 1 });
  });
} catch {
  oracle_results.push({ name: "artifact-load", exit_code: 1 });
}
const score = Number(oracle_results.length === cases.length && oracle_results.every((r) => r.exit_code === 0));
console.log(JSON.stringify({ score, oracle_results }));
process.exitCode = score === 1 ? 0 : 1;
