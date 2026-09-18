const isDec = (c: string | undefined): boolean => c !== undefined && c >= '0' && c <= '9';
const isHex = (c: string | undefined): boolean =>
  c !== undefined && ((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F'));

function bitLen(n: bigint): number {
  return n === 0n ? 0 : n.toString(16).length * 4 - (4 - (32 - Math.clz32(parseInt(n.toString(16)[0], 16))));
}

// Nearest binary64 (as 64-bit BigInt magnitude) to num/den, num > 0.
function round(num: bigint, den: bigint): bigint {
  let e2 = bitLen(num) - bitLen(den) - 53;
  let q = 0n;
  for (;;) {
    if (e2 < -1074) e2 = -1074;
    const n = e2 < 0 ? num << BigInt(-e2) : num;
    const d = e2 > 0 ? den << BigInt(e2) : den;
    q = n / d;
    const r = n % d;
    if (q >= 1n << 53n) { e2++; continue; }
    if (q < 1n << 52n && e2 > -1074) { e2--; continue; }
    const twice = r * 2n;
    if (twice > d || (twice === d && (q & 1n) === 1n)) q++;
    break;
  }
  if (q === 1n << 53n) { q >>= 1n; e2++; }
  if (q < 1n << 52n) return q;
  const biased = e2 + 1075;
  if (biased >= 2047) return 0x7ff0000000000000n;
  return (BigInt(biased) << 52n) | (q - (1n << 52n));
}

function parseExp(str: string): number {
  let v = BigInt(str);
  const lim = 1000000000n;
  if (v > lim) v = lim;
  if (v < -lim) v = -lim;
  return Number(v);
}

export function strtod(s: string): { bits: string; end: number } {
  const zero = { bits: '0000000000000000', end: 0 };
  let i = 0;
  while (i < s.length && ' \t\n\v\f\r'.includes(s[i])) i++;
  let neg = false;
  if (s[i] === '+' || s[i] === '-') {
    neg = s[i] === '-';
    i++;
  }
  const out = (mag: bigint, end: number) => ({
    bits: (mag | (neg ? 1n << 63n : 0n)).toString(16).padStart(16, '0'),
    end,
  });
  const rest = s.slice(i);

  // Hexadecimal
  if (rest[0] === '0' && (rest[1] === 'x' || rest[1] === 'X')) {
    let j = 2;
    let ip = '';
    let fp = '';
    while (isHex(rest[j])) ip += rest[j++];
    let ok = ip.length > 0;
    if (rest[j] === '.') {
      let k = j + 1;
      let f = '';
      while (isHex(rest[k])) f += rest[k++];
      if (ip.length > 0 || f.length > 0) {
        fp = f;
        j = k;
        ok = true;
      }
    }
    if (ok) {
      let exp = 0;
      if (rest[j] === 'p' || rest[j] === 'P') {
        let k = j + 1;
        let sg = '';
        if (rest[k] === '+' || rest[k] === '-') sg = rest[k++];
        let ds = '';
        while (isDec(rest[k])) ds += rest[k++];
        if (ds.length > 0) {
          exp = parseExp(sg + ds);
          j = k;
        }
      }
      const end = i + j;
      const digits = ip + fp;
      const M = BigInt('0x' + (digits || '0'));
      if (M === 0n) return out(0n, end);
      const e2 = exp - 4 * fp.length;
      const mb = bitLen(M);
      if (mb + e2 > 1100) return out(0x7ff0000000000000n, end);
      if (mb + e2 < -1200) return out(0n, end);
      return out(e2 >= 0 ? round(M << BigInt(e2), 1n) : round(M, 1n << BigInt(-e2)), end);
    }
  }

  // Infinity
  const low = rest.slice(0, 8).toLowerCase();
  if (low === 'infinity') return out(0x7ff0000000000000n, i + 8);
  if (low.startsWith('inf')) return out(0x7ff0000000000000n, i + 3);

  // NaN
  if (low.startsWith('nan')) {
    let end = i + 3;
    if (rest[3] === '(') {
      let k = 4;
      while (k < rest.length && /[A-Za-z0-9_]/.test(rest[k])) k++;
      if (rest[k] === ')') end = i + k + 1;
    }
    return { bits: 'nan', end };
  }

  // Decimal
  {
    let j = 0;
    let ip = '';
    let fp = '';
    while (isDec(rest[j])) ip += rest[j++];
    let ok = ip.length > 0;
    if (rest[j] === '.') {
      let k = j + 1;
      let f = '';
      while (isDec(rest[k])) f += rest[k++];
      if (ip.length > 0 || f.length > 0) {
        fp = f;
        j = k;
        ok = true;
      }
    }
    if (!ok) return zero;
    let exp = 0;
    if (rest[j] === 'e' || rest[j] === 'E') {
      let k = j + 1;
      let sg = '';
      if (rest[k] === '+' || rest[k] === '-') sg = rest[k++];
      let ds = '';
      while (isDec(rest[k])) ds += rest[k++];
      if (ds.length > 0) {
        exp = parseExp(sg + ds);
        j = k;
      }
    }
    const end = i + j;
    const stripped = (ip + fp).replace(/^0+/, '');
    if (stripped === '') return out(0n, end);
    const e10 = exp - fp.length;
    const mag = stripped.length + e10;
    if (mag > 400) return out(0x7ff0000000000000n, end);
    if (mag < -400) return out(0n, end);
    const M = BigInt(stripped);
    return out(e10 >= 0 ? round(M * 10n ** BigInt(e10), 1n) : round(M, 10n ** BigInt(-e10)), end);
  }
}
