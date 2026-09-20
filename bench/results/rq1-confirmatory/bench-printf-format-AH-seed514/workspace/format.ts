type Flags = {
  minus: boolean;
  plus: boolean;
  space: boolean;
  zero: boolean;
  hash: boolean;
};

function signBitOf(x: number): boolean {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, x);
  return (dv.getUint32(0) >>> 31) === 1;
}

function decomposeDouble(x: number): { M: bigint; E: number } {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, Math.abs(x));
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const expBits = (hi >>> 20) & 0x7ff;
  const fracHi = hi & 0xfffff;
  const fraction = (BigInt(fracHi) << 32n) | BigInt(lo);
  if (expBits === 0) {
    return { M: fraction, E: -1074 };
  }
  return { M: fraction | (1n << 52n), E: expBits - 1075 };
}

function divRoundHalfEven(num: bigint, denom: bigint): bigint {
  const q = num / denom;
  const r = num % denom;
  if (r === 0n) return q;
  const twice = r * 2n;
  if (twice < denom) return q;
  if (twice > denom) return q + 1n;
  return q % 2n === 0n ? q : q + 1n;
}

// Computes round(M * 2^E * 10^d) with ties-to-even, using the exact binary value.
function roundTimesPow10(M: bigint, E: number, d: number): bigint {
  if (M === 0n) return 0n;
  const pow2exp = E + d;
  const pow5exp = d;
  let numerator = M;
  let denominator = 1n;
  if (pow2exp >= 0) numerator *= 2n ** BigInt(pow2exp);
  else denominator *= 2n ** BigInt(-pow2exp);
  if (pow5exp >= 0) numerator *= 5n ** BigInt(pow5exp);
  else denominator *= 5n ** BigInt(-pow5exp);
  if (denominator === 1n) return numerator;
  return divRoundHalfEven(numerator, denominator);
}

function eStyleDigitsAndExponent(
  M: bigint,
  E: number,
  precision: number,
  absX: number
): { digits: string; exponent: number } {
  if (M === 0n) {
    return { digits: '0'.repeat(precision + 1), exponent: 0 };
  }
  let exp = Math.floor(Math.log10(absX));
  for (let iter = 0; iter < 60; iter++) {
    const d = precision - exp;
    const N = roundTimesPow10(M, E, d);
    const s = N.toString();
    if (s.length === precision + 1) {
      return { digits: s, exponent: exp };
    } else if (s.length > precision + 1) {
      exp += s.length - (precision + 1);
    } else {
      exp -= precision + 1 - s.length;
    }
  }
  throw new Error('eStyleDigitsAndExponent failed to converge');
}

function formatFDigits(
  M: bigint,
  E: number,
  precision: number
): { intPart: string; fracPart: string } {
  const N = roundTimesPow10(M, E, precision);
  let s = N.toString();
  if (s.length < precision + 1) s = '0'.repeat(precision + 1 - s.length) + s;
  if (precision === 0) return { intPart: s, fracPart: '' };
  return { intPart: s.slice(0, s.length - precision), fracPart: s.slice(s.length - precision) };
}

function buildFString(intPart: string, fracPart: string, precision: number, hash: boolean): string {
  if (precision === 0) return hash ? intPart + '.' : intPart;
  return intPart + '.' + fracPart;
}

function stripTrailingZeros(s: string): string {
  if (!s.includes('.')) return s;
  s = s.replace(/0+$/, '');
  if (s.endsWith('.')) s = s.slice(0, -1);
  return s;
}

function exponentSuffix(exponent: number, upper: boolean): string {
  const eLetter = upper ? 'E' : 'e';
  const expSign = exponent < 0 ? '-' : '+';
  let expDigits = Math.abs(exponent).toString();
  if (expDigits.length < 2) expDigits = '0'.repeat(2 - expDigits.length) + expDigits;
  return eLetter + expSign + expDigits;
}

function padToWidth(s: string, width: number, leftAlign: boolean): string {
  if (s.length >= width) return s;
  const pad = ' '.repeat(width - s.length);
  return leftAlign ? s + pad : pad + s;
}

function combineNumeric(
  sign: string,
  prefix: string,
  digits: string,
  width: number,
  flags: Flags,
  zeroAllowed: boolean
): string {
  const useZero = flags.zero && !flags.minus && zeroAllowed;
  if (useZero) {
    const total = sign.length + prefix.length + digits.length;
    const padLen = Math.max(0, width - total);
    return sign + prefix + '0'.repeat(padLen) + digits;
  }
  return padToWidth(sign + prefix + digits, width, flags.minus);
}

function intMagnitude(arg: number | bigint): { neg: boolean; mag: bigint } {
  if (typeof arg === 'bigint') {
    return arg < 0n ? { neg: true, mag: -arg } : { neg: false, mag: arg };
  }
  return arg < 0 ? { neg: true, mag: BigInt(-arg) } : { neg: false, mag: BigInt(arg) };
}

function formatInt(flags: Flags, width: number, precision: number | undefined, arg: number | bigint): string {
  const { neg, mag } = intMagnitude(arg);
  let digits = mag.toString();
  if (precision !== undefined) {
    if (precision === 0 && mag === 0n) digits = '';
    else if (digits.length < precision) digits = '0'.repeat(precision - digits.length) + digits;
  }
  const sign = neg ? '-' : flags.plus ? '+' : flags.space ? ' ' : '';
  const zeroAllowed = precision === undefined;
  return combineNumeric(sign, '', digits, width, flags, zeroAllowed);
}

function formatUint(
  conv: string,
  flags: Flags,
  width: number,
  precision: number | undefined,
  arg: number | bigint
): string {
  const mag = typeof arg === 'bigint' ? arg : BigInt(arg);
  const base = conv === 'o' ? 8 : 16;
  let digits = mag.toString(base);
  if (conv === 'X') digits = digits.toUpperCase();
  if (precision !== undefined) {
    if (precision === 0 && mag === 0n) digits = '';
    else if (digits.length < precision) digits = '0'.repeat(precision - digits.length) + digits;
  }
  let prefix = '';
  if (flags.hash) {
    if ((conv === 'x' || conv === 'X') && mag !== 0n) prefix = conv === 'x' ? '0x' : '0X';
    if (conv === 'o' && (digits === '' || digits[0] !== '0')) digits = '0' + digits;
  }
  const zeroAllowed = precision === undefined;
  return combineNumeric('', prefix, digits, width, flags, zeroAllowed);
}

function assembleMantissaAndExponent(
  M: bigint,
  E: number,
  absX: number,
  precision: number,
  hash: boolean
): { mantissa: string; exponent: number } {
  const { digits, exponent } = eStyleDigitsAndExponent(M, E, precision, absX);
  const first = digits[0];
  const rest = digits.slice(1);
  const mantissa = buildFString(first, rest, precision, hash);
  return { mantissa, exponent };
}

function buildEString(
  M: bigint,
  E: number,
  absX: number,
  precision: number,
  hash: boolean,
  upper: boolean
): string {
  const { mantissa, exponent } = assembleMantissaAndExponent(M, E, absX, precision, hash);
  return mantissa + exponentSuffix(exponent, upper);
}

function buildGString(
  M: bigint,
  E: number,
  absX: number,
  precision: number,
  hash: boolean,
  upper: boolean
): string {
  const P = precision === 0 ? 1 : precision;
  const { exponent: X } = eStyleDigitsAndExponent(M, E, P - 1, absX);
  if (P > X && X >= -4) {
    const fprec = P - 1 - X;
    const { intPart, fracPart } = formatFDigits(M, E, fprec);
    let body = buildFString(intPart, fracPart, fprec, hash);
    if (!hash) body = stripTrailingZeros(body);
    return body;
  }
  const eprec = P - 1;
  const { mantissa, exponent } = assembleMantissaAndExponent(M, E, absX, eprec, hash);
  const m = hash ? mantissa : stripTrailingZeros(mantissa);
  return m + exponentSuffix(exponent, upper);
}

function formatFloat(
  conv: string,
  flags: Flags,
  width: number,
  precision: number,
  x: number,
  kind: 'e' | 'f' | 'g'
): string {
  const upper = conv === conv.toUpperCase();
  if (Number.isNaN(x)) {
    return padToWidth(upper ? 'NAN' : 'nan', width, flags.minus);
  }
  const neg = signBitOf(x);
  if (!Number.isFinite(x)) {
    const infStr = upper ? 'INF' : 'inf';
    const sign = neg ? '-' : flags.plus ? '+' : flags.space ? ' ' : '';
    return padToWidth(sign + infStr, width, flags.minus);
  }
  const { M, E } = decomposeDouble(x);
  const absX = Math.abs(x);
  const sign = neg ? '-' : flags.plus ? '+' : flags.space ? ' ' : '';
  let digits: string;
  if (kind === 'f') {
    const { intPart, fracPart } = formatFDigits(M, E, precision);
    digits = buildFString(intPart, fracPart, precision, flags.hash);
  } else if (kind === 'e') {
    digits = buildEString(M, E, absX, precision, flags.hash, upper);
  } else {
    digits = buildGString(M, E, absX, precision, flags.hash, upper);
  }
  return combineNumeric(sign, '', digits, width, flags, true);
}

function formatString(flags: Flags, width: number, precision: number | undefined, arg: string): string {
  const s = precision !== undefined ? arg.slice(0, precision) : arg;
  return padToWidth(s, width, flags.minus);
}

function formatChar(flags: Flags, width: number, arg: string): string {
  return padToWidth(arg, width, flags.minus);
}

function formatOne(
  conv: string,
  flags: Flags,
  width: number,
  precision: number | undefined,
  arg: number | bigint | string
): string {
  switch (conv) {
    case 'd':
    case 'i':
      return formatInt(flags, width, precision, arg as number | bigint);
    case 'x':
    case 'X':
    case 'o':
      return formatUint(conv, flags, width, precision, arg as number | bigint);
    case 'e':
    case 'E':
      return formatFloat(conv, flags, width, precision === undefined ? 6 : precision, arg as number, 'e');
    case 'f':
    case 'F':
      return formatFloat(conv, flags, width, precision === undefined ? 6 : precision, arg as number, 'f');
    case 'g':
    case 'G':
      return formatFloat(conv, flags, width, precision === undefined ? 6 : precision, arg as number, 'g');
    case 's':
      return formatString(flags, width, precision, arg as string);
    case 'c':
      return formatChar(flags, width, arg as string);
    default:
      throw new Error('unsupported conversion: ' + conv);
  }
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let result = '';
  let argIndex = 0;
  let i = 0;
  const n = fmt.length;
  while (i < n) {
    const ch = fmt[i];
    if (ch !== '%') {
      result += ch;
      i++;
      continue;
    }
    i++; // skip '%'
    const flags: Flags = { minus: false, plus: false, space: false, zero: false, hash: false };
    while (i < n) {
      const c = fmt[i];
      if (c === '-') flags.minus = true;
      else if (c === '+') flags.plus = true;
      else if (c === ' ') flags.space = true;
      else if (c === '0') flags.zero = true;
      else if (c === '#') flags.hash = true;
      else break;
      i++;
    }
    let widthStr = '';
    while (i < n && fmt[i] >= '0' && fmt[i] <= '9') {
      widthStr += fmt[i];
      i++;
    }
    const width = widthStr === '' ? 0 : parseInt(widthStr, 10);
    let precision: number | undefined = undefined;
    if (i < n && fmt[i] === '.') {
      i++;
      let precStr = '';
      while (i < n && fmt[i] >= '0' && fmt[i] <= '9') {
        precStr += fmt[i];
        i++;
      }
      precision = precStr === '' ? 0 : parseInt(precStr, 10);
    }
    const conv = fmt[i];
    i++;
    if (conv === '%') {
      result += '%';
      continue;
    }
    const arg = args[argIndex++];
    result += formatOne(conv, flags, width, precision, arg);
  }
  return result;
}
