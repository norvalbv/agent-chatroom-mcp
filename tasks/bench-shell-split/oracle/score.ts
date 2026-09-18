/** Private deterministic artifact oracle for bench-shell-split. Expected values come from Python's
 * shlex.split(posix=True) (see verify-against-python.ts) and are stored in expected.json (null = must throw).
 * node --import tsx tasks/bench-shell-split/oracle/score.ts WORKSPACE
 * exit 0: all pass; exit 1: artifact failure; exit 2: invocation error.
 * Path separation is not a sandbox. Run untrusted code in a restricted process.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { cases } from './cases.ts';
const workspace = process.argv[2];
if (!workspace) {
  console.error('usage: score.ts WORKSPACE');
  process.exit(2);
}
const expected = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'expected.json'), 'utf8')) as Record<string, string[] | null>;
const oracle_results: { name: string; exit_code: number }[] = [];
let shellSplit: ((input: string) => unknown) | undefined;
try {
  ({ shellSplit } = await import(pathToFileURL(join(resolve(workspace), 'split.ts')).href));
  if (typeof shellSplit !== 'function') throw new Error('shellSplit is not a function');
} catch {
  oracle_results.push({ name: 'artifact-load', exit_code: 1 });
}
if (shellSplit) {
  for (const c of cases) {
    let ok = false;
    try {
      if (expected[c.name] === null) assert.throws(() => shellSplit!(c.input), Error);
      else assert.deepEqual(shellSplit!(c.input), expected[c.name]);
      ok = true;
    } catch { ok = false; }
    oracle_results.push({ name: c.name, exit_code: ok ? 0 : 1 });
  }
}
const score = Number(oracle_results.length === cases.length && oracle_results.every((r) => r.exit_code === 0));
console.log(JSON.stringify({ score, oracle_results }));
process.exit(score === 1 ? 0 : 1);
