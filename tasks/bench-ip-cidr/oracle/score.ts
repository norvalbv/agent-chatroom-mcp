/** Private deterministic artifact oracle for bench-ip-cidr. Expected values come from Python's
 * ipaddress module (see verify-against-python.ts) and are stored in expected.json (null = must throw).
 * node --import tsx tasks/bench-ip-cidr/oracle/score.ts WORKSPACE
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
const expected = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'expected.json'), 'utf8')) as Record<string, unknown>;
const oracle_results: { name: string; exit_code: number }[] = [];
let mod: Record<string, (...args: string[]) => unknown> | undefined;
try {
  mod = await import(pathToFileURL(join(resolve(workspace), 'ip.ts')).href);
  for (const fn of ['normalizeIPv6', 'expandIPv6', 'cidrRange', 'cidrContains']) {
    if (typeof mod![fn] !== 'function') throw new Error(`${fn} is not a function`);
  }
} catch {
  mod = undefined;
  oracle_results.push({ name: 'artifact-load', exit_code: 1 });
}
if (mod) {
  for (const c of cases) {
    let ok = false;
    try {
      if (expected[c.name] === null) assert.throws(() => mod![c.fn](...c.args), Error);
      else assert.deepStrictEqual(mod![c.fn](...c.args), expected[c.name]);
      ok = true;
    } catch { ok = false; }
    oracle_results.push({ name: c.name, exit_code: ok ? 0 : 1 });
  }
}
const score = Number(oracle_results.length === cases.length && oracle_results.every((r) => r.exit_code === 0));
console.log(JSON.stringify({ score, oracle_results }));
process.exit(score === 1 ? 0 : 1);
