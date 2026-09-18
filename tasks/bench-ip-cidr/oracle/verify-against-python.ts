/** Cross-checks every oracle case against Python's ipaddress module and the reference implementation.
 * node --import tsx tasks/bench-ip-cidr/oracle/verify-against-python.ts [--write]
 */
import { spawnSync } from 'node:child_process';
import { cases } from './cases.ts';
import * as ref from '../fixtures/correct/ip.ts';

const py = `import sys, json, ipaddress
def run(fn, args):
    try:
        if fn == 'normalizeIPv6': return ipaddress.IPv6Address(args[0]).compressed
        if fn == 'expandIPv6': return ipaddress.IPv6Address(args[0]).exploded
        if fn == 'cidrRange':
            if '/' not in args[0]: raise ValueError
            n = ipaddress.IPv6Network(args[0], strict=False)
            return {'first': n[0].compressed, 'last': n[-1].compressed}
        if fn == 'cidrContains':
            n = ipaddress.IPv6Network(args[0], strict=False)
            return ipaddress.IPv6Address(args[1]) in n
    except ValueError:
        return None
out = [run(c['fn'], c['args']) for c in json.load(sys.stdin)]
print(json.dumps(out))`;
const run = spawnSync('python3', ['-c', py], { input: JSON.stringify(cases), encoding: 'utf8' });
if (run.status !== 0) throw new Error(run.stderr);
const python = JSON.parse(run.stdout) as unknown[];
const expected: Record<string, unknown> = {};
let bad = 0;
cases.forEach((c, i) => {
  let mine: unknown;
  try { mine = (ref as any)[c.fn](...c.args); } catch { mine = null; }
  const same = JSON.stringify(mine) === JSON.stringify(python[i]);
  if (!same) bad++;
  expected[c.name] = python[i];
  console.log(`${same ? 'ok  ' : 'DIFF'} ${c.name} py=${JSON.stringify(python[i])} ref=${JSON.stringify(mine)}`);
});
console.log(bad ? `${bad} DISAGREEMENTS` : `all ${cases.length} agree with python ipaddress`);
if (process.argv.includes('--write')) console.log(JSON.stringify(expected));
process.exit(bad ? 1 : 0);
