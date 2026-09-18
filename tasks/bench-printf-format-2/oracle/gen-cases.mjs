// Builds oracle/cases.json: the 698 v1 cases (integer conversions that overflow 32 bits get an `l` modifier so their
// expected text is unchanged) plus new cases for length modifiers, `u`, negative x/X/o, and `*` width/precision, all
// with expected text from the C library through oracle/lib2.c (compile: cc -o lib2 lib2.c). usage: node gen-cases.mjs ./lib2
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const lib = process.argv[2] ?? './lib2';
const here = fileURLToPath(new URL('.', import.meta.url));
const old = JSON.parse(readFileSync(here + 'old-cases.json', 'utf8'));

const cLib = (rows) => {
  const input = rows.map((r) => r.join('\t')).join('\n') + '\n';
  return execFileSync(lib, { input, maxBuffer: 1 << 28 }).toString().split('\n').slice(0, rows.length);
};
const isFloatCase = (c) => c.args.some((a) => typeof a === 'object' && a !== null && 'n' in a);
const isStrCase = (c) => c.args.some((a) => typeof a === 'string');
const patched = [];
const intRows = []; const intIdx = [];
old.forEach((c, i) => {
  let fmt = c.fmt;
  if (!isFloatCase(c) && !isStrCase(c) && c.args.length === 1 && /^%[-+ 0#]*\d*(\.\d*)?[diouxX]\|?$/.test(fmt)) {
    const v = BigInt(c.args[0]);
    const conv = fmt.match(/[diuxXo]/g).pop();
    const wide = (conv === 'd' || conv === 'i') ? (v > 2147483647n || v < -2147483648n) : (v >= 4294967296n || v < 0n);
    if (wide) fmt = fmt.replace(/([diuxXo])(\|?)$/, 'l$1$2');
    intRows.push([fmt, 'l', c.args[0].toString()]); intIdx.push(patched.length);
  }
  patched.push({ fmt, args: c.args, expected: c.expected });
});
const check = cLib(intRows);
intIdx.forEach((pi, k) => { if (check[k] !== patched[pi].expected) throw new Error(`old case changed: ${patched[pi].fmt} ${patched[pi].args} ${patched[pi].expected} vs ${check[k]}`); });

const V = ['0', '1', '-1', '7', '127', '128', '255', '256', '-127', '-128', '-129', '32767', '32768', '65535', '65536', '-32768', '-32769', '2147483647', '2147483648', '4294967295', '4294967296', '-2147483648', '-2147483649', '9007199254740991', '-9007199254740991', '9223372036854775807', '-9223372036854775808', '18446744073709551615'];
const W = ['0', '1', '-1', '127', '128', '255', '-129', '65535', '65536', '2147483648', '-2147483649', '4294967295'];
const mods = ['hh', 'h', '', 'l', 'll'];
const enc = (v) => { const b = BigInt(v); return (b >= -(2n ** 53n) + 1n && b <= 2n ** 53n - 1n) ? Number(b) : { b: v }; };
const next = [];
const push = (fmt, ints) => next.push({ fmt, args: ints.map(enc), cargs: ints });
for (const m of mods) {
  for (const conv of ['d', 'u', 'x', 'o']) for (const v of V) push(`%${m}${conv}`, [v]);
  for (const conv of ['i', 'X']) for (const v of W) push(`%${m}${conv}`, [v]);
  for (const v of W) {
    push(`%+${m}d`, [v]); push(`% ${m}d`, [v]); push(`%08${m}d`, [v]); push(`%.6${m}u`, [v]); push(`%-12${m}x|`, [v]);
    push(`%#${m}x`, [v]); push(`%#${m}X`, [v]); push(`%#${m}o`, [v]); push(`%12.5${m}d`, [v]); push(`%#10.4${m}x`, [v]); push(`%010${m}u`, [v]);
  }
  push(`%.0${m}d`, ['0']); push(`%.0${m}u`, ['0']); push(`%#.0${m}o`, ['0']); push(`%.0${m}x`, ['0']);
}
const widths = ['0', '1', '5', '12', '-1', '-5', '-12'];
const precs = ['0', '1', '3', '10', '-1', '-3'];
const sv = ['0', '1', '-1', '42', '-42', '255', '65536', '-2147483648', '4294967295'];
for (const w of widths) for (const v of sv) { push('%*d', [w, v]); push('%-*d|', [w, v]); push('%0*d', [w, v]); push('%+*d', [w, v]); push('%*llx', [w, v]); push('%#*hhx', [w, v]); }
for (const p of precs) for (const v of sv) { push('%.*d', [p, v]); push('%.*u', [p, v]); push('%#.*x', [p, v]); push('%#.*o', [p, v]); }
for (const w of ['5', '-5', '12', '-12']) for (const p of ['0', '3', '-3', '8']) for (const v of ['0', '-7', '255', '4294967295']) { push('%*.*d', [w, p, v]); push('%0*.*d', [w, p, v]); push('%-*.*x|', [w, p, v]); }
// type letters: every star argument is an int; the value argument is `l` when the format has an l/ll modifier or is a 64-bit value
const typed = next.map((c) => {
  const stars = (c.fmt.match(/\*/g) ?? []).length;
  return [c.fmt, 'i'.repeat(stars) + 'l', ...c.cargs];
});
const exp = cLib(typed);
const fresh = next.map((c, i) => ({ fmt: c.fmt, args: c.args, expected: exp[i] }));
// string / char with star
const strRows = [];
const strCases = [];
for (const w of ['0', '3', '8', '-3', '-8']) for (const s of ['', 'a', 'hello world']) { strCases.push({ fmt: '%*s', args: [enc(w), s], types: 'is', vals: [w, s] }); strCases.push({ fmt: '%-*s|', args: [enc(w), s], types: 'is', vals: [w, s] }); }
for (const p of ['0', '2', '5', '-1', '-4']) for (const s of ['', 'a', 'hello world']) strCases.push({ fmt: '%.*s', args: [enc(p), s], types: 'is', vals: [p, s] });
for (const w of ['4', '-4']) for (const p of ['0', '2', '-1']) strCases.push({ fmt: '%*.*s|', args: [enc(w), enc(p), 'abcdef'], types: 'iis', vals: [w, p, 'abcdef'] });
for (const w of ['3', '-3', '0']) strCases.push({ fmt: '%*c|', args: [enc(w), 'x'], types: 'ii', vals: [w, '120'] });
const sexp = cLib(strCases.map((c) => [c.fmt, c.types, ...c.vals]));
strCases.forEach((c, i) => fresh.push({ fmt: c.fmt, args: c.args, expected: sexp[i] }));
// float with star
const fl = ['3.14159', '-2.5', '0.1', '1e-07', '123456.789', '0'];
const fRows = []; const fCases = [];
for (const w of ['0', '10', '-10']) for (const x of fl) { fCases.push({ fmt: '%*f', args: [enc(w), { n: x }], types: 'id', vals: [w, x] }); fCases.push({ fmt: '%0*.3f', args: [enc(w), { n: x }], types: 'id', vals: [w, x] }); }
for (const p of ['0', '2', '17', '-1']) for (const x of fl) { fCases.push({ fmt: '%.*f', args: [enc(p), { n: x }], types: 'id', vals: [p, x] }); fCases.push({ fmt: '%.*e', args: [enc(p), { n: x }], types: 'id', vals: [p, x] }); fCases.push({ fmt: '%#.*g', args: [enc(p), { n: x }], types: 'id', vals: [p, x] }); }
for (const x of fl) fCases.push({ fmt: '%-*.*e|', args: [enc('-14'), enc('5'), { n: x }], types: 'iid', vals: ['-14', '5', x] });
const fexp = cLib(fCases.map((c) => [c.fmt, c.types, ...c.vals]));
fCases.forEach((c, i) => fresh.push({ fmt: c.fmt, args: c.args, expected: fexp[i] }));
const all = [...patched, ...fresh];
writeFileSync(here + 'cases.json', JSON.stringify(all));
console.log('old', patched.length, 'new', fresh.length, 'total', all.length);
