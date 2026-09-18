/** Private deterministic artifact oracle for bench-doc-audit.
 * node --import tsx tasks/bench-doc-audit/oracle/score.ts WORKSPACE
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
const load = (name: string) => import(pathToFileURL(join(resolve(workspace), 'lib', `${name}.ts`)).href);

const checks: { name: string; run: () => Promise<void> }[] = [
  { name: 'slugify', run: async () => {
    const { slugify } = await load('slugify');
    assert.equal(slugify('Hello, World!'), 'hello-world');
    assert.equal(slugify('  a   b  '), 'a-b');
    assert.equal(slugify('Café au lait'), 'caf-au-lait');
    assert.equal(slugify('日本'), 'untitled');
    assert.equal(slugify('---'), 'untitled');
    assert.equal(slugify('x'), 'x');
  } },
  { name: 'chunk', run: async () => {
    const { chunk } = await load('chunk');
    assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
    assert.deepEqual(chunk([1, 2, 3], 5), [[1, 2, 3]]);
    assert.deepEqual(chunk([], 3), []);
    assert.deepEqual(chunk([1, 2, 3, 4], 2), [[1, 2], [3, 4]]);
    for (const bad of [0, -1, 1.5, NaN]) assert.throws(() => chunk([1], bad), RangeError);
    const input = [1, 2, 3];
    chunk(input, 2);
    assert.deepEqual(input, [1, 2, 3]);
  } },
  { name: 'median', run: async () => {
    const { median } = await load('median');
    assert.equal(median([10, 9, 2]), 9);
    assert.equal(median([1, 2, 3, 4]), 2.5);
    assert.equal(median([]), null);
    assert.equal(median([-5, -10, 100]), -5);
    const input = [3, 1, 2];
    assert.equal(median(input), 2);
    assert.deepEqual(input, [3, 1, 2]);
  } },
  { name: 'formatBytes', run: async () => {
    const { formatBytes } = await load('formatBytes');
    assert.equal(formatBytes(0), '0 B');
    assert.equal(formatBytes(512), '512 B');
    assert.equal(formatBytes(1023), '1023 B');
    assert.equal(formatBytes(1024), '1 KB');
    assert.equal(formatBytes(1536), '1.5 KB');
    assert.equal(formatBytes(1048576), '1 MB');
    assert.equal(formatBytes(5 * 1024 ** 4), '5 TB');
    assert.equal(formatBytes(2048 * 1024 ** 4), '2048 TB');
    for (const bad of [-1, Infinity, NaN]) assert.throws(() => formatBytes(bad), RangeError);
  } },
  { name: 'parseBool', run: async () => {
    const { parseBool } = await load('parseBool');
    assert.equal(parseBool('TRUE'), true);
    assert.equal(parseBool('  yes '), true);
    assert.equal(parseBool('On'), true);
    assert.equal(parseBool('1'), true);
    assert.equal(parseBool('off'), false);
    assert.equal(parseBool(' No\n'), false);
    assert.equal(parseBool('0'), false);
    assert.equal(parseBool('false'), false);
    assert.equal(parseBool(''), undefined);
    assert.equal(parseBool('maybe'), undefined);
  } },
  { name: 'daysBetween', run: async () => {
    const { daysBetween } = await load('daysBetween');
    assert.equal(daysBetween('2024-01-31', '2024-02-01'), 1);
    assert.equal(daysBetween('2024-02-01', '2024-01-31'), -1);
    assert.equal(daysBetween('2024-03-05', '2024-03-05'), 0);
    assert.equal(daysBetween('2024-02-28', '2024-03-01'), 2);
    assert.equal(daysBetween('2023-12-31', '2024-12-31'), 366);
  } },
  { name: 'dedupe', run: async () => {
    const { dedupe } = await load('dedupe');
    assert.deepEqual(dedupe([3, 1, 3, 2, 1]), [3, 1, 2]);
    assert.deepEqual(dedupe([NaN, 1, NaN]), [NaN, 1]);
    assert.deepEqual(dedupe([0, -0, 1]), [0, 1]);
    assert.deepEqual(dedupe([{ id: 1, v: 'a' }, { id: 2, v: 'b' }, { id: 1, v: 'c' }], (x: any) => x.id), [{ id: 1, v: 'a' }, { id: 2, v: 'b' }]);
    const input = [1, 1, 2];
    dedupe(input);
    assert.deepEqual(input, [1, 1, 2]);
  } },
  { name: 'wrapText', run: async () => {
    const { wrapText } = await load('wrapText');
    assert.equal(wrapText('aaa bbb ccc', 7), 'aaa bbb\nccc');
    assert.equal(wrapText('aaa bbb ccc', 10), 'aaa bbb\nccc');
    assert.equal(wrapText('aaa bbb ccc', 11), 'aaa bbb ccc');
    assert.equal(wrapText('a supercalifragilistic b', 5), 'a\nsupercalifragilistic\nb');
    assert.equal(wrapText('one\ttwo\n\nthree   four', 9), 'one two\nthree\nfour');
    assert.equal(wrapText('   ', 10), '');
    assert.equal(wrapText('', 10), '');
  } },
];

const oracle_results: { name: string; exit_code: number }[] = [];
for (const c of checks) {
  try {
    await c.run();
    oracle_results.push({ name: c.name, exit_code: 0 });
  } catch (error) {
    const missing = (error as NodeJS.ErrnoException)?.code === 'ERR_MODULE_NOT_FOUND';
    oracle_results.push({ name: missing ? 'artifact-load' : c.name, exit_code: 1 });
  }
}
const score = Number(oracle_results.length === checks.length && oracle_results.every((r) => r.exit_code === 0));
console.log(JSON.stringify({ score, oracle_results }));
process.exit(score === 1 ? 0 : 1);
