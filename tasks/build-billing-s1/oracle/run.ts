/** Child of oracle/score.ts: runs every check against the workspace and prints plain data. It never sees expected.json.
 * The result is written to fd 3 (a pipe score.ts owns), not stdout: stdout is shared with anything the workspace's own top-level
 * code prints, including a hook that races or preempts us, so it is never trusted. writeSyncFd3 is captured BEFORE the workspace
 * import runs, so a module that reassigns fs.writeSync afterward cannot change what this file itself calls. If the workspace's own
 * code exits the process before this file's own write runs, fd 3 stays empty, which score.ts correctly reads as no result.
 */
import { readFileSync, writeSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { CHECKS } from './checks.ts';

const writeSyncFd3 = writeSync;
const stringify = JSON.stringify.bind(JSON);
const workspace = process.argv[2];
const here = dirname(fileURLToPath(import.meta.url));
const inst = JSON.parse(readFileSync(join(here, 'instance.json'), 'utf8'));
const names = ['money', 'types', 'calendar', 'plans', 'proration', 'coupons', 'tax', 'invoice', 'dunning', 'report'];
const mods: Record<string, any> = {};
let loadError = false;
for (const n of names) {
  try { mods[n] = await import(pathToFileURL(resolve(workspace, 'src', n + '.ts')).href); } catch { loadError = true; }
}
const out: Record<string, { ok: boolean; value?: unknown }> = {};
for (const id of Object.keys(CHECKS)) {
  try { out[id] = loadError ? { ok: false } : { ok: true, value: JSON.parse(stringify(CHECKS[id](mods, inst.params))) }; } catch { out[id] = { ok: false }; }
}
writeSyncFd3(3, stringify(out));
process.exit(0);
