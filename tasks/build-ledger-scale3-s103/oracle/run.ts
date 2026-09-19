/** Child of oracle/score.ts: runs every scenario against every shard's workspace warehouse and prints the
 * results as data. It never sees expected.json. Result travels over fd 3 (a pipe score.ts owns), not shared
 * stdout, written only by this file's own writeSync reference captured before any workspace import runs.
 */
import { writeSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { SCENARIOS } from './scenarios.ts';

const writeSyncFd3 = writeSync;
const stringify = JSON.stringify.bind(JSON);
const [workspace, shardsArg, mArg] = process.argv.slice(2);
const shardIds: string[] = JSON.parse(shardsArg);
const mByShard: Record<string, number> = JSON.parse(mArg);
const out: Record<string, Record<string, { ok: boolean; value?: unknown }>> = {};
for (const shard of shardIds) {
  let W: any = null;
  try { W = (await import(pathToFileURL(resolve(workspace, 'src', shard, 'warehouse.ts')).href)).Warehouse; } catch { W = null; }
  const shardOut: Record<string, { ok: boolean; value?: unknown }> = {};
  for (const id of Object.keys(SCENARIOS)) {
    try { shardOut[id] = W ? { ok: true, value: JSON.parse(stringify(SCENARIOS[id](W, Number(mByShard[shard])))) } : { ok: false }; } catch { shardOut[id] = { ok: false }; }
  }
  out[shard] = shardOut;
}
writeSyncFd3(3, stringify(out));
process.exit(0);
