interface Flags {
  minus: boolean;
  plus: boolean;
  space: boolean;
  zero: boolean;
  hash: boolean;
}

function pow10(k: number): bigint {
  return 10n ** BigInt(k);
}

// Round num/den (both non-negative) to the nearest integer, ties to even.
function roundHalfEven(num: bigint, den: bigint): bigint {
  if (num === 0n) return 0n;
  const q = num / den;
  const r = num % den;
  const twiceR = r * 2n;
  if (twiceR > den) return q + 1n;
  if (twiceR < den) return q;
  return q % 2n === 0n ? q : q + 1n;
}

function scaleFraction(num: bigint, den: bigint, k: number): { num: bigint; den: bigint } {
  if (k >= 0) return { num: num * pow10(k), den };
  return { num, den: den * pow10(-k) };
}

// Compare num/den to 10^k. Returns -1, 0 or 1.
function cmpToPow10(num: bigint, den: bigint, k: number): number {
  let lhs: bigint, rhs: bigint;
  if (k >= 0) {
    lhs = num;
    rhs = den * pow10(k);
  } else {
    lhs = num * pow10(-k);
    rhs = den;
  }
  if (lhs < rhs) return -1;
  if (lhs > rhs) return 1;
  return 0;
}

// Decompose a finite, non-negative double into an exact fraction num/den (den a power of 2).
function doubleFraction(absValue: number): { num: bigint; den: bigint } {
  const buf = new ArrayBuffer(8);
  const dv = new DataView(buf);
  dv.setFloat64(0, absValue);
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const exponentBits = (hi >>> 20) & 0x7ff;
  const mantissaHigh = BigInt(hi & 0xfffff);
  const mantissaLow = BigInt(lo);
  let mantissa = (mantissaHigh << 32n) | mantissaLow;
  let e: number;
  if (exponentBits === 0) {
    e = -1074;
  } else {
    mantissa = mantissa | (1n << 52n);
    e = exponentBits - 1075;
  }
  if (e >= 0) {
    return { num: mantissa << BigInt(e), den: 1n };
  }
  return { num: mantissa, den: 1n << BigInt(-e) };
}

// Round num/den to p digits after the decimal point (returns round(value * 10^p)).
function roundFixed(num: bigint, den: bigint, p: number): bigint {
  const scaled = scaleFraction(num, den, p);
  return roundHalfEven(scaled.num, scaled.den);
}

// Round num/den to N significant decimal digits. Returns the N digits and the
// base-10 exponent X such that value ~= d0.d1d2...d(N-1) * 10^X.
function roundToSignificant(
  absValue: number,
  num: bigint,
  den: bigint,
  N: number,
): { digits: string; exp: number } {
  if (num === 0n) {
    return { digits: '0'.repeat(N), exp: 0 };
  }
  let exp = Math.floor(Math.log10(absValue));
  while (cmpToPow10(num, den, exp) < 0) exp--;
  while (cmpToPow10(num, den, exp + 1) >= 0) exp++;

  const scale = N - 1 - exp;
  const scaled = scaleFraction(num, den, scale);
  const R = roundHalfEven(scaled.num, scaled.den);

  const p = pow10(N);
  if (R === p) {
    return { digits: '1' + '0'.repeat(N - 1), exp: exp + 1 };
  }
  return { digits: R.toString(), exp };
}

function padField(
  sign: string,
  prefix: string,
  digits: string,
  width: number,
  minus: boolean,
  zero: boolean,
): string {
  const body = sign + prefix + digits;
  if (body.length >= width) return body;
  const padLen = width - body.length;
  if (minus) return body + ' '.repeat(padLen);
  if (zero) return sign + prefix + '0'.repeat(padLen) + digits;
  return ' '.repeat(padLen) + body;
}

function toBigIntArg(v: number | bigint): bigint {
  return typeof v === 'bigint' ? v : BigInt(v);
}

function formatInt(
  conv: string,
  flags: Flags,
  width: number,
  precision: number | null,
  arg: number | bigint,
): string {
  const val = toBigIntArg(arg);
  const neg = val < 0n;
  const abs = neg ? -val : val;
  let digits = abs.toString(10);
  if (precision !== null) {
    if (precision === 0 && abs === 0n) digits = '';
    else if (digits.length < precision) digits = '0'.repeat(precision - digits.length) + digits;
  }
  const sign = neg ? '-' : flags.plus ? '+' : flags.space ? ' ' : '';
  const zero = flags.zero && !flags.minus && precision === null;
  return padField(sign, '', digits, width, flags.minus, zero);
}

function formatRadix(
  conv: string,
  flags: Flags,
  width: number,
  precision: number | null,
  arg: number | bigint,
): string {
  const val = toBigIntArg(arg);
  let digits = conv === 'o' ? val.toString(8) : val.toString(16);
  if (conv === 'X') digits = digits.toUpperCase();
  if (precision !== null) {
    if (precision === 0 && val === 0n) digits = '';
    else if (digits.length < precision) digits = '0'.repeat(precision - digits.length) + digits;
  }
  let prefix = '';
  if (flags.hash) {
    if ((conv === 'x' || conv === 'X') && val !== 0n) {
      prefix = conv === 'x' ? '0x' : '0X';
    }
    if (conv === 'o' && (digits.length === 0 || digits[0] !== '0')) {
      digits = '0' + digits;
    }
  }
  const zero = flags.zero && !flags.minus && precision === null;
  return padField('', prefix, digits, width, flags.minus, zero);
}

function formatFloat(
  conv: string,
  flags: Flags,
  width: number,
  precision: number | null,
  arg: number,
): string {
  const upper = conv === 'E' || conv === 'F' || conv === 'G';

  if (Number.isNaN(arg)) {
    const text = upper ? 'NAN' : 'nan';
    return padField('', '', text, width, flags.minus, false);
  }

  const negative = arg < 0 || Object.is(arg, -0);
  const sign = negative ? '-' : flags.plus ? '+' : flags.space ? ' ' : '';

  if (!Number.isFinite(arg)) {
    const text = upper ? 'INF' : 'inf';
    return padField(sign, '', text, width, flags.minus, false);
  }

  const absValue = Math.abs(arg);
  const { num, den } = doubleFraction(absValue);
  const lower = conv.toLowerCase();
  let digitsBody: string;

  if (lower === 'f') {
    const p = precision === null ? 6 : precision;
    const R = roundFixed(num, den, p);
    let s = R.toString();
    if (s.length <= p) s = '0'.repeat(p - s.length + 1) + s;
    let intPart: string;
    let fracPart: string;
    if (p === 0) {
      intPart = s;
      fracPart = '';
    } else {
      intPart = s.slice(0, s.length - p);
      fracPart = s.slice(s.length - p);
    }
    digitsBody = intPart + (p > 0 || flags.hash ? '.' + fracPart : '');
  } else if (lower === 'e') {
    const p = precision === null ? 6 : precision;
    const { digits, exp } = roundToSignificant(absValue, num, den, p + 1);
    let mantissa = digits[0];
    const frac = digits.slice(1);
    if (p > 0 || flags.hash) mantissa += '.' + frac;
    const expSign = exp < 0 ? '-' : '+';
    const expAbs = Math.abs(exp).toString();
    const expStr = expAbs.length < 2 ? '0' + expAbs : expAbs;
    digitsBody = mantissa + (conv === 'E' ? 'E' : 'e') + expSign + expStr;
  } else {
    let P = precision === null ? 6 : precision;
    if (P === 0) P = 1;
    const { digits, exp: X } = roundToSignificant(absValue, num, den, P);
    if (P > X && X >= -4) {
      let intPart: string;
      let fracPart: string;
      if (X >= 0) {
        intPart = digits.slice(0, X + 1);
        fracPart = digits.slice(X + 1);
      } else {
        intPart = '0';
        fracPart = '0'.repeat(-X - 1) + digits;
      }
      if (!flags.hash) fracPart = fracPart.replace(/0+$/, '');
      digitsBody = intPart + (fracPart.length > 0 || flags.hash ? '.' + fracPart : '');
    } else {
      let frac = digits.slice(1);
      if (!flags.hash) frac = frac.replace(/0+$/, '');
      const mantissa = digits[0] + (frac.length > 0 || flags.hash ? '.' + frac : '');
      const expSign = X < 0 ? '-' : '+';
      const expAbs = Math.abs(X).toString();
      const expStr = expAbs.length < 2 ? '0' + expAbs : expAbs;
      digitsBody = mantissa + (conv === 'G' ? 'E' : 'e') + expSign + expStr;
    }
  }

  const zero = flags.zero && !flags.minus;
  return padField(sign, '', digitsBody, width, flags.minus, zero);
}

function formatOne(
  conv: string,
  flags: Flags,
  width: number,
  precision: number | null,
  arg: number | bigint | string,
): string {
  switch (conv) {
    case 'd':
    case 'i':
      return formatInt(conv, flags, width, precision, arg as number | bigint);
    case 'x':
    case 'X':
    case 'o':
      return formatRadix(conv, flags, width, precision, arg as number | bigint);
    case 'e':
    case 'E':
    case 'f':
    case 'F':
    case 'g':
    case 'G':
      return formatFloat(conv, flags, width, precision, arg as number);
    case 's':
    case 'c': {
      let str = arg as string;
      if (precision !== null) str = str.slice(0, precision);
      return padField('', '', str, width, flags.minus, false);
    }
    default:
      throw new Error(`unsupported conversion: ${conv}`);
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
    i++;
    if (fmt[i] === '%') {
      result += '%';
      i++;
      continue;
    }
    const flags: Flags = { minus: false, plus: false, space: false, zero: false, hash: false };
    while (i < n && '-+ 0#'.includes(fmt[i])) {
      switch (fmt[i]) {
        case '-':
          flags.minus = true;
          break;
        case '+':
          flags.plus = true;
          break;
        case ' ':
          flags.space = true;
          break;
        case '0':
          flags.zero = true;
          break;
        case '#':
          flags.hash = true;
          break;
      }
      i++;
    }
    let widthStr = '';
    while (i < n && fmt[i] >= '0' && fmt[i] <= '9') {
      widthStr += fmt[i];
      i++;
    }
    const width = widthStr === '' ? 0 : parseInt(widthStr, 10);
    let precision: number | null = null;
    if (fmt[i] === '.') {
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
    const arg = args[argIndex++];
    result += formatOne(conv, flags, width, precision, arg);
  }
  return result;
}
