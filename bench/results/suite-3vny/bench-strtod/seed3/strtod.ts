const WS = ' \t\n\v\f\r';

const isDec = (c: string | undefined): boolean => c !== undefined && c >= '0' && c <= '9';
const isHex = (c: string | undefined): boolean =>
  c !== undefined && ((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F'));

function bitLen(x: bigint): number {
  return x === 0n ? 0 : x.toString(2).length;
}

// Round num/den (both > 0) to the nearest binary64; returns the 64-bit pattern (without sign).
function roundRatio(num: bigint, den: bigint): bigint {
  const bl = bitLen(num) - bitLen(den);
  const s = Math.max(bl - 55, -1074);
  let n = num;
  let d = den;
  if (s < 0) n <<= BigInt(-s);
  else d <<= BigInt(s);
  let q = n / d;
  const r = n % d;
  const extra = Math.max(bitLen(q) - 53, -1074 - s);
  let sh = s + extra;
  if (extra === 0) {
    if (2n * r > d || (2n * r === d && (q & 1n) === 1n)) q += 1n;
  } else {
    const e = BigInt(extra);
    const low = q & ((1n << e) - 1n);
    q >>= e;
    const half = 1n << (e - 1n);
    if (low > half || (low === half && (r > 0n || (q & 1n) === 1n))) q += 1n;
  }
  if (q === 1n << 53n) {
    q >>= 1n;
    sh += 1;
  }
  if (q < 1n << 52n) return q;
  const biased = sh + 1075;
  if (biased >= 2047) return 0x7ff0000000000000n;
  return (BigInt(biased) << 52n) | (q - (1n << 52n));
}

function parseExp(str: string): number {
  // saturating; sign handled by caller
  const t = str.replace(/^0+/, '');
  if (t.length > 12) return 1e12;
  return t === '' ? 0 : Number(t);
}

export function strtod(s: string): { bits: string; end: number } {
  const zero = { bits: '0000000000000000', end: 0 };
  let i = 0;
  while (i < s.length && WS.includes(s[i])) i++;
  let neg = false;
  if (s[i] === '+' || s[i] === '-') {
    neg = s[i] === '-';
    i++;
  }
  const signBit = neg ? 1n << 63n : 0n;
  const fmt = (v: bigint) => v.toString(16).padStart(16, '0');
  const done = (mag: bigint, end: number) => ({ bits: fmt(mag | signBit), end });

  const rest = s.slice(i);
  const lower = rest.toLowerCase();

  // Hexadecimal
  if (lower.startsWith('0x')) {
    let j = i + 2;
    const a = j;
    while (isHex(s[j])) j++;
    const intD = s.slice(a, j);
    let fracD = '';
    let ok = intD.length > 0;
    if (s[j] === '.') {
      let k = j + 1;
      while (isHex(s[k])) k++;
      const f = s.slice(j + 1, k);
      if (intD.length > 0 || f.length > 0) {
        fracD = f;
        j = k;
        ok = true;
      }
    }
    if (ok) {
      let expv = 0;
      if (s[j] === 'p' || s[j] === 'P') {
        let k = j + 1;
        let en = false;
        if (s[k] === '+' || s[k] === '-') {
          en = s[k] === '-';
          k++;
        }
        const st = k;
        while (isDec(s[k])) k++;
        if (k > st) {
          const m = parseExp(s.slice(st, k));
          expv = en ? -m : m;
          j = k;
        }
      }
      const M = BigInt('0x' + (intD + fracD || '0'));
      if (M === 0n) return done(0n, j);
      const p2 = expv - 4 * fracD.length;
      const adj = bitLen(M) + p2;
      if (adj > 1100) return done(0x7ff0000000000000n, j);
      if (adj < -1200) return done(0n, j);
      return p2 >= 0 ? done(roundRatio(M << BigInt(p2), 1n), j) : done(roundRatio(M, 1n << BigInt(-p2)), j);
    }
  }

  // Infinity
  if (lower.startsWith('infinity')) return done(0x7ff0000000000000n, i + 8);
  if (lower.startsWith('inf')) return done(0x7ff0000000000000n, i + 3);

  // NaN
  if (lower.startsWith('nan')) {
    let end = i + 3;
    if (s[end] === '(') {
      let k = end + 1;
      while (k < s.length && /[A-Za-z0-9_]/.test(s[k])) k++;
      if (s[k] === ')') end = k + 1;
    }
    return { bits: 'nan', end };
  }

  // Decimal
  let j = i;
  while (isDec(s[j])) j++;
  const intD = s.slice(i, j);
  let fracD = '';
  let ok = intD.length > 0;
  if (s[j] === '.') {
    let k = j + 1;
    while (isDec(s[k])) k++;
    const f = s.slice(j + 1, k);
    if (intD.length > 0 || f.length > 0) {
      fracD = f;
      j = k;
      ok = true;
    }
  }
  if (!ok) return zero;
  let expv = 0;
  if (s[j] === 'e' || s[j] === 'E') {
    let k = j + 1;
    let en = false;
    if (s[k] === '+' || s[k] === '-') {
      en = s[k] === '-';
      k++;
    }
    const st = k;
    while (isDec(s[k])) k++;
    if (k > st) {
      const m = parseExp(s.slice(st, k));
      expv = en ? -m : m;
      j = k;
    }
  }
  const digits = (intD + fracD).replace(/^0+/, '');
  if (digits === '') return done(0n, j);
  const e10 = expv - fracD.length;
  const adj = digits.length + e10;
  if (adj > 320) return done(0x7ff0000000000000n, j);
  if (adj < -340) return done(0n, j);
  const M = BigInt(digits);
  return e10 >= 0
    ? done(roundRatio(M * 10n ** BigInt(e10), 1n), j)
    : done(roundRatio(M, 10n ** BigInt(-e10)), j);
}
