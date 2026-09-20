type Flags = {
  minus: boolean;
  plus: boolean;
  space: boolean;
  zero: boolean;
  hash: boolean;
};

function decompose(x: number): { M: bigint; E: number } {
  const buf = new ArrayBuffer(8);
  const dv = new DataView(buf);
  dv.setFloat64(0, x, false);
  const hi = dv.getUint32(0, false);
  const lo = dv.getUint32(4, false);
  const expBits = (hi >>> 20) & 0x7ff;
  const mantHi = hi & 0xfffff;
  const mantissa = (BigInt(mantHi) << 32n) | BigInt(lo >>> 0);
  if (expBits === 0) {
    return { M: mantissa, E: 1 - 1023 - 52 };
  }
  return { M: mantissa | (1n << 52n), E: expBits - 1023 - 52 };
}

// Returns round(M * 2^E * 10^d) with ties-to-even, based on the exact value.
function computeRounded(M: bigint, E: number, d: number): bigint {
  if (M === 0n) return 0n;
  const e2 = E + d;
  const e5 = d;
  let numerator = M;
  let denom = 1n;
  if (e2 >= 0) numerator *= 2n ** BigInt(e2);
  else denom *= 2n ** BigInt(-e2);
  if (e5 >= 0) numerator *= 5n ** BigInt(e5);
  else denom *= 5n ** BigInt(-e5);
  if (denom === 1n) return numerator;
  const q = numerator / denom;
  const r = numerator % denom;
  const twice = r * 2n;
  if (twice > denom) return q + 1n;
  if (twice === denom) return q % 2n === 1n ? q + 1n : q;
  return q;
}

function fixedParts(M: bigint, E: number, p: number): { intPart: string; fracPart: string } {
  const N = computeRounded(M, E, p);
  let s = N.toString();
  while (s.length < p + 1) s = '0' + s;
  if (p === 0) return { intPart: s, fracPart: '' };
  return { intPart: s.slice(0, s.length - p), fracPart: s.slice(s.length - p) };
}

function expParts(M: bigint, E: number, p: number): { digits: string; exp: number } {
  if (M === 0n) return { digits: '0'.repeat(p + 1), exp: 0 };
  let X = Math.floor(Math.log10(Number(M)) + E * Math.log10(2));
  let s = '';
  for (let iter = 0; iter < 8; iter++) {
    const d = p - X;
    const N = computeRounded(M, E, d);
    s = N.toString();
    if (s.length === p + 1) {
      return { digits: s, exp: X };
    }
    if (s.length > p + 1) {
      X += s.length - (p + 1);
    } else {
      X -= p + 1 - s.length;
    }
  }
  while (s.length < p + 1) s = '0' + s;
  if (s.length > p + 1) s = s.slice(0, p + 1);
  return { digits: s, exp: X };
}

function padNumeric(signPrefix: string, body: string, width: number, zeroFlag: boolean, minusFlag: boolean): string {
  const s = signPrefix + body;
  if (s.length >= width) return s;
  const padLen = width - s.length;
  if (minusFlag) return s + ' '.repeat(padLen);
  if (zeroFlag) return signPrefix + '0'.repeat(padLen) + body;
  return ' '.repeat(padLen) + s;
}

function toMagnitude(arg: number | bigint): { neg: boolean; mag: bigint } {
  if (typeof arg === 'bigint') {
    return arg < 0n ? { neg: true, mag: -arg } : { neg: false, mag: arg };
  }
  const neg = arg < 0;
  const mag = BigInt(Math.trunc(Math.abs(arg)));
  return { neg, mag };
}

function intDigits(mag: bigint, base: 16 | 10 | 8, precision: number | null): string {
  let s = mag.toString(base);
  if (precision !== null) {
    if (precision === 0 && mag === 0n) return '';
    while (s.length < precision) s = '0' + s;
  }
  return s;
}

function formatInt(conv: string, flags: Flags, width: number, precision: number | null, arg: number | bigint): string {
  const { neg, mag } = toMagnitude(arg);
  const digits = intDigits(mag, 10, precision);
  const sign = neg ? '-' : flags.plus ? '+' : flags.space ? ' ' : '';
  const zeroFlag = flags.zero && precision === null;
  return padNumeric(sign, digits, width, zeroFlag, flags.minus);
}

function formatBase(conv: string, flags: Flags, width: number, precision: number | null, arg: number | bigint): string {
  const { mag } = toMagnitude(arg);
  const base = conv === 'o' ? 8 : 16;
  let digits = intDigits(mag, base as 8 | 16, precision);
  if (conv === 'X') digits = digits.toUpperCase();
  if (conv === 'o' && flags.hash) {
    if (digits.length === 0 || digits[0] !== '0') digits = '0' + digits;
  }
  let prefix = '';
  if (flags.hash && (conv === 'x' || conv === 'X') && mag !== 0n) {
    prefix = conv === 'x' ? '0x' : '0X';
  }
  const zeroFlag = flags.zero && precision === null;
  return padNumeric(prefix, digits, width, zeroFlag, flags.minus);
}

function formatFloat(conv: string, flags: Flags, width: number, precision: number | null, x: number): string {
  const upper = conv === conv.toUpperCase();
  const isNaNv = Number.isNaN(x);
  const negative = !isNaNv && (x < 0 || Object.is(x, -0));
  const absX = Math.abs(x);
  const sign = isNaNv ? '' : negative ? '-' : flags.plus ? '+' : flags.space ? ' ' : '';

  if (isNaNv || !Number.isFinite(absX)) {
    const word = isNaNv ? 'nan' : 'inf';
    const body = upper ? word.toUpperCase() : word;
    return padNumeric(sign, body, width, false, flags.minus);
  }

  const lowerConv = conv.toLowerCase();
  let body: string;

  if (lowerConv === 'f') {
    const p = precision === null ? 6 : precision;
    const { M, E } = decompose(absX);
    const { intPart, fracPart } = fixedParts(M, E, p);
    body = intPart + (p > 0 || flags.hash ? '.' + fracPart : '');
  } else if (lowerConv === 'e') {
    const p = precision === null ? 6 : precision;
    const { M, E } = decompose(absX);
    const { digits, exp } = expParts(M, E, p);
    const first = digits[0];
    const rest = digits.slice(1);
    const mantissa = first + (p > 0 || flags.hash ? '.' + rest : '');
    const expSign = exp < 0 ? '-' : '+';
    let expAbs = Math.abs(exp).toString();
    if (expAbs.length < 2) expAbs = '0' + expAbs;
    body = mantissa + (upper ? 'E' : 'e') + expSign + expAbs;
  } else {
    let P = precision === null ? 6 : precision;
    if (P === 0) P = 1;
    const { M, E } = decompose(absX);
    const { digits, exp: X } = expParts(M, E, P - 1);
    if (P > X && X >= -4) {
      const fp = P - 1 - X;
      const { intPart, fracPart } = fixedParts(M, E, fp);
      let frac = fracPart;
      if (!flags.hash) frac = frac.replace(/0+$/, '');
      body = intPart + (frac.length > 0 || flags.hash ? '.' + frac : '');
    } else {
      const first = digits[0];
      let rest = digits.slice(1);
      if (!flags.hash) rest = rest.replace(/0+$/, '');
      const mantissa = first + (rest.length > 0 || flags.hash ? '.' + rest : '');
      const expSign = X < 0 ? '-' : '+';
      let expAbs = Math.abs(X).toString();
      if (expAbs.length < 2) expAbs = '0' + expAbs;
      body = mantissa + (upper ? 'E' : 'e') + expSign + expAbs;
    }
  }

  return padNumeric(sign, body, width, flags.zero, flags.minus);
}

function formatOne(
  conv: string,
  flags: Flags,
  width: number,
  precision: number | null,
  arg: number | bigint | string
): string {
  switch (conv) {
    case 'd':
    case 'i':
      return formatInt(conv, flags, width, precision, arg as number | bigint);
    case 'x':
    case 'X':
    case 'o':
      return formatBase(conv, flags, width, precision, arg as number | bigint);
    case 'e':
    case 'E':
    case 'f':
    case 'F':
    case 'g':
    case 'G':
      return formatFloat(conv, flags, width, precision, arg as number);
    case 's': {
      let s = String(arg);
      if (precision !== null) s = s.slice(0, precision);
      return padNumeric('', s, width, false, flags.minus);
    }
    case 'c': {
      const s = String(arg);
      return padNumeric('', s, width, false, flags.minus);
    }
    default:
      throw new Error(`unsupported conversion: ${conv}`);
  }
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let result = '';
  let argIndex = 0;
  let i = 0;
  while (i < fmt.length) {
    const c = fmt[i];
    if (c !== '%') {
      result += c;
      i++;
      continue;
    }
    i++;
    if (fmt[i] === '%') {
      result += '%';
      i++;
      continue;
    }
    const flags: Flags = { minus: false, plus: false, space: false, zero: false, hash: false };
    while (true) {
      const ch = fmt[i];
      if (ch === '-') { flags.minus = true; i++; }
      else if (ch === '+') { flags.plus = true; i++; }
      else if (ch === ' ') { flags.space = true; i++; }
      else if (ch === '0') { flags.zero = true; i++; }
      else if (ch === '#') { flags.hash = true; i++; }
      else break;
    }
    let widthStr = '';
    while (fmt[i] >= '0' && fmt[i] <= '9') { widthStr += fmt[i]; i++; }
    const width = widthStr ? parseInt(widthStr, 10) : 0;

    let precision: number | null = null;
    if (fmt[i] === '.') {
      i++;
      let pstr = '';
      while (fmt[i] >= '0' && fmt[i] <= '9') { pstr += fmt[i]; i++; }
      precision = pstr ? parseInt(pstr, 10) : 0;
    }

    const conv = fmt[i];
    i++;
    const arg = args[argIndex++];
    result += formatOne(conv, flags, width, precision, arg);
  }
  return result;
}
