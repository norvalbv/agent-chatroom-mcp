/** The two-item dry-run pool: a tiny git repo, its locked pool.json and a hidden side in a separate root, all
 * under one scratch base, so validate/run/finalize/score/audit are tested offline with no model calls.
 * `solutions` holds a correct implementation per item so a fake seat can commit a fix without ever reading
 * reference.patch. CLI: node --import tsx scripts/pool-fixture.ts BASE_DIR  (prints the fixture as JSON). */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lockPool, type Pool } from './pool-format.ts';

export const DRY_RUN_POOL = 'dry-run';
const gitEnv = { ...process.env, GIT_AUTHOR_NAME: 'pool-fixture', GIT_AUTHOR_EMAIL: 'fixture@invalid', GIT_COMMITTER_NAME: 'pool-fixture', GIT_COMMITTER_EMAIL: 'fixture@invalid' };
const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, env: gitEnv, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const put = (path: string, text: string) => { mkdirSync(join(path, '..'), { recursive: true }); writeFileSync(path, text); };

const BASE_FILES: Record<string, string> = {
  'package.json': JSON.stringify({ name: 'dry-run-pool', private: true, type: 'module', scripts: { test: 'node --test test/base.test.mjs' } }, null, 2) + '\n',
  'src/math.mjs': 'export function add(a, b) {\n  return a + b;\n}\n',
  'src/text.mjs': 'export function shout(s) {\n  return s.toUpperCase();\n}\n',
  'test/base.test.mjs': "import assert from 'node:assert/strict';\nimport { test } from 'node:test';\nimport { add } from '../src/math.mjs';\nimport { shout } from '../src/text.mjs';\n\ntest('add', () => assert.equal(add(2, 3), 5));\ntest('shout', () => assert.equal(shout('hi'), 'HI'));\n",
};

const ITEMS = [
  { id: 'double', title: 'double(n)', brief: 'Export a function double(n) from src/math.mjs that returns n multiplied by 2.',
    solution: { path: 'src/math.mjs', content: BASE_FILES['src/math.mjs'] + '\nexport function double(n) {\n  return n * 2;\n}\n' },
    test: { path: 'test/double.hidden.test.mjs', content: "import assert from 'node:assert/strict';\nimport { test } from 'node:test';\nimport * as m from '../src/math.mjs';\n\ntest('double', () => { assert.equal(typeof m.double, 'function'); assert.equal(m.double(21), 42); assert.equal(m.double(-1.5), -3); });\n" } },
  { id: 'greet', title: 'greet(name)', brief: 'Export a function greet(name) from src/text.mjs that returns "Hello, <name>!".',
    solution: { path: 'src/text.mjs', content: BASE_FILES['src/text.mjs'] + '\nexport function greet(name) {\n  return `Hello, ${name}!`;\n}\n' },
    test: { path: 'test/greet.hidden.test.mjs', content: "import assert from 'node:assert/strict';\nimport { test } from 'node:test';\nimport * as t from '../src/text.mjs';\n\ntest('greet', () => { assert.equal(typeof t.greet, 'function'); assert.equal(t.greet('Ada'), 'Hello, Ada!'); });\n" } },
];

export type DryRunPool = { base: string; poolDir: string; repo: string; hiddenParent: string; pool: Pool; solutions: Record<string, { path: string; content: string }>; hiddenTestNames: string[] };

/** dependency: the repo gets a gitignored node_modules/dry-dep (never committed, like a real install) and double's
 * hidden test imports it, so a worktree that does not link node_modules fails that test even with the fix. */
export function makeDryRunPool(baseDir: string, opts: { deadlineMin?: number; dependency?: boolean } = {}): DryRunPool {
  const base = resolve(baseDir);
  const repo = join(base, 'repo'), poolDir = join(base, 'pools', DRY_RUN_POOL), hiddenParent = join(base, 'hidden');
  mkdirSync(repo, { recursive: true });
  git(repo, 'init', '--quiet', '-b', 'main');
  for (const [rel, text] of Object.entries(BASE_FILES)) put(join(repo, rel), text);
  if (opts.dependency) put(join(repo, '.gitignore'), 'node_modules\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '--quiet', '-m', 'dry-run pool base');
  if (opts.dependency) {
    put(join(repo, 'node_modules', 'dry-dep', 'package.json'), JSON.stringify({ name: 'dry-dep', type: 'module', exports: './index.js' }) + '\n');
    put(join(repo, 'node_modules', 'dry-dep', 'index.js'), 'export const factor = 2;\n');
  }
  const baseCommit = git(repo, 'rev-parse', 'HEAD').trim();
  for (const item of ITEMS) {
    const dir = join(hiddenParent, DRY_RUN_POOL, item.id);
    put(join(dir, 'cmd'), `node --test ${item.test.path}\n`);
    put(join(dir, 'tests', item.test.path), opts.dependency && item.id === 'double'
      ? item.test.content.replace("import * as m from '../src/math.mjs';", "import * as m from '../src/math.mjs';\nimport { factor } from 'dry-dep';").replace('m.double(21), 42', 'm.double(21), 21 * factor')
      : item.test.content);
    // The reference patch is a real `git diff` of the solution against base, then the repo is restored.
    put(join(repo, item.solution.path), item.solution.content);
    put(join(dir, 'reference.patch'), git(repo, 'diff', '--', item.solution.path));
    git(repo, 'checkout', '--quiet', '--', item.solution.path);
  }
  const pool: Pool = { name: DRY_RUN_POOL, repo, base_commit: baseCommit, deadline_min: opts.deadlineMin ?? 1,
    items: ITEMS.map(({ id, title, brief }) => ({ id, title, brief })), split: [['double'], ['greet'], []], suite_cmd: 'npm test' };
  put(join(poolDir, 'pool.json'), JSON.stringify(pool, null, 2) + '\n');
  lockPool(poolDir);
  return { base, poolDir, repo, hiddenParent, pool,
    solutions: Object.fromEntries(ITEMS.map(i => [i.id, i.solution])),
    hiddenTestNames: ITEMS.map(i => i.test.path.split('/').pop()!) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dir = process.argv[2];
  if (!dir) { console.error('usage: pool-fixture.ts BASE_DIR'); process.exit(2); }
  console.log(JSON.stringify(makeDryRunPool(dir), null, 2));
}
