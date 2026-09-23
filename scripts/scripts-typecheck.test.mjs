/** Item 6: `npm test` must type-check scripts/, not only src/ (tsconfig.json includes src alone). */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { offlineCommands } from './offline-runner.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const tsc = join(root, 'node_modules/typescript/bin/tsc');

const commands = offlineCommands();
const typecheck = commands.find(c => c.args.includes('tsconfig.scripts.json'));
assert.ok(typecheck, 'offline suite runs tsc -p tsconfig.scripts.json');
assert.ok(typecheck.args.includes(tsc.slice(root.length + 1)), 'type-check uses the repo tsc');
assert.ok(commands.indexOf(typecheck) < commands.findIndex(c => c.name.endsWith('.ts')), 'type-check runs before the scripts');

const config = JSON.parse(readFileSync(join(root, 'tsconfig.scripts.json'), 'utf8'));
assert.ok(config.include.some(p => p.startsWith('scripts/')), 'tsconfig.scripts.json covers scripts/');
assert.equal(config.compilerOptions.noEmit, true, 'scripts type-check emits nothing');

// The config must actually catch a type error in a script, not just exist.
const dir = mkdtempSync(join(tmpdir(), 'scripts-typecheck-'));
try {
  writeFileSync(join(dir, 'planted.ts'), "const n: number = 'not a number';\nprocess.exit(n);\n");
  writeFileSync(join(dir, 'tsconfig.json'), JSON.stringify({
    extends: join(root, 'tsconfig.scripts.json'),
    compilerOptions: { rootDir: dir, typeRoots: [join(root, 'node_modules/@types')] },
    include: [join(dir, 'planted.ts')],
  }));
  const planted = spawnSync(process.execPath, [tsc, '-p', join(dir, 'tsconfig.json')], { encoding: 'utf8' });
  assert.notEqual(planted.status, 0, 'planted type error fails the check');
  assert.match(planted.stdout, /planted\.ts.*TS2322/, 'fails on the planted error itself');
  assert.doesNotMatch(planted.stdout, /TS2591|TS2688/, 'node types resolve (process is known)');
} finally {
  rmSync(dir, { recursive: true, force: true });
}
console.log('SCRIPTS TYPECHECK TEST OK');
