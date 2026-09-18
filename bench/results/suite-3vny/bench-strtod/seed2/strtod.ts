const HEX_RE = /^0[xX](?:([0-9a-fA-F]+)(?:\.([0-9a-fA-F]*))?|\.([0-9a-fA-F]+))(?:[pP]([+-]?[0-9]+))?/;
const INF_RE = /^inf(?:inity)?/i;
const NAN_RE = /^nan(?:\([A-Za-z0-9_]*\))?/i;
const DEC_RE = /^(?:([0-9]+)(?:\.([0-9]*))?|\.([0-9]+))(?:[eE]([+-]?[0-9]+))?/;

const LIMIT = 1000000000n;

function clampExp(text: string | undefined): number {
  if (text === undefined) return 0;
  let v = BigInt(text);
  if (v > LIMIT) v = LIMIT;
  if (v < -LIMIT) v = -LIMIT;
  return Number(v);
}

function bitLength(n: bigint): number {
  return n === 0n ? 0 : n.toString(2).length;
}

// Round num/den (both positive) to binary64; returns the low 63 bits (no sign).
function roundRational(num: bigint, den: bigint): bigint {
  const guess = bitLength(num) - bitLength(den) - 1;
  // Find e2 = floor(log2(num/den)).
  const ge = (e: number): boolean =>
    e >= 0 ? num >= den << BigInt(e) : num << BigInt(-e) >= den;
  let e2 = guess;
  if (ge(e2 + 1)) e2++;
  const shift = Math.max(e2 - 52, -1074);
  let n = num;
  let d = den;
  if (shift >= 0) d <<= BigInt(shift);
  else n <<= BigInt(-shift);
  let q = n / d;
  const r = n % d;
  const twice = r * 2n;
  if (twice > d || (twice === d && (q & 1n) === 1n)) q++;
  let sh = shift;
  if (q === 1n << 53n) {
    q = 1n << 52n;
    sh++;
  }
  if (q >= 1n << 52n) {
    const biased = sh + 1075;
    if (biased >= 2047) return 0x7ff0000000000000n;
    return (BigInt(biased) << 52n) | (q - (1n << 52n));
  }
  return q;
}

function toHex(bits: bigint): string {
  return bits.toString(16).padStart(16, '0');
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
  const rest = s.slice(i);
  const signBit = neg ? 1n << 63n : 0n;

  let m = HEX_RE.exec(rest);
  if (m) {
    const intPart = m[1] ?? '';
    const frac = m[2] ?? m[3] ?? '';
    const M = BigInt('0x' + ((intPart + frac) || '0'));
    const e = clampExp(m[4]) - 4 * frac.length;
    return { bits: toHex(signBit | hexValue(M, e)), end: i + m[0].length };
  }
  m = INF_RE.exec(rest);
  if (m) return { bits: toHex(signBit | 0x7ff0000000000000n), end: i + m[0].length };
  m = NAN_RE.exec(rest);
  if (m) return { bits: 'nan', end: i + m[0].length };
  m = DEC_RE.exec(rest);
  if (m) {
    const intPart = m[1] ?? '';
    const frac = m[2] ?? m[3] ?? '';
    const M = BigInt(intPart + frac || '0');
    const e = clampExp(m[4]) - frac.length;
    return { bits: toHex(signBit | decValue(M, e)), end: i + m[0].length };
  }
  return zero;
}

function hexValue(M: bigint, e: number): bigint {
  if (M === 0n) return 0n;
  const mag = bitLength(M) + e;
  if (mag > 1100) return 0x7ff0000000000000n;
  if (mag < -1200) return 0n;
  return e >= 0 ? roundRational(M << BigInt(e), 1n) : roundRational(M, 1n << BigInt(-e));
}

function decValue(M: bigint, e: number): bigint {
  if (M === 0n) return 0n;
  const mag = M.toString().length + e;
  if (mag > 400) return 0x7ff0000000000000n;
  if (mag < -400) return 0n;
  return e >= 0 ? roundRational(M * 10n ** BigInt(e), 1n) : roundRational(M, 10n ** BigInt(-e));
}
