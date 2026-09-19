/** Child of oracle/score.ts: calls every rule with every checked input and prints plain data. It never sees expected.json. */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const stringify = JSON.stringify.bind(JSON);
const write = process.stdout.write.bind(process.stdout);
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
write('\n@@RESULT@@' + stringify(out) + '\n');
process.exit(0);
