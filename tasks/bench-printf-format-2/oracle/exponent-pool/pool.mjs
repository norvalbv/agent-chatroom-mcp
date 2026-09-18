import { writeFileSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const buf = new DataView(new ArrayBuffer(8));
const up = (x, n) => { buf.setFloat64(0, x); let b = buf.getBigUint64(0); b += BigInt(n); buf.setBigUint64(0, b); return buf.getFloat64(0); };
const vals = new Map();
const add = (x, tag) => { if (Number.isFinite(x)) vals.set(String(x), tag); };
for (let k = -45; k <= 45; k++) {
  const p = Number('1e' + k);
  add(p, 'pow'); add(up(p, -1), 'below'); add(up(p, 1), 'above');
  add(Number('9.5e' + k), 'nine5'); add(Number('9.9999995e' + k), 'nines'); add(Number('5e' + k), 'five'); add(Number('1.5e' + k), 'onefive');
}
for (const x of [5e-324, 2.2250738585072014e-308, 2.225073858507201e-308, 1.7976931348623157e308, 4.9e-324, 1e23, 1e22, 1e21, 9007199254740993, 4503599627370497.5, 2 ** 53, 2 ** 60, 2 ** -30, 2 ** -60, 0.5, 1.5, 2.5, 3.5, 0.125, 0.375, 0.25, 0.75, 1.125, 1.375, 2.675, 1.005, 0.1, 0.2, 0.3, 1 / 3, 2 / 3, 100, 1000, 12345.6789, 99999.95, 999999.5, 9999995, 0.000099999995, 0.00009999995]) add(x, 'misc');
const fmts = [];
for (const n of [0, 1, 2, 3, 5, 6, 10, 14, 15, 16, 17, 18, 20, 25]) { fmts.push(`%.${n}g`, `%.${n}e`, `%#.${n}g`); }
for (const n of [0, 1, 2, 3, 6, 10, 20, 30]) fmts.push(`%.${n}f`);
fmts.push('%g', '%e', '%f', '%G', '%E', '%+g', '% e', '%12.4e', '%-14.3g|', '%014.5f', '%#.0e', '%#.0f');
const rows = [];
for (const [s] of vals) for (const f of fmts) for (const sign of ['', '-']) { rows.push([f, sign + s]); }
writeFileSync('rows.tsv', rows.map((r) => r.join('\t')).join('\n') + '\n');
const out = execFileSync('./lib', { input: readFileSync('rows.tsv'), maxBuffer: 1 << 28 }).toString().split('\n');
const cases = rows.map((r, i) => ({ fmt: r[0], args: [{ n: r[1] }], expected: out[i] }));
writeFileSync('pool.json', JSON.stringify(cases));
console.log('rows', rows.length);
