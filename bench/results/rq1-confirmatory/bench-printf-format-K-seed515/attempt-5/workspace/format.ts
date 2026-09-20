type Flags = {
  minus: boolean;
  plus: boolean;
  space: boolean;
  zero: boolean;
  hash: boolean;
};

function pow2(n: number): bigint {
  return 2n ** BigInt(n);
}

function pow10(n: number): bigint {
  return 10n ** BigInt(n);
}

// Compares M * 2^E to 10^n. Returns -1, 0, or 1.
function compareToPow10(M: bigint, E: number, n: number): number {
  const a = E >= 0 ? M * pow2(E) : M;
  const b = E >= 0 ? 1n : pow2(-E);
  const c = n >= 0 ? pow10(n) : 1n;
  const d = n >= 0 ? 1n : pow10(-n);
  const lhs = a * d;
  const rhs = c * b;
  if (lhs < rhs) return -1;
  if (lhs > rhs) return 1;
  return 0;
}

// Exact floor(log10(M * 2^E)) for M > 0.
function exactDecimalExponent(M: bigint, E: number): number {
  let approx = Math.floor(E * Math.log10(2) + Math.log10(Number(M)));
  while (compareToPow10(M, E, approx) < 0) approx--;
  while (compareToPow10(M, E, approx + 1) >= 0) approx++;
  return approx;
}

// round(M * 2^E * 10^k) to nearest integer, ties to even.
function roundScaled(M: bigint, E: number, k: number): bigint {
  const numE = E + k;
  const pPow2 = numE > 0 ? numE : 0;
  const qPow2 = numE < 0 ? -numE : 0;
  const pPow5 = k > 0 ? k : 0;
  const qPow5 = k < 0 ? -k : 0;
  const p = M * pow2(pPow2) * (5n ** BigInt(pPow5));
  const q = pow2(qPow2) * (5n ** BigInt(qPow5));
  const quotient = p / q;
  const remainder = p % q;
  const twice = remainder * 2n;
  if (twice < q) return quotient;
  if (twice > q) return quotient + 1n;
  return quotient % 2n === 0n ? quotient : quotient + 1n;
}

// Returns `sigDigits` significant decimal digits of M * 2^E (M > 0), rounded
// to nearest/even, along with the decimal exponent (value ~= 0.d1d2...*10^(exp+1)).
function roundToSignificant(
  M: bigint,
  E: number,
  sigDigits: number
): { digits: string; exp: number } {
  const e10 = exactDecimalExponent(M, E);
  const k = sigDigits - 1 - e10;
  const N = roundScaled(M, E, k);
  let digits = N.toString();
  let exp = e10;
  if (digits.length > sigDigits) {
    exp += digits.length - sigDigits;
    digits = digits.slice(0, sigDigits);
  }
  return { digits, exp };
}

type Decomposed = {
  negative: boolean;
  isZero: boolean;
  isInf: boolean;
  isNaN: boolean;
  M: bigint;
  E: number;
};

function decompose(x: number): Decomposed {
  const buf = new ArrayBuffer(8);
  const dv = new DataView(buf);
  dv.setFloat64(0, x);
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const negative = (hi >>> 31) === 1;
  const exponent = (hi >>> 20) & 0x7ff;
  const mantHi = hi & 0xfffff;
  const mantissa = (BigInt(mantHi) << 32n) | BigInt(lo);
  if (exponent === 0x7ff) {
    const isInf = mantissa === 0n;
    return { negative, isZero: false, isInf, isNaN: !isInf, M: 0n, E: 0 };
  }
  if (exponent === 0 && mantissa === 0n) {
    return { negative, isZero: true, isInf: false, isNaN: false, M: 0n, E: 0 };
  }
  if (exponent === 0) {
    return { negative, isZero: false, isInf: false, isNaN: false, M: mantissa, E: -1074 };
  }
  return {
    negative,
    isZero: false,
    isInf: false,
    isNaN: false,
    M: mantissa | (1n << 52n),
    E: exponent - 1075,
  };
}

function getSign(negative: boolean, flags: Flags): string {
  if (negative) return '-';
  if (flags.plus) return '+';
  if (flags.space) return ' ';
  return '';
}

function padWidth(s: string, width: number, leftAlign: boolean): string {
  if (s.length >= width) return s;
  const pad = ' '.repeat(width - s.length);
  return leftAlign ? s + pad : pad + s;
}

function padNumeric(
  sign: string,
  prefix: string,
  digits: string,
  width: number,
  flags: Flags,
  zeroPadAllowed: boolean
): string {
  let core = sign + prefix + digits;
  if (flags.zero && !flags.minus && zeroPadAllowed) {
    const padLen = width - core.length;
    if (padLen > 0) {
      digits = '0'.repeat(padLen) + digits;
      core = sign + prefix + digits;
    }
  }
  return padWidth(core, width, flags.minus);
}

function toBigIntMagnitude(arg: number | bigint): { neg: boolean; mag: bigint } {
  if (typeof arg === 'bigint') {
    const neg = arg < 0n;
    return { neg, mag: neg ? -arg : arg };
  }
  const neg = arg < 0;
  const mag = BigInt(Math.trunc(Math.abs(arg)));
  return { neg, mag };
}

function toBigIntNonNegative(arg: number | bigint): bigint {
  return typeof arg === 'bigint' ? arg : BigInt(Math.trunc(arg));
}

function formatDecimal(
  arg: number | bigint,
  flags: Flags,
  width: number,
  precision: number
): string {
  const { neg, mag } = toBigIntMagnitude(arg);
  let digits: string;
  if (precision === 0 && mag === 0n) {
    digits = '';
  } else {
    digits = mag.toString();
  }
  if (precision > digits.length) {
    digits = '0'.repeat(precision - digits.length) + digits;
  }
  const sign = neg ? '-' : flags.plus ? '+' : flags.space ? ' ' : '';
  const zeroPadAllowed = precision === -1;
  return padNumeric(sign, '', digits, width, flags, zeroPadAllowed);
}

function formatHexOct(
  arg: number | bigint,
  conv: 'x' | 'X' | 'o',
  flags: Flags,
  width: number,
  precision: number
): string {
  const mag = toBigIntNonNegative(arg);
  const base = conv === 'o' ? 8 : 16;
  let digits: string;
  if (precision === 0 && mag === 0n) {
    digits = '';
  } else {
    digits = mag.toString(base);
  }
  if (precision > digits.length) {
    digits = '0'.repeat(precision - digits.length) + digits;
  }
  if (conv === 'X') digits = digits.toUpperCase();
  let prefix = '';
  if (flags.hash) {
    if (conv === 'o') {
      if (digits.length === 0 || digits[0] !== '0') {
        digits = '0' + digits;
      }
    } else if (mag !== 0n) {
      prefix = conv === 'x' ? '0x' : '0X';
    }
  }
  const zeroPadAllowed = precision === -1;
  return padNumeric('', prefix, digits, width, flags, zeroPadAllowed);
}

function expString(exp: number): string {
  const sign = exp < 0 ? '-' : '+';
  let abs = Math.abs(exp).toString();
  if (abs.length < 2) abs = '0' + abs;
  return sign + abs;
}

function formatFloatF(
  x: number,
  flags: Flags,
  width: number,
  precisionIn: number,
  upper: boolean
): string {
  const precision = precisionIn === -1 ? 6 : precisionIn;
  const d = decompose(x);
  if (d.isNaN) {
    return padWidth((upper ? 'NAN' : 'nan'), width, flags.minus);
  }
  if (d.isInf) {
    const sign = getSign(d.negative, flags);
    return padNumeric(sign, '', upper ? 'INF' : 'inf', width, flags, false);
  }
  const sign = getSign(d.negative, flags);
  const N = roundScaled(d.M, d.E, precision);
  let digits = N.toString();
  if (digits.length < precision + 1) {
    digits = '0'.repeat(precision + 1 - digits.length) + digits;
  }
  const intPart = precision === 0 ? digits : digits.slice(0, digits.length - precision);
  const fracPart = precision === 0 ? '' : digits.slice(digits.length - precision);
  const dot = precision > 0 || flags.hash ? '.' : '';
  const rest = intPart + dot + fracPart;
  return padNumeric(sign, '', rest, width, flags, true);
}

function formatFloatE(
  x: number,
  flags: Flags,
  width: number,
  precisionIn: number,
  upper: boolean
): string {
  const precision = precisionIn === -1 ? 6 : precisionIn;
  const d = decompose(x);
  if (d.isNaN) {
    return padWidth((upper ? 'NAN' : 'nan'), width, flags.minus);
  }
  if (d.isInf) {
    const sign = getSign(d.negative, flags);
    return padNumeric(sign, '', upper ? 'INF' : 'inf', width, flags, false);
  }
  const sign = getSign(d.negative, flags);
  let digits: string;
  let exp: number;
  if (d.isZero) {
    digits = '0'.repeat(precision + 1);
    exp = 0;
  } else {
    const r = roundToSignificant(d.M, d.E, precision + 1);
    digits = r.digits;
    exp = r.exp;
  }
  const mantissa =
    digits[0] + (precision > 0 || flags.hash ? '.' + digits.slice(1) : '');
  const rest = mantissa + (upper ? 'E' : 'e') + expString(exp);
  return padNumeric(sign, '', rest, width, flags, true);
}

function formatFloatG(
  x: number,
  flags: Flags,
  width: number,
  precisionIn: number,
  upper: boolean
): string {
  const Pgiven = precisionIn === -1 ? 6 : precisionIn;
  const P = Pgiven === 0 ? 1 : Pgiven;
  const d = decompose(x);
  if (d.isNaN) {
    return padWidth((upper ? 'NAN' : 'nan'), width, flags.minus);
  }
  if (d.isInf) {
    const sign = getSign(d.negative, flags);
    return padNumeric(sign, '', upper ? 'INF' : 'inf', width, flags, false);
  }
  const sign = getSign(d.negative, flags);
  let digits: string;
  let X: number;
  if (d.isZero) {
    digits = '0'.repeat(P);
    X = 0;
  } else {
    const r = roundToSignificant(d.M, d.E, P);
    digits = r.digits;
    X = r.exp;
  }
  let rest: string;
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
    if (!flags.hash) {
      fracPart = fracPart.replace(/0+$/, '');
    }
    rest = intPart + (fracPart.length > 0 || flags.hash ? '.' + fracPart : '');
  } else {
    let mantFrac = digits.slice(1);
    if (!flags.hash) {
      mantFrac = mantFrac.replace(/0+$/, '');
    }
    const mantissa = digits[0] + (mantFrac.length > 0 || flags.hash ? '.' + mantFrac : '');
    rest = mantissa + (upper ? 'E' : 'e') + expString(X);
  }
  return padNumeric(sign, '', rest, width, flags, true);
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let argIdx = 0;
  let result = '';
  let i = 0;
  while (i < fmt.length) {
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
    while (i < fmt.length) {
      const c = fmt[i];
      if (c === '-') flags.minus = true;
      else if (c === '+') flags.plus = true;
      else if (c === ' ') flags.space = true;
      else if (c === '0') flags.zero = true;
      else if (c === '#') flags.hash = true;
      else break;
      i++;
    }
    let width = 0;
    while (i < fmt.length && fmt[i] >= '0' && fmt[i] <= '9') {
      width = width * 10 + (fmt.charCodeAt(i) - 48);
      i++;
    }
    let precision = -1;
    if (fmt[i] === '.') {
      i++;
      precision = 0;
      while (i < fmt.length && fmt[i] >= '0' && fmt[i] <= '9') {
        precision = precision * 10 + (fmt.charCodeAt(i) - 48);
        i++;
      }
    }
    const conv = fmt[i];
    i++;
    const arg = args[argIdx++];
    switch (conv) {
      case 'd':
      case 'i':
        result += formatDecimal(arg as number | bigint, flags, width, precision);
        break;
      case 'x':
      case 'X':
      case 'o':
        result += formatHexOct(arg as number | bigint, conv, flags, width, precision);
        break;
      case 'e':
        result += formatFloatE(arg as number, flags, width, precision, false);
        break;
      case 'E':
        result += formatFloatE(arg as number, flags, width, precision, true);
        break;
      case 'f':
        result += formatFloatF(arg as number, flags, width, precision, false);
        break;
      case 'F':
        result += formatFloatF(arg as number, flags, width, precision, true);
        break;
      case 'g':
        result += formatFloatG(arg as number, flags, width, precision, false);
        break;
      case 'G':
        result += formatFloatG(arg as number, flags, width, precision, true);
        break;
      case 's': {
        let str = arg as string;
        if (precision >= 0) str = str.slice(0, precision);
        result += padWidth(str, width, flags.minus);
        break;
      }
      case 'c': {
        const str = arg as string;
        result += padWidth(str, width, flags.minus);
        break;
      }
      default:
        break;
    }
  }
  return result;
}
