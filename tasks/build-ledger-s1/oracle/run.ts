/** Child of oracle/score.ts: runs every scenario against the workspace and prints the results as data. It never sees expected.json. */
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { SCENARIOS } from './scenarios.ts';

const stringify = JSON.stringify.bind(JSON);
const write = process.stdout.write.bind(process.stdout);
const [workspace, mText] = process.argv.slice(2);
const out: Record<string, { ok: boolean; value?: unknown }> = {};
let W: any = null;
try { W = (await import(pathToFileURL(resolve(workspace, 'src', 'warehouse.ts')).href)).Warehouse; } catch { W = null; }
for (const id of Object.keys(SCENARIOS)) {
  try { out[id] = W ? { ok: true, value: JSON.parse(stringify(SCENARIOS[id](W, Number(mText)))) } : { ok: false }; } catch { out[id] = { ok: false }; }
}
write('\n@@RESULT@@' + stringify(out) + '\n');
process.exit(0);
