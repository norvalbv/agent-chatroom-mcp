/** Child of oracle/score.ts: calls every rule with every checked input and prints plain data. It never sees expected.json.
 * The result is written to fd 3 (a pipe score.ts owns), not stdout: stdout is shared with anything the workspace's own top-level
 * code prints, including a hook that races or preempts us, so it is never trusted. writeSyncFd3 is captured BEFORE the workspace
 * import runs, so a module that reassigns fs.writeSync afterward cannot change what this file itself calls. If the workspace's own
 * code exits the process before this file's own write runs, fd 3 stays empty, which score.ts correctly reads as no result.
 */
import { readFileSync, writeSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const writeSyncFd3 = writeSync;
const stringify = JSON.stringify.bind(JSON);
const workspace = process.argv[2];
const here = dirname(fileURLToPath(import.meta.url));
const inst = JSON.parse(readFileSync(join(here, 'instance.json'), 'utf8'));
const mods: Record<string, any> = {};
const broken = new Set<string>();
for (const n of new Set<string>(inst.checks.map((c: any) => c.module))) {
  try { mods[n] = await import(pathToFileURL(resolve(workspace, 'src', n + '.ts')).href); } catch { broken.add(n); }
}
const out: Record<string, { defect: unknown[]; reg: unknown[] }> = {};
const call = (c: any, args: unknown[]) => { try { return broken.has(c.module) ? { ok: false } : { ok: true, value: JSON.parse(stringify(mods[c.module][c.fn](...args) ?? null)) }; } catch { return { ok: false }; } };
for (const c of inst.checks) out[c.id] = { defect: c.defect.map((a: unknown[]) => call(c, a)), reg: c.reg.map((a: unknown[]) => call(c, a)) };
writeSyncFd3(3, stringify(out));
process.exit(0);
