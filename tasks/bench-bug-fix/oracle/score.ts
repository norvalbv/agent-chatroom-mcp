/** Private deterministic artifact oracle, draft-2 v3. Never copied into public/.
 * node --import tsx tasks/bench-bug-fix/oracle/score.ts WORKSPACE
 * exit 0: all pass; exit 1: artifact failure; exit 2: invocation error.
 * Path separation is not a sandbox. Run untrusted code in a restricted process.
 */
import assert from 'node:assert/strict';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
const workspace = process.argv[2];
if (!workspace) {
  console.error('usage: score.ts WORKSPACE');
  process.exit(2);
}
const cases: { name: string; args: unknown[]; expected?: string[] }[] = [
  { name: 'equal-endpoints', args: ['2024-02-29', '2024-02-29'], expected: ['2024-02-29'] },
  { name: 'leap-day', args: ['2024-02-28', '2024-03-01'], expected: ['2024-02-28', '2024-02-29', '2024-03-01'] },
  { name: 'non-leap-year', args: ['2023-02-28', '2023-03-01'], expected: ['2023-02-28', '2023-03-01'] },
  { name: 'year-boundary', args: ['2024-12-31', '2025-01-02'], expected: ['2024-12-31', '2025-01-01', '2025-01-02'] },
  { name: 'month-boundary', args: ['2025-04-30', '2025-05-01'], expected: ['2025-04-30', '2025-05-01'] },
  { name: 'reversed-range', args: ['2025-05-02', '2025-05-01'] },
  { name: 'normalized-invalid-day', args: ['2024-02-30', '2024-03-01'] },
  { name: 'invalid-month', args: ['2025-13-01', '2026-01-01'] },
  { name: 'non-string', args: [123, 456] },
];
const oracle_results: { name: string; exit_code: number }[] = [];
try {
  const { inclusiveDates } = await import(pathToFileURL(join(resolve(workspace), 'dates.ts')).href);
  for (const c of cases) {
    try {
      assert.equal(typeof inclusiveDates, 'function');
      if (c.expected) assert.deepEqual(inclusiveDates(...c.args), c.expected);
      else assert.throws(() => inclusiveDates(...c.args), { message: 'invalid date range' });
      oracle_results.push({ name: c.name, exit_code: 0 });
    } catch {
      oracle_results.push({ name: c.name, exit_code: 1 });
    }
  }
} catch {
  oracle_results.push({ name: 'artifact-load', exit_code: 1 });
}
const score = Number(oracle_results.length === cases.length && oracle_results.every(r => r.exit_code === 0));
console.log(JSON.stringify({ score, oracle_results }));
process.exit(score === 1 ? 0 : 1);
