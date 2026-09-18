/** Frozen draft-2 v3 contract. Offline; hidden oracle files never enter seat workspaces.
 * Run: node --import tsx --test scripts/oracle-tasks.test.ts
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadTask, scoreTask } from './bench-oracle.ts';
const bug = resolve('tasks/bench-bug-fix');
const fact = resolve('tasks/bench-fact-check');
const expected = 'Society for Formal Methods, Vienna';
const normalize = (s: string) => s.normalize('NFKC').replace(/\s+/gu, ' ').trim().toLowerCase();
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
function temporary() { return mkdtempSync(join(tmpdir(), 'oracle-tasks-')); }
function invoke(script: string, args: string[]) {
  return spawnSync(process.execPath, ['--import', 'tsx', script, ...args], { encoding: 'utf8', timeout: 15000 });
}
function hidden(workspace: string) { return invoke(join(bug, 'oracle/score.ts'), [workspace]); }
function workspace(root: string, variant: 'broken' | 'correct') {
  const dir = join(root, variant);
  cpSync(join(bug, 'public'), dir, { recursive: true });
  cpSync(join(bug, 'fixtures', variant), dir, { recursive: true });
  assert.equal(existsSync(join(dir, 'oracle')), false);
  assert.equal(existsSync(join(dir, 'fixtures')), false);
  return dir;
}
for (const c of cases) test(`inclusiveDates hidden case: ${c.name}`, async () => {
  const { inclusiveDates } = await import(pathToFileURL(join(bug, 'fixtures/correct/dates.ts')).href);
  if (c.expected) assert.deepEqual(inclusiveDates(...c.args), c.expected);
  else assert.throws(() => inclusiveDates(...c.args), { message: 'invalid date range' });
});
test('both fixture variants exist and differ only by the one-line inclusive-bound fix', () => {
  assert.equal(loadTask(bug).oracle.kind, 'inclusive-dates');
  const broken = readFileSync(join(bug, 'fixtures/broken/dates.ts'), 'utf8');
  assert.match(broken, /t < e/);
  assert.equal(readFileSync(join(bug, 'public/dates.ts'), 'utf8'), broken);
  assert.equal(readFileSync(join(bug, 'fixtures/correct/dates.ts'), 'utf8'), broken.replace('t < e', 't <= e'));
});
test('broken fails hidden oracle; one-line t<=e fix passes all nine named oracles', () => {
  const root = temporary(); try {
    const dir = workspace(root, 'broken');
    const red = hidden(dir);
    assert.equal(red.status, 1, red.stderr);
    const result = JSON.parse(red.stdout);
    assert.equal(result.score, 0);
    assert.deepEqual(result.oracle_results.map((r: any) => r.name), cases.map(c => c.name));
    assert.equal(result.oracle_results.filter((r: any) => r.exit_code === 1).length, 5);
    writeFileSync(join(dir, 'dates.ts'), readFileSync(join(dir, 'dates.ts'), 'utf8').replace('t < e', 't <= e'));
    const green = hidden(dir);
    assert.equal(green.status, 0, green.stderr);
    assert.equal(JSON.parse(green.stdout).score, 1);
    assert.ok(JSON.parse(green.stdout).oracle_results.every((r: any) => r.exit_code === 0));
  } finally { rmSync(root, { recursive: true, force: true }); }
});
test('wrong patch gives named-oracle-failure JSON; double-run is byte-identical', async () => {
  const root = temporary(); try {
    const dir = workspace(root, 'broken');
    // Fluent success prose must not substitute for the code artifact.
    writeFileSync(join(dir, 'answer.txt'), 'I fixed every test successfully.');
    writeFileSync(join(dir, 'dates.ts'), 'export function inclusiveDates() { return []; }\n');
    const a = hidden(dir), b = hidden(dir);
    assert.equal(a.status, 1, a.stderr); assert.equal(b.status, 1, b.stderr);
    assert.equal(a.stdout, b.stdout);
    const result = JSON.parse(a.stdout);
    assert.equal(result.score, 0);
    assert.ok(result.oracle_results.some((r: any) => r.name === 'equal-endpoints' && r.exit_code === 1));
    const scored = await scoreTask(bug, dir);
    assert.equal(scored.passed, false); assert.equal(scored.reason, 'task_fail');
    assert.equal(scored.oracle.exit_code, 1);
    assert.ok((scored as any).oracle_results.some((r: any) => r.name === 'equal-endpoints' && r.exit_code === 1));
  } finally { rmSync(root, { recursive: true, force: true }); }
});
test('loadTask/scoreTask dispatch the correct bug-fix artifact and repeat deterministically', async () => {
  const root = temporary(); try {
    const dir = workspace(root, 'correct');
    const a = await scoreTask(bug, dir), b = await scoreTask(bug, dir);
    assert.equal(a.passed, true); assert.equal(a.oracle.kind, 'inclusive-dates');
    assert.equal(a.oracle.exit_code, 0); assert.equal(JSON.stringify(a), JSON.stringify(b));
    const first = hidden(dir), second = hidden(dir);
    assert.equal(first.status, 0, first.stderr); assert.equal(second.status, 0, second.stderr);
    assert.equal(first.stdout, second.stdout);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
test('fact-check exact/normalized controls pass; negation and right-value/wrong-format exit 1', async () => {
  const root = temporary(); try {
    assert.equal(loadTask(fact).oracle.kind, 'exact-answer');
    cpSync(join(fact, 'public'), root, { recursive: true });
    assert.equal(existsSync(join(root, 'oracle')), false);
    for (const [answer, status] of [
      [expected, 0], ['  SOCIETY  FOR FORMAL METHODS, Vienna\n', 0],
      ['The answer is NOT Society for Formal Methods, Vienna', 1],
      [`The answer is ${expected}`, 1],
      ['Institute for Computational Reasoning, Berlin', 1],
      [JSON.stringify({ answer: expected }), 3], ['', 3],
    ] as const) {
      writeFileSync(join(root, 'answer.txt'), answer);
      const a = invoke(resolve('scripts/score-fact-check.ts'), [join(root, 'answer.txt'), join(fact, 'oracle/oracle.json')]);
      const b = invoke(resolve('scripts/score-fact-check.ts'), [join(root, 'answer.txt'), join(fact, 'oracle/oracle.json')]);
      assert.equal(a.status, status, a.stderr); assert.equal(b.status, a.status);
      assert.equal(JSON.parse(a.stdout).score, status === 0 ? 1 : 0); assert.equal(a.stdout, b.stdout);
      assert.equal((await scoreTask(fact, root)).passed, status === 0);
    }
    // Optional DIFFICULTY guard only; withdrawn by audit #163, NOT a validity test.
    // The supplied reference is legitimate retrieval evidence. Do not enable this
    // assertion without redefining the task and preserving sufficient evidence:
    // assert.ok(!normalize(readFileSync(join(fact, 'public/records.txt'), 'utf8')).includes(normalize(expected)));
    assert.equal(normalize(expected), 'society for formal methods, vienna');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
test('records.txt licenses exactly one corrected affiliation, not two (RQ1 grid item 6)', () => {
  // Regression for the swarm-125438-jp20 fix: the pre-fix text only named the Vienna org as the
  // *source of the confirmation*, which a real Sonnet seat in every arm (A and C) read as leaving
  // "Institute for Computational Reasoning, Vienna" (city-only swap) equally defensible — see
  // bench/results/rq1-grid1/bench-fact-check-{A,C}-seed1/result.json. The text must now foreclose
  // that reading explicitly, not merely cite Vienna as a source.
  const text = readFileSync(join(fact, 'public/records.txt'), 'utf8');
  const norm = normalize(text);
  assert.ok(norm.includes(normalize('does not appear in any current appointment record for her, in Berlin or elsewhere')), 'must explicitly rule out any Vienna-city variant of the original institute name');
  assert.ok(norm.includes(normalize('Her actual, current affiliation')) && norm.includes(normalize(expected)), 'must directly state the corrected affiliation, not merely cite it as a record source');
  assert.ok(!/^source:/im.test(text.split('\n\n').at(-1) ?? ''), 'must not reintroduce the withdrawn "Source: ..." phrasing that only cited Vienna as the confirming org');
});
test('hub crash maps to infrastructure_error, excluded from task comparison', () => {
  const root = temporary(); try {
    // Exercise the real runner crash path without binding ports or starting a hub:
    // only its preflight port probe is mocked. Child process genuinely exits 23.
    const mock = join(root, 'no-port.mjs');
    writeFileSync(mock, `import net from 'node:net'; import {syncBuiltinESMExports} from 'node:module';\nnet.createServer=()=>({once(){return this},listen(p,h,done){done();return this},close(done){done();return this}}); syncBuiltinESMExports();\n`);
    const crash = join(root, 'crash.mjs'); writeFileSync(crash, 'process.exit(23);\n');
    const output = join(root, 'run');
    const run = spawnSync(process.execPath, ['--import', mock, '--import', 'tsx', resolve('scripts/bench-bench.ts'), fact, crash, crash, '23890', '--root', output, '--timeout-ms', '500'], { encoding: 'utf8', timeout: 15000 });
    assert.equal(run.status, 0, run.stderr);
    for (const arm of ['A', 'B']) {
      const verdict = JSON.parse(readFileSync(join(output, arm, 'bench-result.json'), 'utf8'));
      assert.equal(verdict.reason, 'infrastructure_error'); assert.equal(verdict.passed, false);
      assert.equal(verdict.oracle.exit_code, null);
    }
    const comparison = JSON.parse(readFileSync(join(output, 'bench-compare.json'), 'utf8'));
    assert.equal(comparison.comparable, false); assert.equal(comparison.delta, null);
    // Current runner emits a single-pair delta, not aggregate pass_rate. An infra
    // pair must not become a numeric failure rate under either representation.
    assert.ok(comparison.pass_rate === undefined || comparison.pass_rate === null);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('outcome vocabulary: task_pass/task_fail/parse_failure distinct; missing artifact is not infra', async () => {
  const root = temporary(); try {
    // fact-check: missing/unreadable/empty/prohibited-format answer => parse_failure
    cpSync(join(fact, 'public'), root, { recursive: true });
    rmSync(join(root, 'answer.txt'), { force: true });
    let scored = await scoreTask(fact, root);
    assert.equal(scored.passed, false);
    assert.equal(scored.reason, 'parse_failure', 'missing answer.txt must be parse_failure, not infra');
    writeFileSync(join(root, 'answer.txt'), '   \n  ');
    scored = await scoreTask(fact, root);
    assert.equal(scored.reason, 'parse_failure', 'empty answer must be parse_failure');
    writeFileSync(join(root, 'answer.txt'), JSON.stringify({ answer: expected }));
    scored = await scoreTask(fact, root);
    assert.equal(scored.reason, 'parse_failure', 'correct value in prohibited JSON format must be parse_failure');
    writeFileSync(join(root, 'answer.txt'), 'The answer is NOT Society for Formal Methods, Vienna');
    scored = await scoreTask(fact, root);
    assert.equal(scored.reason, 'task_fail', 'well-formed wrong answer is task_fail');
    assert.equal(scored.oracle.exit_code, 1);
    writeFileSync(join(root, 'answer.txt'), expected);
    scored = await scoreTask(fact, root);
    assert.equal(scored.reason, 'task_pass');
    assert.equal(scored.passed, true);
    rmSync(root, { recursive: true, force: true });
    // bug-fix: artifact-load failure is parse_failure, not task_fail
    const dir = mkdtempSync(join(tmpdir(), 'oracle-taxonomy-bug-'));
    cpSync(join(bug, 'public'), dir, { recursive: true });
    rmSync(join(dir, 'dates.ts'), { force: true });  // artifact missing => parse_failure
    scored = await scoreTask(bug, dir);
    assert.equal(scored.reason, 'parse_failure', 'artifact-load failure must be parse_failure');
    writeFileSync(join(dir, 'dates.ts'), readFileSync(join(bug, 'fixtures/broken/dates.ts'), 'utf8'));
    scored = await scoreTask(bug, dir);
    assert.equal(scored.reason, 'task_fail', 'loadable but wrong artifact is task_fail');
    assert.ok((scored as any).oracle_results.some((r: any) => r.name === 'equal-endpoints' && r.exit_code === 1));
    writeFileSync(join(dir, 'dates.ts'), readFileSync(join(bug, 'fixtures/correct/dates.ts'), 'utf8'));
    scored = await scoreTask(bug, dir);
    assert.equal(scored.reason, 'task_pass');
    assert.equal(scored.passed, true);
    rmSync(dir, { recursive: true, force: true });
  } finally { rmSync(root, { recursive: true, force: true }); }
});
