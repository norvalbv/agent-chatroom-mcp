/** Private deterministic artifact oracle for bench-patch-apply.
 * node --import tsx tasks/bench-patch-apply/oracle/score.ts WORKSPACE
 * exit 0: all pass; exit 1: artifact failure; exit 2: invocation error.
 * Path separation is not a sandbox. Run untrusted code in a restricted process.
 */
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
const workspace = process.argv[2];
if (!workspace) {
  console.error('usage: score.ts WORKSPACE');
  process.exit(2);
}
const ERR = Symbol('PatchError');
const nl = '\\ No newline at end of file';
const cases: { name: string; original: string; patch: string; expected: string | typeof ERR }[] = [
  { name: 'replace-default-counts', original: 'a\nb\nc\n', patch: '@@ -2 +2 @@\n-b\n+B\n', expected: 'a\nB\nc\n' },
  { name: 'explicit-counts-with-context', original: 'a\nb\nc\n', patch: '@@ -1,3 +1,3 @@\n a\n-b\n+B\n c\n', expected: 'a\nB\nc\n' },
  { name: 'insert-at-top', original: 'x\ny\n', patch: '@@ -0,0 +1,2 @@\n+p\n+q\n', expected: 'p\nq\nx\ny\n' },
  { name: 'insert-after-line-one', original: 'x\ny\n', patch: '@@ -1,0 +2 @@\n+m\n', expected: 'x\nm\ny\n' },
  { name: 'insert-at-end', original: 'x\ny\n', patch: '@@ -2,0 +3 @@\n+z\n', expected: 'x\ny\nz\n' },
  { name: 'delete-only', original: 'x\ny\n', patch: '@@ -2 +1,0 @@\n-y\n', expected: 'x\n' },
  { name: 'delete-everything-gives-empty-string', original: 'x\n', patch: '@@ -1 +0,0 @@\n-x\n', expected: '' },
  { name: 'wrong-C-is-ignored', original: 'a\nb\nc\n', patch: '@@ -2 +99 @@\n-b\n+B\n', expected: 'a\nB\nc\n' },
  { name: 'text-after-header-ignored', original: 'a\nb\nc\n', patch: '@@ -2 +2 @@ function foo() {\n-b\n+B\n', expected: 'a\nB\nc\n' },
  { name: 'file-headers-before-first-hunk-ignored', original: 'a\nb\n', patch: '--- a/f\n+++ b/f\n@@ -2 +2 @@\n-b\n+B\n', expected: 'a\nB\n' },
  { name: 'patch-without-final-newline', original: 'a\nb\n', patch: '@@ -2 +2 @@\n-b\n+B', expected: 'a\nB\n' },
  { name: 'offset-forward-search', original: '1\n2\n3\n4\n5\n', patch: '@@ -2 +2 @@\n-4\n+X\n', expected: '1\n2\n3\nX\n5\n' },
  { name: 'offset-backward-search', original: '1\n2\n3\n4\n5\n', patch: '@@ -5 +5 @@\n-2\n+X\n', expected: '1\nX\n3\n4\n5\n' },
  { name: 'equal-distance-tie-prefers-earlier', original: 'a\nz\nb\nz\nc\n', patch: '@@ -3 +3 @@\n-z\n+X\n', expected: 'a\nX\nb\nz\nc\n' },
  {
    name: 'delta-carries-to-next-hunk',
    original: 'a\nb\nc\nT\nx\ne\nf\ng\nx\nj\n',
    patch: '@@ -2 +2 @@\n-T\n+T2\n@@ -6 +6 @@\n-x\n+X\n',
    expected: 'a\nb\nc\nT2\nx\ne\nf\ng\nX\nj\n',
  },
  { name: 'later-hunk-cannot-reuse-earlier-lines', original: 'a\nb\n', patch: '@@ -1 +1 @@\n-a\n+A\n@@ -1 +1 @@\n-a\n+B\n', expected: ERR },
  { name: 'adjacent-hunks', original: 'a\nb\n', patch: '@@ -1 +1 @@\n-a\n+A\n@@ -2 +2 @@\n-b\n+B\n', expected: 'A\nB\n' },
  { name: 'header-start-beyond-file-still-searches', original: 'a\n', patch: '@@ -10 +10 @@\n-a\n+b\n', expected: 'b\n' },
  { name: 'insertion-start-beyond-file-lands-at-end', original: 'x\ny\n', patch: '@@ -5,0 +6 @@\n+z\n', expected: 'x\ny\nz\n' },
  { name: 'too-few-body-lines', original: 'a\nb\n', patch: '@@ -1,2 +1,2 @@\n a\n', expected: ERR },
  { name: 'too-many-body-lines', original: 'a\nb\nc\n', patch: '@@ -1 +1 @@\n-a\n+b\n c\n', expected: ERR },
  { name: 'empty-body-line-is-malformed', original: 'a\n\nb\n', patch: '@@ -1,3 +1,3 @@\n a\n\n b\n', expected: ERR },
  { name: 'blank-context-line-is-a-single-space', original: 'a\n\nb\n', patch: '@@ -1,3 +1,3 @@\n a\n \n-b\n+B\n', expected: 'a\n\nB\n' },
  { name: 'bad-header-non-numeric-count', original: 'a\n', patch: '@@ -1,x +1 @@\n-a\n+b\n', expected: ERR },
  { name: 'bad-header-non-numeric-start', original: 'a\n', patch: '@@ -a +1 @@\n-a\n+b\n', expected: ERR },
  { name: 'no-hunks-headers-only', original: 'a\n', patch: '--- a\n+++ b\n', expected: ERR },
  { name: 'empty-patch', original: 'a\n', patch: '', expected: ERR },
  { name: 'zero-zero-hunk', original: 'a\n', patch: '@@ -1,0 +1,0 @@\n', expected: ERR },
  { name: 'zero-start-with-old-lines', original: 'a\n', patch: '@@ -0,1 +1 @@\n-a\n+b\n', expected: ERR },
  { name: 'context-mismatch', original: 'a\nb\n', patch: '@@ -1 +1 @@\n-c\n+d\n', expected: ERR },
  { name: 'empty-original-with-old-lines', original: '', patch: '@@ -1 +1 @@\n-a\n+b\n', expected: ERR },
  { name: 'crlf-preserved-when-patch-has-cr', original: 'a\r\nb\r\n', patch: '@@ -1 +1 @@\n-a\r\n+A\r\n', expected: 'A\r\nb\r\n' },
  { name: 'crlf-file-lf-patch-does-not-apply', original: 'a\r\nb\r\n', patch: '@@ -1 +1 @@\n-a\n+A\n', expected: ERR },
  { name: 'stray-line-between-hunks', original: 'a\nb\n', patch: '@@ -1 +1 @@\n-a\n+A\n junk\n@@ -2 +2 @@\n-b\n+B\n', expected: ERR },
  { name: 'no-eol-file-with-marker-hunk', original: 'a\nb', patch: `@@ -2 +2 @@\n-b\n${nl}\n+B\n${nl}\n`, expected: 'a\nB' },
  { name: 'no-eol-file-without-marker-does-not-apply', original: 'a\nb', patch: '@@ -2 +2 @@\n-b\n+B\n', expected: ERR },
  { name: 'removing-no-eol-line-adds-terminator', original: 'a\nb', patch: `@@ -2 +2 @@\n-b\n${nl}\n+B\n`, expected: 'a\nB\n' },
  { name: 'adding-no-eol-line', original: 'a\nb\n', patch: `@@ -2 +2 @@\n-b\n+B\n${nl}\n`, expected: 'a\nB' },
  { name: 'marker-on-context-then-more-new-lines-is-error', original: 'a\nb', patch: `@@ -1,2 +1,3 @@\n a\n b\n${nl}\n+c\n`, expected: ERR },
  { name: 'replace-no-eol-line-with-two-terminated-lines', original: 'a', patch: `@@ -1 +1,2 @@\n-a\n${nl}\n+a\n+b\n`, expected: 'a\nb\n' },
  { name: 'insert-into-empty-original', original: '', patch: '@@ -0,0 +1 @@\n+a\n', expected: 'a\n' },
  { name: 'insert-into-empty-original-no-eol', original: '', patch: `@@ -0,0 +1 @@\n+a\n${nl}\n`, expected: 'a' },
  { name: 'insert-after-no-eol-last-line-gets-terminator', original: 'a', patch: '@@ -1,0 +2 @@\n+b\n', expected: 'a\nb\n' },
  { name: 'marker-without-preceding-line', original: 'a\n', patch: `@@ -1 +1 @@\n${nl}\n-a\n+b\n`, expected: ERR },
  { name: 'double-marker', original: 'a', patch: `@@ -1 +1 @@\n-a\n${nl}\n${nl}\n+b\n`, expected: ERR },
  { name: 'context-line-text-may-start-with-at-signs', original: '@@ -1 +1 @@\nb\n', patch: '@@ -1,2 +1,2 @@\n @@ -1 +1 @@\n-b\n+B\n', expected: '@@ -1 +1 @@\nB\n' },
  { name: 'three-hunks-with-drift-and-growth', original: '1\n2\n3\n4\n5\n6\n7\n8\n', patch: '@@ -1 +1,2 @@\n-1\n+1a\n+1b\n@@ -4 +5 @@\n-5\n+five\n@@ -8 +9 @@\n-8\n+eight\n', expected: '1a\n1b\n2\n3\n4\nfive\n6\n7\neight\n' },
  { name: 'unchanged-content-round-trip', original: 'a\nb\n', patch: '@@ -1,2 +1,2 @@\n a\n b\n', expected: 'a\nb\n' },
  { name: 'unicode-content', original: 'héllo\n日本語\n', patch: '@@ -2 +2 @@\n-日本語\n+日本\n', expected: 'héllo\n日本\n' },
];
const oracle_results: { name: string; exit_code: number }[] = [];
try {
  const mod = await import(pathToFileURL(join(resolve(workspace), 'patch.ts')).href);
  const { applyPatch, PatchError } = mod;
  if (typeof applyPatch !== 'function' || typeof PatchError !== 'function') throw new Error('missing exports');
  for (const c of cases) {
    let ok = false;
    try {
      const got = applyPatch(c.original, c.patch);
      ok = c.expected !== ERR && got === c.expected;
    } catch (e) {
      ok = c.expected === ERR && e instanceof PatchError;
    }
    oracle_results.push({ name: c.name, exit_code: ok ? 0 : 1 });
  }
} catch {
  oracle_results.push({ name: 'artifact-load', exit_code: 1 });
}
const score = Number(oracle_results.length > 0 && oracle_results.every((r) => r.exit_code === 0));
console.log(JSON.stringify({ score, oracle_results }));
process.exit(score === 1 ? 0 : 1);
