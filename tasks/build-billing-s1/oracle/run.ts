/** Child of oracle/score.ts: runs every check against the workspace and prints plain data. It never sees expected.json. */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { CHECKS } from './checks.ts';

const stringify = JSON.stringify.bind(JSON);
const write = process.stdout.write.bind(process.stdout);
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
write('\n@@RESULT@@' + stringify(out) + '\n');
process.exit(0);
