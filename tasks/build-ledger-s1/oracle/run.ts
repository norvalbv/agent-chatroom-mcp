/** Child of oracle/score.ts: runs every scenario against the workspace and prints the results as data. It never sees expected.json.
 * The result is written to fd 3 (a pipe score.ts owns), not stdout: stdout is shared with anything the workspace's own top-level
 * code prints, including a hook that races or preempts us, so it is never trusted. writeSyncFd3 and the fs module reference are
 * captured in a local closure BEFORE the workspace import runs, so a module that reassigns fs.writeSync afterward cannot change
 * what this file itself calls. If the workspace's own code exits the process before this file's own write runs, fd 3 stays
 * empty, which score.ts correctly reads as no result rather than a forged pass.
 */
import { writeSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { SCENARIOS } from './scenarios.ts';

const writeSyncFd3 = writeSync;
const stringify = JSON.stringify.bind(JSON);
const [workspace, mText] = process.argv.slice(2);
const out: Record<string, { ok: boolean; value?: unknown }> = {};
let W: any = null;
try { W = (await import(pathToFileURL(resolve(workspace, 'src', 'warehouse.ts')).href)).Warehouse; } catch { W = null; }
for (const id of Object.keys(SCENARIOS)) {
  try { out[id] = W ? { ok: true, value: JSON.parse(stringify(SCENARIOS[id](W, Number(mText)))) } : { ok: false }; } catch { out[id] = { ok: false }; }
}
writeSyncFd3(3, stringify(out));
process.exit(0);
