/** Generator for the rule-bank planted-defect family (tasks/build-rules-s<seed>): a wide codebase of 24 small
 * business rules over 8 modules, a SPEC.md that lists each rule as a table row, and ten planted defects (boundary
 * off-by-one, wrong rounding mode, swapped constants, wrong fallback, wrong order of operations, a unit slip across
 * modules), two of them encoded in a public test. src/ has no comments. Breadth, not depth, is what limits a single
 * reader: the family exists because the 9-defect billing instances were solved 5/5 by one agent (see
 * evidence/admission-pilot in the room that built it, and docs/build-suite-admission.md).
 *   node --import tsx scripts/bench-build-rules-gen.ts <seed> [--out dir]
 * Expected values of hidden checks are frozen from the correct build (oracle/expected.json).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

function rng(seed: number) {
  let a = (seed * 2654435761 >>> 0) || 1;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const NOUNS = ['shipping', 'handling', 'insurance', 'loyalty', 'referral', 'storage', 'restock', 'gift', 'warranty', 'priority', 'bulk', 'seasonal', 'pickup', 'rush', 'return', 'deposit', 'setup', 'support', 'license', 'upgrade', 'export', 'audit', 'onsite', 'archive'];
const MODULES = ['delivery', 'promotions', 'storage', 'service', 'accounts', 'fees', 'contracts', 'compliance'];
type Rule = { id: string; module: string; fn: string; tmpl: string; kind: string; params: any; defect: boolean; misleading: boolean; variant: number };
export type RulesInstance = { seed: number; rules: Rule[] };
const TEMPLATES = ['band', 'round', 'clamp', 'window', 'order', 'table', 'fallback', 'cap', 'cross'] as const;
const KIND: Record<string, string> = { band: 'boundary', round: 'spec-vs-code', clamp: 'boundary', window: 'boundary', order: 'spec-vs-code', table: 'spec-vs-code', fallback: 'spec-vs-code', cap: 'boundary', cross: 'cross-module-contract' };
const SUFFIX: Record<string, string> = { band: 'Band', round: 'Fee', clamp: 'Limit', window: 'Valid', order: 'Net', table: 'Rate', fallback: 'Code', cap: 'Free', cross: 'Quote' };

export function deriveRules(seed: number): RulesInstance {
  const r = rng(seed);
  const int = (lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));
  const shuffle = <T>(xs: T[]) => { const a = [...xs]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const nouns = shuffle(NOUNS);
  const tmpls = shuffle([...TEMPLATES, ...TEMPLATES, ...TEMPLATES]).slice(0, 24);
  const planted = new Set(shuffle([...Array(24).keys()]).slice(0, 10));
  const misleading = new Set([...planted].filter((i) => TEMPLATES[0] && ['band', 'cap', 'window', 'clamp'].includes(tmpls[i])).slice(0, 2));
  const rules: Rule[] = [];
  for (let i = 0; i < 24; i++) {
    const t = tmpls[i];
    const t1 = int(10, 60);
    const params: any =
      t === 'band' ? { t1, t2: t1 + int(20, 80), a: int(3, 9) * 50, b: int(10, 15) * 50, c: int(16, 25) * 50 } :
      t === 'round' ? { num: int(2, 9), den: int(3, 8) * 3 + 1, mode: ['up', 'down', 'half'][int(0, 2)] } :
      t === 'clamp' ? { lo: int(2, 9) * 10, hi: int(20, 60) * 10 } :
      t === 'window' ? { start: int(10, 200), len: int(7, 40) } :
      t === 'order' ? { bps: int(5, 20) * 100 } :
      t === 'table' ? { k: shuffle(['bronze', 'silver', 'gold']), v: shuffle([int(3, 6), int(7, 12), int(13, 20)]).map((x) => x * 25) } :
      t === 'fallback' ? { codes: ['a', 'b', 'c'].map((c) => `${c}${int(10, 99)}`), v: shuffle([int(2, 9) * 40, int(10, 15) * 40, int(16, 22) * 40]), dflt: int(6, 11) * 40 } :
      t === 'cap' ? { n: int(3, 12), price: int(4, 12) * 25 } :
      { pct: int(3, 17) };
    rules.push({ id: `${nouns[i]}${SUFFIX[t]}`, module: MODULES[i % 8], fn: `${nouns[i]}${SUFFIX[t]}`, tmpl: t, kind: KIND[t], params, defect: planted.has(i), misleading: misleading.has(i), variant: int(0, 1) });
  }
  return { seed, rules };
}

function code(r: Rule, bad: boolean): string {
  const p = r.params, f = r.fn;
  switch (r.tmpl) {
    case 'band': return `export function ${f}(x: number): number {\n  return x ${bad && r.variant === 0 ? '<=' : '<'} ${p.t1} ? ${p.a} : x ${bad && r.variant === 1 ? '<=' : '<'} ${p.t2} ? ${p.b} : ${p.c};\n}\n`;
    case 'round': {
      const good = p.mode;
      const m = bad ? (['up', 'down', 'half'] as const).filter((x) => x !== good)[r.variant] : good;
      const fn = m === 'up' ? 'Math.ceil' : m === 'down' ? 'Math.floor' : 'Math.round';
      return `export function ${f}(amount: number): number {\n  return ${fn}(amount * ${p.num} / ${p.den});\n}\n`;
    }
    case 'clamp': return `export function ${f}(x: number): number {\n  ${bad ? `if (x >= ${p.hi}) return ${p.hi - 1};\n  return Math.max(${p.lo}, x);` : `return Math.min(${p.hi}, Math.max(${p.lo}, x));`}\n}\n`;
    case 'window': return `export function ${f}(day: number): boolean {\n  return day >= ${p.start} && day ${bad ? '<=' : '<'} ${p.start + p.len};\n}\n`;
    case 'order': return `import { roundHalfUp } from './units.ts';\n\nexport function ${f}(base: number, discount: number): number {\n  ${bad ? `return base + roundHalfUp(base * ${p.bps} / 10000) - discount;` : `const net = base - discount;\n  return net + roundHalfUp(net * ${p.bps} / 10000);`}\n}\n`;
    case 'table': {
      const v = [...p.v];
      if (bad) [v[r.variant], v[r.variant + 1]] = [v[r.variant + 1], v[r.variant]];
      return `const ${f}Table: Record<string, number> = { ${p.k.map((k: string, i: number) => `${k}: ${v[i]}`).join(', ')} };\n\nexport function ${f}(tier: string): number {\n  return ${f}Table[tier];\n}\n`;
    }
    case 'fallback': return `const ${f}Table: Record<string, number> = { ${p.codes.map((c: string, i: number) => `${c}: ${p.v[i]}`).join(', ')} };\n\nexport function ${f}(code: string): number {\n  return ${f}Table[code] ${bad ? '?? 0' : `?? ${p.dflt}`};\n}\n`;
    case 'cap': return `export function ${f}(units: number): number {\n  return Math.min(units, ${bad ? p.n - 1 : p.n}) * ${p.price};\n}\n`;
    default: return `import { toCents } from './units.ts';\n\nexport function ${f}(dollars: number): number {\n  return ${bad ? `Math.round(dollars * ${p.pct} / 100)` : `Math.round(toCents(dollars) * ${p.pct} / 100)`};\n}\n`;
  }
}

/** [boundary calls that separate good from bad, calls that hold in both] */
function calls(r: Rule): { defect: unknown[][]; reg: unknown[][] } {
  const p = r.params;
  switch (r.tmpl) {
    case 'band': return { defect: [[p.t1], [p.t2]], reg: [[1], [p.t1 - 1], [p.t2 + 40]] };
    case 'round': return { defect: [[7], [10], [101], [999], [1234]], reg: [[0], [p.den * 10]] };
    case 'clamp': return { defect: [[p.hi], [p.hi + 40]], reg: [[p.lo - 5], [p.lo], [p.lo + 3], [p.hi - 4]] };
    case 'window': return { defect: [[p.start + p.len]], reg: [[p.start - 1], [p.start], [p.start + p.len - 1], [p.start + p.len + 9]] };
    case 'order': return { defect: [[10000, 1500], [25050, 3333]], reg: [[10000, 0], [0, 0]] };
    case 'table': return { defect: [p.k.map((k: string) => [k])[0], [p.k[1]], [p.k[2]]].map((x) => (Array.isArray(x) ? x : [x])), reg: [] };
    case 'fallback': return { defect: [['zz-unknown'], ['']], reg: p.codes.map((c: string) => [c]) };
    case 'cap': return { defect: [[p.n], [p.n + 3]], reg: [[0], [1], [p.n - 2]] };
    default: return { defect: [[12.5], [99.99], [3]], reg: [[0]] };
  }
}

const SPEC_LINE = (r: Rule): string => {
  const p = r.params, f = '`' + r.fn + '`';
  switch (r.tmpl) {
    case 'band': return `${f}(x): ${p.a} for x below ${p.t1}; ${p.b} from ${p.t1} up to but not including ${p.t2}; ${p.c} from ${p.t2} upward.`;
    case 'round': return `${f}(amount): ${p.num}/${p.den} of the amount, ${p.mode === 'up' ? 'rounded up to a whole cent' : p.mode === 'down' ? 'rounded down to a whole cent' : 'rounded to the nearest whole cent'}.`;
    case 'clamp': return `${f}(x): x, but never below ${p.lo} and never above ${p.hi} (both limits are themselves allowed).`;
    case 'window': return `${f}(day): true for the ${p.len} days starting on day ${p.start} (day ${p.start} is the first), false otherwise.`;
    case 'order': return `${f}(base, discount): the discount comes off first, then tax of ${p.bps / 100}% (in cents, rounded half up) is charged on what remains.`;
    case 'table': return `${f}(tier): ${p.k.map((k: string, i: number) => `${k} ${p.v[i]}`).join(', ')}.`;
    case 'fallback': return `${f}(code): ${p.codes.map((c: string, i: number) => `${c} ${p.v[i]}`).join(', ')}; every other code costs ${p.dflt}.`;
    case 'cap': return `${f}(units): the first ${p.n} units are charged ${p.price} each; nothing is charged beyond that.`;
    default: return `${f}(dollars): a price in dollars in, the fee in cents out: ${p.pct}% of the price, rounded half up to a whole cent.`;
  }
};

export function buildRuleSrc(inst: RulesInstance, fixed: Set<string>): Record<string, string> {
  const files: Record<string, string> = {
    'units.ts': `export function roundHalfUp(x: number): number {\n  return x < 0 ? -Math.round(-x) : Math.round(x);\n}\n\nexport function toCents(dollars: number): number {\n  return Math.round(dollars * 100);\n}\n`,
  };
  for (const m of MODULES) {
    const rs = inst.rules.filter((r) => r.module === m);
    files[`${m}.ts`] = rs.map((r) => code(r, r.defect && !fixed.has(r.id))).join('\n');
    const imports = new Set<string>();
    for (const r of rs) for (const line of code(r, false).split('\n')) if (line.startsWith('import ')) imports.add(line);
    if (imports.size) files[`${m}.ts`] = [...imports].join('\n') + '\n\n' + files[`${m}.ts`].split('\n').filter((l) => !l.startsWith('import ')).join('\n').replace(/^\n+/, '');
  }
  return files;
}

const SPEC = (inst: RulesInstance) => `# Pricing rules specification

Every function below is exported from the module named in its heading. Amounts are integer cents unless a rule says
otherwise. \`units.ts\` holds two helpers used by several modules; it is not itself changed by any rule.

${MODULES.map((m) => `## ${m}.ts\n\n${inst.rules.filter((r) => r.module === m).map((r) => '- ' + SPEC_LINE(r)).join('\n')}\n`).join('\n')}`;

const BRIEF = `The library in src/ must meet the rules in SPEC.md. The public tests in test/ pass today, but passing them does not prove the code meets the specification. Make the codebase conform to SPEC.md, keeping everything that already conforms working. Run the tests with: node --test test/*.test.ts. Do not create files outside this directory.`;

export async function writeRulesTask(seed: number, out: string) {
  const inst = deriveRules(seed);
  const id = out.split('/').pop()!;
  const w = (rel: string, body: string) => { const f = join(out, rel); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, body); };
  const bad = buildRuleSrc(inst, new Set());
  const good = buildRuleSrc(inst, new Set(inst.rules.filter((x) => x.defect).map((x) => x.id)));
  for (const [f, b] of Object.entries(bad)) { w(`public/src/${f}`, b); w(`fixtures/broken/src/${f}`, b); }
  for (const [f, b] of Object.entries(good)) w(`fixtures/correct/src/${f}`, b);
  const load = async (dir: string) => { const m: Record<string, any> = {}; for (const n of ['units', ...MODULES]) m[n] = await import(pathToFileURL(resolve(dir, n + '.ts')).href + '?t=' + Math.random()); return m; };
  for (const d of ['fixtures/correct/src', 'fixtures/broken/src']) mkdirSync(resolve(out, d), { recursive: true });
  const gm = await load(resolve(out, 'fixtures/correct/src'));
  const bm = await load(resolve(out, 'fixtures/broken/src'));
  const J = (x: unknown) => JSON.parse(JSON.stringify(x === undefined ? null : x));
  const expected: Record<string, unknown> = {};
  const checks: { id: string; module: string; fn: string; defect: unknown[][]; reg: unknown[][] }[] = [];
  const tests: Record<string, string[]> = {};
  for (const r of inst.rules) {
    const c = calls(r);
    const ev = (m: any, args: unknown[]) => J(m[r.module][r.fn](...args));
    if (r.defect) {
      const differs = c.defect.some((a) => JSON.stringify(ev(gm, a)) !== JSON.stringify(ev(bm, a)));
      if (!differs) throw new Error(`defect ${r.id} indistinguishable`);
    }
    if (c.reg.some((a) => JSON.stringify(ev(gm, a)) !== JSON.stringify(ev(bm, a)))) throw new Error(`regression inputs of ${r.id} touch its defect`);
    checks.push({ id: r.id, module: r.module, fn: r.fn, defect: c.defect, reg: c.reg });
    expected[r.id] = { defect: c.defect.map((a) => ev(gm, a)), reg: c.reg.map((a) => ev(gm, a)) };
    const pub = r.misleading ? c.defect.filter((a) => JSON.stringify(ev(gm, a)) !== JSON.stringify(ev(bm, a)))[0] : (c.reg[c.reg.length - 1] ?? c.reg[0]);
    if (pub) (tests[r.module] ??= []).push(`test('${r.fn}', () => { assert.deepEqual(${r.module}.${r.fn}(${(pub as unknown[]).map((x) => JSON.stringify(x)).join(', ')}), ${JSON.stringify(ev(r.misleading ? bm : gm, pub as unknown[]))}); });`);
  }
  for (const m of MODULES) w(`public/test/${m}.test.ts`, `import assert from 'node:assert/strict';\nimport { test } from 'node:test';\nimport * as ${m} from '../src/${m}.ts';\n\n${(tests[m] ?? []).join('\n')}\n`);
  w('public/SPEC.md', SPEC(inst));
  w('public/brief.txt', BRIEF + '\n');
  w('task.json', JSON.stringify({ task_id: id }) + '\n');
  w('oracle/oracle.json', JSON.stringify({ kind: 'planted-defects' }) + '\n');
  w('oracle/instance.json', JSON.stringify({ seed, family: 'rules', defects: inst.rules.filter((r) => r.defect).map((r) => r.id), rules: inst.rules, checks }, null, 2) + '\n');
  w('oracle/DEFECTS.json', JSON.stringify(inst.rules.filter((r) => r.defect).map((r) => ({ id: r.id, module: r.module, kind: r.kind, template: r.tmpl, public_test_encodes_bug: r.misleading })), null, 2) + '\n');
  w('oracle/expected.json', JSON.stringify(expected, null, 2) + '\n');
  w('oracle/score.ts', RULES_SCORE);
  w('README.md', `# ${id}\n\nGenerated by scripts/bench-build-rules-gen.ts (seed ${seed}); 24 rules, ${inst.rules.filter((r) => r.defect).length} planted defects listed in oracle/DEFECTS.json. Only public/ reaches a seat.\n`);
  return inst;
}

const RULES_SCORE = `/** Private oracle for a generated rule-bank task. node --import tsx oracle/score.ts WORKSPACE
 * One defect/<id> check per planted rule (its boundary calls), one regression/<id> check per rule (calls that hold in the
 * original code). Prints {score, oracle_results, defects_planted, defects_caught, defects_shipped, regressions_failed, ...}.
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const workspace = process.argv[2];
if (!workspace) { console.error('usage: score.ts WORKSPACE'); process.exit(2); }
const here = dirname(fileURLToPath(import.meta.url));
const inst = JSON.parse(readFileSync(join(here, 'instance.json'), 'utf8'));
const expected = JSON.parse(readFileSync(join(here, 'expected.json'), 'utf8'));
const mods: Record<string, any> = {};
const broken = new Set<string>();
for (const n of new Set<string>(inst.checks.map((c: any) => c.module))) {
  try { mods[n] = await import(pathToFileURL(resolve(workspace, 'src', n + '.ts')).href + '?t=' + Date.now()); }
  catch { broken.add(n); }
}
const J = (x: unknown) => JSON.stringify(x === undefined ? null : x);
function run(c: any, which: 'defect' | 'reg'): boolean {
  if (broken.has(c.module)) return false;
  try { return c[which].every((args: unknown[], i: number) => J(mods[c.module][c.fn](...args)) === J(expected[c.id][which][i])); }
  catch { return false; }
}
const oracle_results: { name: string; exit_code: number }[] = [];
const caught_ids: string[] = [], missed_ids: string[] = [], regression_failed_ids: string[] = [];
for (const c of inst.checks) {
  if (inst.defects.includes(c.id)) { const ok = run(c, 'defect'); oracle_results.push({ name: 'defect/' + c.id, exit_code: ok ? 0 : 1 }); (ok ? caught_ids : missed_ids).push(c.id); }
  const ok = run(c, 'reg'); oracle_results.push({ name: 'regression/' + c.id, exit_code: ok ? 0 : 1 }); if (!ok) regression_failed_ids.push(c.id);
}
const score = missed_ids.length === 0 && regression_failed_ids.length === 0 ? 1 : 0;
console.log(JSON.stringify({ score, oracle_results, defects_planted: inst.defects.length, defects_caught: caught_ids.length, defects_shipped: missed_ids.length + regression_failed_ids.length, regressions_failed: regression_failed_ids.length, caught_ids, missed_ids, regression_failed_ids }));
process.exit(score === 1 ? 0 : 1);
`;

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const seed = Number(process.argv[2]);
  if (!Number.isInteger(seed)) { console.error('usage: bench-build-rules-gen.ts <seed> [--out dir]'); process.exit(2); }
  const oi = process.argv.indexOf('--out');
  const out = resolve(oi > 0 ? process.argv[oi + 1] : `tasks/build-rules-s${seed}`);
  writeRulesTask(seed, out).then((i) => console.log(i.rules.filter((r) => r.defect).map((r) => r.id).join(' ')));
}
