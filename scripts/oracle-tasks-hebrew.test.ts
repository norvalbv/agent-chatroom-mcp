/** Offline contract tests for tasks/bench-hebrew-calendar. Run: node --import tsx scripts/oracle-tasks-hebrew.test.ts */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { loadTask, scoreTask } from './bench-oracle.ts';

const task = resolve('tasks/bench-hebrew-calendar');
const reference = () => readFileSync(join(task, 'fixtures/correct/hebrew.ts'), 'utf8');

function workspace(root: string, name: string, source?: string) {
  const dir = join(root, name);
  cpSync(join(task, 'public'), dir, { recursive: true });
  assert.equal(existsSync(join(dir, 'oracle')), false, 'oracle/ must never reach a seat workspace');
  assert.equal(existsSync(join(dir, 'fixtures')), false, 'fixtures/ must never reach a seat workspace');
  writeFileSync(join(dir, 'hebrew.ts'), source ?? reference());
  return dir;
}
function hidden(dir: string) {
  return spawnSync(process.execPath, ['--import', 'tsx', join(task, 'oracle/score.ts'), dir], { encoding: 'utf8', timeout: 60000 });
}
function failing(source: string) {
  const root = mkdtempSync(join(tmpdir(), 'hebrew-task-'));
  try {
    const out = hidden(workspace(root, 'w', source));
    const parsed = JSON.parse(out.stdout);
    return { score: parsed.score as number, failed: (parsed.oracle_results as { exit_code: number }[]).filter((r) => r.exit_code !== 0).length };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('task loads as a private-tests kind and the public stub fails every hidden case', async () => {
  assert.equal(loadTask(task).oracle.kind, 'hebrew-calendar');
  const root = mkdtempSync(join(tmpdir(), 'hebrew-task-'));
  try {
    const dir = join(root, 'stub');
    cpSync(join(task, 'public'), dir, { recursive: true });
    const red = hidden(dir);
    assert.equal(red.status, 1, red.stderr);
    const result = JSON.parse(red.stdout);
    assert.equal(result.score, 0);
    assert.ok(result.oracle_results.length >= 1000);
    assert.ok(result.oracle_results.every((r: { exit_code: number }) => r.exit_code === 1));
    assert.equal((await scoreTask(task, dir)).reason, 'task_fail');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('the README-derived reference passes every hidden case, deterministically', async () => {
  const root = mkdtempSync(join(tmpdir(), 'hebrew-task-'));
  try {
    const dir = workspace(root, 'correct');
    const a = hidden(dir);
    const b = hidden(dir);
    assert.equal(a.status, 0, a.stderr);
    assert.equal(a.stdout, b.stdout);
    assert.equal(JSON.parse(a.stdout).score, 1);
    assert.equal((await scoreTask(task, dir)).reason, 'task_pass');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('dropping rules of the README fails hidden cases (GaTaRaD and the 356 rule, BeTU\'TeKaPoT and the 382 rule, are redundant in pairs)', () => {
  const src = reference();
  const drop = (text: string, from: string, to: string) => { assert.ok(text.includes(from), from); return text.replace(from, to); };
  const noGatarad = drop(src, 'weekday(q) === 3 && r >= 9924 && !isLeap(y)', 'false');
  const noBetu = drop(src, 'weekday(q) === 2 && r >= 16789 && isLeap(y - 1)', 'false');
  const no356 = (t: string) => drop(t, 'if (provisional(y + 1) - p === 356) return p + 2;', '');
  const no382 = (t: string) => drop(t, 'if (p - provisional(y - 1) === 382) return p + 1;', '');
  assert.equal(failing(noGatarad).failed, 0, 'GaTaRaD alone is covered by the 356 rule');
  assert.equal(failing(no356(src)).failed, 0, 'the 356 rule alone is covered by GaTaRaD');
  assert.equal(failing(noBetu).failed, 0, 'BeTU\'TeKaPoT alone is covered by the 382 rule');
  assert.equal(failing(no382(src)).failed, 0, 'the 382 rule alone is covered by BeTU\'TeKaPoT');
  assert.ok(failing(no356(noGatarad)).failed > 0, 'GaTaRaD and the 356 rule together');
  assert.ok(failing(no382(noBetu)).failed > 0, 'BeTU\'TeKaPoT and the 382 rule together');
  assert.ok(failing(drop(src, 'if (r >= 19440) day += 1;', 'if (false) day += 1;')).failed > 0, 'molad zaken');
  assert.ok(failing(drop(src, 'if ([1, 4, 6].includes(weekday(day))) day += 1;', '')).failed > 0, 'Lo ADU Rosh');
  assert.ok(failing(drop(src, 'length % 10 === 5 ? 30 : 29', '29')).failed > 0, 'complete year Heshvan');
  assert.ok(failing(drop(src, 'length % 10 === 3 ? 29 : 30', '30')).failed > 0, 'short year Kislev');
});

test('the hidden cases cover every year length and every postponement rule', () => {
  const { chosen_years, cases } = JSON.parse(readFileSync(join(task, 'oracle/cases.json'), 'utf8')) as { chosen_years: number[]; cases: unknown[] };
  assert.ok(chosen_years.length >= 40);
  assert.ok(cases.length >= 1000);
});

test('using Intl, obfuscated Intl, or another realm scores 0 (nothing to solve by delegation)', () => {
  const stub = 'export function toHebrew(y: number, m: number, d: number) {\n';
  const viaIntl = `${stub}  const f = new Intl.DateTimeFormat('en-u-ca-hebrew-nu-latn', { year: 'numeric', month: 'numeric', day: 'numeric', timeZone: 'UTC' });\n  const p = f.formatToParts(new Date(Date.UTC(y, m - 1, d)));\n  const g = (k: string) => Number(p.find((x) => x.type === k)!.value);\n  return { year: g('year'), month: g('month'), day: g('day') };\n}\n`;
  const obfuscated = viaIntl.replace('new Intl.DateTimeFormat', "new (globalThis as any)['In' + 'tl'].DateTimeFormat");
  assert.equal(failing(viaIntl).score, 0);
  const o = failing(obfuscated);
  assert.equal(o.score, 0);
  assert.ok(o.failed > 0);
});
