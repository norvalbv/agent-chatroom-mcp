/** bench-build-runner.ts's generatorHashes() must recognize every bench-build-*-gen.ts generator file, including
 * ones with more than one hyphenated segment before -gen.ts (e.g. bench-build-ledger-scale-gen.ts), so launch
 * provenance never silently omits a generator's hash. Found by 6-astra-2, swarm-212551-3vhd: the one-segment
 * regex dropped such files without erroring. Run with: npx tsx scripts/generator-file-regex-regression.ts
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GENERATOR_FILE_RE } from './bench-build-runner.ts';

const here = dirname(fileURLToPath(import.meta.url));

test('matches every existing bench-build-*-gen.ts generator, including multi-segment names', () => {
  const generators = readdirSync(here).filter((n) => /-gen\.ts$/.test(n) && n.startsWith('bench-build'));
  assert.ok(generators.includes('bench-build-ledger-scale-gen.ts'), 'fixture file missing');
  for (const name of generators) assert.ok(GENERATOR_FILE_RE.test(name), `${name} not recognized as a generator`);
});

test('does not match non-generator bench-build scripts', () => {
  for (const name of ['bench-build-runner.ts', 'bench-build-grid.ts', 'bench-build.ts', 'bench-build-task.test.ts']) {
    assert.ok(!GENERATOR_FILE_RE.test(name), `${name} incorrectly matched as a generator`);
  }
});
