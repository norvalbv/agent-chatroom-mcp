// Hidden second implementation (BigInt, integer-only) used to cross-check oracle.json, which came from generate.py (Fraction).
import { readFileSync } from 'node:fs';
function toRatio(s) {
  const m = /^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(s.trim());
  const neg = m[1] === '-'; const frac = m[3] || '';
  let n = BigInt((m[2] || '') + frac || '0'); let d = 10n ** BigInt(frac.length);
  const ex = BigInt(m[4] || '0');
  if (ex >= 0n) n *= 10n ** ex; else d *= 10n ** -ex;
  return { neg, n, d };
}
// round n/d * 2^k to nearest integer, ties to even, for integer k (any sign)
function scaledRound(n, d, k) {
  if (k >= 0n) n *= 2n ** k; else d *= 2n ** -k;
  const q = n / d, r = n % d;
  if (2n * r > d || (2n * r === d && (q & 1n) === 1n)) return q + 1n;
  return q;
}
function enc(s) {
  const { neg, n, d } = toRatio(s); const sign = neg ? 0x8000n : 0n;
  if (n === 0n) return sign;
  // floor(log2(n/d)) via bit lengths then fix up
  let e = BigInt(n.toString(2).length - d.toString(2).length);
  const geq = (k) => (k >= 0n ? n >= d * 2n ** k : n * 2n ** -k >= d);
  while (!geq(e)) e -= 1n;
  while (geq(e + 1n)) e += 1n;
  if (e < -14n) return sign | scaledRound(n, d, 24n);
  let m = scaledRound(n, d, 10n - e);
  if (m === 2048n) { e += 1n; m = 1024n; }
  if (e > 15n) return sign | 0x7c00n;
  return sign | ((e + 15n) << 10n) | (m - 1024n);
}
const lines = readFileSync(process.argv[2], 'utf8').split('\n').filter(l => l.trim());
console.log(lines.map(l => enc(l).toString(16).padStart(4, '0')).join(' '));
