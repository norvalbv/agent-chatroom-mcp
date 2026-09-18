/** Cross-checks every oracle case against real `git check-ignore` and the reference implementation.
 * node --import tsx tasks/bench-ignore-rules/oracle/verify-against-git.ts [--write]
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { cases } from './cases.ts';
import { isIgnored } from '../fixtures/correct/ignore.ts';

const results: { name: string; git: boolean; ref: boolean }[] = [];
for (const c of cases) {
  const dir = mkdtempSync(join(tmpdir(), 'ignore-git-'));
  try {
    spawnSync('git', ['init', '-q'], { cwd: dir });
    writeFileSync(join(dir, '.gitignore'), c.rules + '\n');
    mkdirSync(dirname(join(dir, c.path)), { recursive: true });
    writeFileSync(join(dir, c.path), '');
    const run = spawnSync('git', ['check-ignore', '-q', '--no-index', '--', c.path], { cwd: dir });
    results.push({ name: c.name, git: run.status === 0, ref: isIgnored(c.rules, c.path) });
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
const bad = results.filter((r) => r.git !== r.ref);
for (const r of results) console.log(`${r.git === r.ref ? 'ok  ' : 'DIFF'} ${r.name} git=${r.git} ref=${r.ref}`);
console.log(bad.length ? `${bad.length} DISAGREEMENTS` : `all ${results.length} agree with git`);
if (process.argv.includes('--write')) console.log(JSON.stringify(Object.fromEntries(results.map((r) => [r.name, r.git]))));
process.exit(bad.length ? 1 : 0);
