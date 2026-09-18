/** Private deterministic artifact oracle for bench-strtod. Expected values come from Python's float()/float.fromhex
 * under the README's prefix grammar and are cross-checked against the real libc strtod (see gen_cases.py).
 * node --import tsx tasks/bench-strtod/oracle/score.ts WORKSPACE
 * exit 0: all pass; exit 1: artifact failure; exit 2: invocation error.
 * Path separation is not a sandbox. Run untrusted code in a restricted process.
 */
import childProcess from 'node:child_process';
import { readFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const workspace = process.argv[2];
if (!workspace) {
  console.error('usage: score.ts WORKSPACE');
  process.exit(2);
}
const here = dirname(fileURLToPath(import.meta.url));
const cases = JSON.parse(readFileSync(join(here, 'cases.json'), 'utf8')) as string[];
const expected = JSON.parse(readFileSync(join(here, 'expected.json'), 'utf8')) as { bits: string; end: number }[];
// A submission must do the conversion itself; another program (python, libc) would be the reference the
// expected values came from, so process creation is disabled before it loads. A guard against an honest shortcut, not a sandbox.
for (const name of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork'] as const) {
  (childProcess as any)[name] = () => { throw new Error('child processes are not available to a submission'); };
}
syncBuiltinESMExports();
const oracle_results: { name: string; exit_code: number }[] = [];
let strtod: ((s: string) => { bits: string; end: number }) | undefined;
try {
  ({ strtod } = await import(pathToFileURL(join(resolve(workspace), 'strtod.ts')).href));
  if (typeof strtod !== 'function') throw new Error('strtod is not a function');
} catch {
  oracle_results.push({ name: 'artifact-load', exit_code: 1 });
}
if (strtod) {
  cases.forEach((s, i) => {
    let ok = false;
    try { const r = strtod!(s); ok = r.bits === expected[i].bits && r.end === expected[i].end; } catch { ok = false; }
    oracle_results.push({ name: `case-${String(i).padStart(3, '0')}`, exit_code: ok ? 0 : 1 });
  });
}
const score = Number(oracle_results.length === cases.length && oracle_results.every((r) => r.exit_code === 0));
console.log(JSON.stringify({ score, oracle_results }));
process.exit(score === 1 ? 0 : 1);
