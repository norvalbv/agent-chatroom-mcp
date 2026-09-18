/** Cross-checks every oracle case against Python's shlex.split(posix=True) and the reference implementation.
 * node --import tsx tasks/bench-shell-split/oracle/verify-against-python.ts [--write]
 */
import { spawnSync } from 'node:child_process';
import { cases } from './cases.ts';
import { shellSplit } from '../fixtures/correct/split.ts';

const py = `import sys, json, shlex
out = {}
for name, text in json.load(sys.stdin).items():
    try:
        out[name] = shlex.split(text, posix=True)
    except ValueError:
        out[name] = None
print(json.dumps(out))`;
const run = spawnSync('python3', ['-c', py], { input: JSON.stringify(Object.fromEntries(cases.map((c) => [c.name, c.input]))), encoding: 'utf8' });
if (run.status !== 0) throw new Error(run.stderr);
const python = JSON.parse(run.stdout) as Record<string, string[] | null>;
const expected: Record<string, string[] | null> = {};
let bad = 0;
for (const c of cases) {
  let ref: string[] | null;
  try { ref = shellSplit(c.input); } catch { ref = null; }
  const same = JSON.stringify(ref) === JSON.stringify(python[c.name]);
  if (!same) bad++;
  expected[c.name] = python[c.name];
  console.log(`${same ? 'ok  ' : 'DIFF'} ${c.name} py=${JSON.stringify(python[c.name])} ref=${JSON.stringify(ref)}`);
}
console.log(bad ? `${bad} DISAGREEMENTS` : `all ${cases.length} agree with python shlex`);
if (process.argv.includes('--write')) console.log(JSON.stringify(expected));
process.exit(bad ? 1 : 0);
