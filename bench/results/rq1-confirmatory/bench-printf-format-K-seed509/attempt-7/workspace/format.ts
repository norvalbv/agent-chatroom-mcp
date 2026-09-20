interface Spec {
  flags: Set<string>;
  width: number;
  precision: number | null;
  conv: string;
}

function parseSpec(fmt: string, i: number): Spec & { end: number } {
  let j = i + 1;
  const flags = new Set<string>();
  while (j < fmt.length && '-+ 0#'.includes(fmt[j])) {
    flags.add(fmt[j]);
    j++;
  }
  let widthStr = '';
  while (j < fmt.length && fmt[j] >= '0' && fmt[j] <= '9') {
    widthStr += fmt[j];
    j++;
  }
  let precision: number | null = null;
  if (fmt[j] === '.') {
    j++;
    let precStr = '';
    while (j < fmt.length && fmt[j] >= '0' && fmt[j] <= '9') {
      precStr += fmt[j];
      j++;
    }
    precision = precStr === '' ? 0 : parseInt(precStr, 10);
  }
  const conv = fmt[j];
  j++;
  return { flags, width: widthStr === '' ? 0 : parseInt(widthStr, 10), precision, conv, end: j };
}

function applyPad(body: string, width: number, left: boolean, zero: boolean, prefixLen: number): string {
  if (body.length >= width) return body;
  const padLen = width - body.length;
  if (left) return body + ' '.repeat(padLen);
  if (zero) return body.slice(0, prefixLen) + '0'.repeat(padLen) + body.slice(prefixLen);
  return ' '.repeat(padLen) + body;
}

function decomposeDouble(x: number): { m: bigint; e: number } {
  const buf = new DataView(new ArrayBuffer(8));
  buf.setFloat64(0, x);
  const hi = buf.getUint32(0);
  const lo = buf.getUint32(4);
  const expBits = (hi >>> 20) & 0x7ff;
  const mantHi = hi & 0xfffff;
  let mantissa = (BigInt(mantHi) << 32n) | BigInt(lo);
  let exp: number;
  if (expBits === 0) {
    exp = -1074;
  } else {
    mantissa = mantissa | (1n << 52n);
    exp = expBits - 1075;
  }
  return { m: mantissa, e: exp };
}

function roundRatio(num: bigint, den: bigint): bigint {
  const q = num / den;
  const r = num % den;
  const twice = r * 2n;
  if (twice < den) return q;
  if (twice > den) return q + 1n;
  return q % 2n === 0n ? q : q + 1n;
}

// round(m * 2^e * 10^d) to nearest integer, ties to even, using exact arithmetic
function roundScaled(m: bigint, e: number, d: number): bigint {
  let NUM = m;
  let DEN = 1n;
  if (d >= 0) NUM *= 5n ** BigInt(d);
  else DEN *= 5n ** BigInt(-d);
  const two = e + d;
  if (two >= 0) NUM <<= BigInt(two);
  else DEN <<= BigInt(-two);
  return roundRatio(NUM, DEN);
}

function cmpToPow10(m: bigint, e: number, k: number): number {
  let A: bigint, B: bigint;
  if (e >= 0) {
    A = m << BigInt(e);
    B = 1n;
  } else {
    A = m;
    B = 1n << BigInt(-e);
  }
  let C: bigint, D: bigint;
  if (k >= 0) {
    C = 10n ** BigInt(k);
    D = 1n;
  } else {
    C = 1n;
    D = 10n ** BigInt(-k);
  }
  const left = A * D;
  const right = C * B;
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function decimalExponent(m: bigint, e: number, xApprox: number): number {
  let E = Math.floor(Math.log10(xApprox));
  while (cmpToPow10(m, e, E) < 0) E--;
  while (cmpToPow10(m, e, E + 1) >= 0) E++;
  return E;
}

function eStyleDigits(m: bigint, e: number, p: number, xApprox: number): { digits: string; E: number } {
  if (m === 0n) return { digits: '0'.repeat(p + 1), E: 0 };
  let E = decimalExponent(m, e, xApprox);
  let V = roundScaled(m, e, p - E);
  let s = V.toString();
  if (s.length > p + 1) {
    E += 1;
    V = V / 10n;
    s = V.toString();
  }
  s = s.padStart(p + 1, '0');
  return { digits: s, E };
}

function fStyleDigits(m: bigint, e: number, p: number): { intPart: string; frac: string } {
  if (m === 0n) return { intPart: '0', frac: '0'.repeat(p) };
  const V = roundScaled(m, e, p);
  let s = V.toString();
  if (s.length <= p) s = s.padStart(p + 1, '0');
  const intPart = s.slice(0, s.length - p) || '0';
  const frac = p > 0 ? s.slice(s.length - p) : '';
  return { intPart, frac };
}

function formatFloat(value: number, spec: Spec): string {
  const { flags, width, conv, precision } = spec;
  const left = flags.has('-');
  const upper = conv === conv.toUpperCase();
  const negative = value < 0 || Object.is(value, -0);

  if (Number.isNaN(value)) {
    const body = upper ? 'NAN' : 'nan';
    return applyPad(body, width, left, false, 0);
  }
  if (!Number.isFinite(value)) {
    const sign = negative ? '-' : flags.has('+') ? '+' : flags.has(' ') ? ' ' : '';
    const body = sign + (upper ? 'INF' : 'inf');
    return applyPad(body, width, left, false, sign.length);
  }

  const zero = flags.has('0') && !left;
  const sign = negative ? '-' : flags.has('+') ? '+' : flags.has(' ') ? ' ' : '';
  const absValue = Math.abs(value);
  const { m, e } = decomposeDouble(absValue);
  const hash = flags.has('#');
  let body: string;

  if (conv === 'e' || conv === 'E') {
    const p = precision ?? 6;
    const { digits, E } = eStyleDigits(m, e, p, absValue);
    const mantissa = digits[0] + (p > 0 || hash ? '.' + digits.slice(1) : '');
    const expLetter = upper ? 'E' : 'e';
    const expSign = E < 0 ? '-' : '+';
    const expDigits = Math.abs(E).toString().padStart(2, '0');
    body = sign + mantissa + expLetter + expSign + expDigits;
  } else if (conv === 'f' || conv === 'F') {
    const p = precision ?? 6;
    const { intPart, frac } = fStyleDigits(m, e, p);
    body = sign + intPart + (p > 0 || hash ? '.' + frac : '');
  } else {
    const P = precision === null ? 6 : precision === 0 ? 1 : precision;
    let mantissaDigits: string;
    let X: number;
    if (m === 0n) {
      mantissaDigits = '0'.repeat(P);
      X = 0;
    } else {
      const r = eStyleDigits(m, e, P - 1, absValue);
      mantissaDigits = r.digits;
      X = r.E;
    }
    let core: string;
    if (P > X && X >= -4) {
      const fp = P - 1 - X;
      const { intPart, frac } = fStyleDigits(m, e, fp);
      let fracOut = frac;
      if (!hash) fracOut = fracOut.replace(/0+$/, '');
      core = intPart + (fracOut.length > 0 || hash ? '.' + fracOut : '');
    } else {
      const ep = P - 1;
      const { digits, E } = eStyleDigits(m, e, ep, absValue);
      let fracOut = digits.slice(1);
      if (!hash) fracOut = fracOut.replace(/0+$/, '');
      const mant = digits[0] + (fracOut.length > 0 || hash ? '.' + fracOut : '');
      const expLetter = upper ? 'E' : 'e';
      const expSign = E < 0 ? '-' : '+';
      const expDigits = Math.abs(E).toString().padStart(2, '0');
      core = mant + expLetter + expSign + expDigits;
    }
    body = sign + core;
  }

  return applyPad(body, width, left, zero, sign.length);
}

function formatOne(spec: Spec, arg: number | bigint | string): string {
  const { flags, width, precision, conv } = spec;
  const left = flags.has('-');

  if (conv === 'd' || conv === 'i') {
    let neg: boolean;
    let mag: bigint;
    if (typeof arg === 'bigint') {
      neg = arg < 0n;
      mag = neg ? -arg : arg;
    } else {
      const n = arg as number;
      neg = n < 0;
      mag = BigInt(Math.trunc(Math.abs(n)));
    }
    let digits: string;
    if (precision !== null) {
      digits = mag === 0n && precision === 0 ? '' : mag.toString().padStart(precision, '0');
    } else {
      digits = mag.toString();
    }
    const sign = neg ? '-' : flags.has('+') ? '+' : flags.has(' ') ? ' ' : '';
    const body = sign + digits;
    const zero = flags.has('0') && !left && precision === null;
    return applyPad(body, width, left, zero, sign.length);
  }

  if (conv === 'x' || conv === 'X' || conv === 'o') {
    const value = typeof arg === 'bigint' ? arg : BigInt(arg as number);
    const base = conv === 'o' ? 8 : 16;
    let digits = value.toString(base);
    if (conv === 'X') digits = digits.toUpperCase();
    if (precision !== null) {
      digits = value === 0n && precision === 0 ? '' : digits.padStart(precision, '0');
    }
    let prefix = '';
    if (flags.has('#')) {
      if (conv === 'o') {
        if (digits === '' || digits[0] !== '0') digits = '0' + digits;
      } else if (value !== 0n) {
        prefix = conv === 'X' ? '0X' : '0x';
      }
    }
    const body = prefix + digits;
    const zero = flags.has('0') && !left && precision === null;
    return applyPad(body, width, left, zero, prefix.length);
  }

  if (conv === 'e' || conv === 'E' || conv === 'f' || conv === 'F' || conv === 'g' || conv === 'G') {
    return formatFloat(arg as number, spec);
  }

  if (conv === 's') {
    let str = arg as string;
    if (precision !== null) str = str.slice(0, precision);
    return applyPad(str, width, left, false, 0);
  }

  if (conv === 'c') {
    const str = arg as string;
    return applyPad(str, width, left, false, 0);
  }

  throw new Error('unsupported conversion ' + conv);
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let out = '';
  let ai = 0;
  let i = 0;
  while (i < fmt.length) {
    const c = fmt[i];
    if (c !== '%') {
      out += c;
      i++;
      continue;
    }
    const spec = parseSpec(fmt, i);
    i = spec.end;
    if (spec.conv === '%') {
      out += '%';
      continue;
    }
    const arg = args[ai++];
    out += formatOne(spec, arg);
  }
  return out;
}
