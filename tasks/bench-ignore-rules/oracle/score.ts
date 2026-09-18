/** Private deterministic artifact oracle for bench-ignore-rules. Expected values come from real
 * `git check-ignore` (see verify-against-git.ts) and are stored in expected.json.
 * node --import tsx tasks/bench-ignore-rules/oracle/score.ts WORKSPACE
 * exit 0: all pass; exit 1: artifact failure; exit 2: invocation error.
 * Path separation is not a sandbox. Run untrusted code in a restricted process.
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { cases } from './cases.ts';
const workspace = process.argv[2];
if (!workspace) {
  console.error('usage: score.ts WORKSPACE');
  process.exit(2);
}
const expected = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'expected.json'), 'utf8')) as Record<string, boolean>;
const oracle_results: { name: string; exit_code: number }[] = [];
let isIgnored: ((rules: string, path: string) => unknown) | undefined;
try {
  ({ isIgnored } = await import(pathToFileURL(join(resolve(workspace), 'ignore.ts')).href));
  if (typeof isIgnored !== 'function') throw new Error('isIgnored is not a function');
} catch {
  oracle_results.push({ name: 'artifact-load', exit_code: 1 });
}
if (isIgnored) {
  for (const c of cases) {
    let ok = false;
    try { ok = isIgnored(c.rules, c.path) === expected[c.name]; } catch { ok = false; }
    oracle_results.push({ name: c.name, exit_code: ok ? 0 : 1 });
  }
}
const score = Number(oracle_results.length === cases.length && oracle_results.every((r) => r.exit_code === 0));
console.log(JSON.stringify({ score, oracle_results }));
process.exit(score === 1 ? 0 : 1);
