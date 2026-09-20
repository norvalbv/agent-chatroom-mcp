interface Result {
  text: string;
  signPrefixLen: number;
  allowZero: boolean;
}

// Exact decimal representation of a non-negative finite double:
// value === N * 10^-k, with N a non-negative BigInt and k >= 0.
function exactDecimal(value: number): { N: bigint; k: number } {
  if (value === 0) return { N: 0n, k: 0 };
  const buf = new ArrayBuffer(8);
  const view = new DataView(buf);
  view.setFloat64(0, value);
  const bits = view.getBigUint64(0);
  const expBits = Number((bits >> 52n) & 0x7ffn);
  const mantissaBits = bits & 0xfffffffffffffn;
  let mantissa: bigint;
  let exp2: number;
  if (expBits === 0) {
    mantissa = mantissaBits;
    exp2 = -1074;
  } else {
    mantissa = mantissaBits | (1n << 52n);
    exp2 = expBits - 1075;
  }
  if (exp2 >= 0) {
    return { N: mantissa << BigInt(exp2), k: 0 };
  }
  const k = -exp2;
  return { N: mantissa * 5n ** BigInt(k), k };
}

// Round N * 10^-k to targetK decimal places (round half to even),
// returning R such that the rounded value is R * 10^-targetK.
function roundToScale(N: bigint, k: number, targetK: number): bigint {
  if (targetK >= k) return N * 10n ** BigInt(targetK - k);
  const drop = k - targetK;
  const divisor = 10n ** BigInt(drop);
  let Q = N / divisor;
  const remainder = N % divisor;
  const half = divisor / 2n;
  if (remainder > half || (remainder === half && Q % 2n === 1n)) Q += 1n;
  return Q;
}

// Round N * 10^-k to `precision + 1` significant digits (half to even).
// Returns the digit string (length precision+1) and the base-10 exponent
// of the leading digit.
function sciDigits(N: bigint, k: number, precision: number): { digits: string; exponent: number } {
  const targetSig = precision + 1;
  if (N === 0n) return { digits: '0'.repeat(targetSig), exponent: 0 };
  const len = N.toString().length;
  const rawExp = len - 1 - k;
  const drop = len - targetSig;
  let Q: bigint;
  if (drop <= 0) {
    Q = N * 10n ** BigInt(-drop);
  } else {
    const divisor = 10n ** BigInt(drop);
    Q = N / divisor;
    const remainder = N % divisor;
    const half = divisor / 2n;
    if (remainder > half || (remainder === half && Q % 2n === 1n)) Q += 1n;
  }
  let qStr = Q.toString();
  let exponent = rawExp;
  if (qStr.length > targetSig) {
    exponent += qStr.length - targetSig;
    qStr = qStr.slice(0, targetSig);
  }
  return { digits: qStr, exponent };
}

function decimalDigits(magnitude: bigint, precision?: number): string {
  let s = magnitude.toString();
  if (magnitude === 0n && precision === 0) return '';
  if (precision !== undefined) s = s.padStart(precision, '0');
  return s;
}

function digitsWithPrecision(magnitude: bigint, radix: number, uppercase: boolean, precision?: number): string {
  let s = magnitude.toString(radix);
  if (uppercase) s = s.toUpperCase();
  if (magnitude === 0n && precision === 0) return '';
  if (precision !== undefined) s = s.padStart(precision, '0');
  return s;
}

function floatSign(value: number, flags: Set<string>): string {
  const negative = value < 0 || Object.is(value, -0);
  if (negative) return '-';
  if (flags.has('+')) return '+';
  if (flags.has(' ')) return ' ';
  return '';
}

function pad(res: Result, width: number, flags: Set<string>): string {
  if (res.text.length >= width) return res.text;
  const padLen = width - res.text.length;
  if (flags.has('-')) return res.text + ' '.repeat(padLen);
  if (res.allowZero && flags.has('0')) {
    return res.text.slice(0, res.signPrefixLen) + '0'.repeat(padLen) + res.text.slice(res.signPrefixLen);
  }
  return ' '.repeat(padLen) + res.text;
}

function formatInt(arg: number | bigint, flags: Set<string>, precision?: number): Result {
  const value = typeof arg === 'bigint' ? arg : BigInt(arg);
  const neg = value < 0n;
  const magnitude = neg ? -value : value;
  const sign = neg ? '-' : flags.has('+') ? '+' : flags.has(' ') ? ' ' : '';
  const digits = decimalDigits(magnitude, precision);
  return { text: sign + digits, signPrefixLen: sign.length, allowZero: precision === undefined };
}

function formatHexOct(arg: number | bigint, conv: 'x' | 'X' | 'o', flags: Set<string>, precision?: number): Result {
  const magnitude = typeof arg === 'bigint' ? arg : BigInt(arg);
  const radix = conv === 'o' ? 8 : 16;
  let digits = digitsWithPrecision(magnitude, radix, conv === 'X', precision);
  let prefix = '';
  if (conv === 'o') {
    if (flags.has('#')) {
      if (digits === '' || digits[0] !== '0') digits = '0' + digits;
    }
  } else if (flags.has('#') && magnitude !== 0n) {
    prefix = conv === 'X' ? '0X' : '0x';
  }
  return { text: prefix + digits, signPrefixLen: prefix.length, allowZero: precision === undefined };
}

function formatExp(value: number, conv: 'e' | 'E', flags: Set<string>, precision?: number): Result {
  const prec = precision === undefined ? 6 : precision;
  if (Number.isNaN(value)) return { text: conv === 'E' ? 'NAN' : 'nan', signPrefixLen: 0, allowZero: false };
  if (!Number.isFinite(value)) {
    const sign = floatSign(value, flags);
    return { text: sign + (conv === 'E' ? 'INF' : 'inf'), signPrefixLen: sign.length, allowZero: false };
  }
  const sign = floatSign(value, flags);
  const { N, k } = exactDecimal(Math.abs(value));
  const { digits, exponent } = sciDigits(N, k, prec);
  const mantissaDigit = digits[0];
  const frac = digits.slice(1);
  let m = mantissaDigit;
  if (prec > 0 || flags.has('#')) m += '.' + frac;
  const expSign = exponent < 0 ? '-' : '+';
  const expDigits = Math.abs(exponent).toString().padStart(2, '0');
  const eLetter = conv === 'E' ? 'E' : 'e';
  const text = sign + m + eLetter + expSign + expDigits;
  return { text, signPrefixLen: sign.length, allowZero: true };
}

function formatFixed(value: number, conv: 'f' | 'F', flags: Set<string>, precision?: number): Result {
  const prec = precision === undefined ? 6 : precision;
  if (Number.isNaN(value)) return { text: conv === 'F' ? 'NAN' : 'nan', signPrefixLen: 0, allowZero: false };
  if (!Number.isFinite(value)) {
    const sign = floatSign(value, flags);
    return { text: sign + (conv === 'F' ? 'INF' : 'inf'), signPrefixLen: sign.length, allowZero: false };
  }
  const sign = floatSign(value, flags);
  const { N, k } = exactDecimal(Math.abs(value));
  const R = roundToScale(N, k, prec);
  let s = R.toString();
  if (s.length < prec + 1) s = s.padStart(prec + 1, '0');
  const intPart = prec > 0 ? s.slice(0, s.length - prec) : s;
  const fracPart = prec > 0 ? s.slice(s.length - prec) : '';
  let text = sign + intPart;
  if (prec > 0 || flags.has('#')) text += '.' + fracPart;
  return { text, signPrefixLen: sign.length, allowZero: true };
}

function formatG(value: number, conv: 'g' | 'G', flags: Set<string>, precision?: number): Result {
  let P = precision === undefined ? 6 : precision;
  if (P === 0) P = 1;
  if (Number.isNaN(value)) return { text: conv === 'G' ? 'NAN' : 'nan', signPrefixLen: 0, allowZero: false };
  if (!Number.isFinite(value)) {
    const sign = floatSign(value, flags);
    return { text: sign + (conv === 'G' ? 'INF' : 'inf'), signPrefixLen: sign.length, allowZero: false };
  }
  const sign = floatSign(value, flags);
  const { N, k } = exactDecimal(Math.abs(value));
  const { digits, exponent: X } = sciDigits(N, k, P - 1);
  let body: string;
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
    if (!flags.has('#')) fracPart = fracPart.replace(/0+$/, '');
    body = intPart + (fracPart.length > 0 || flags.has('#') ? '.' + fracPart : '');
  } else {
    const mantissaDigit = digits[0];
    let frac = digits.slice(1);
    if (!flags.has('#')) frac = frac.replace(/0+$/, '');
    const expSign = X < 0 ? '-' : '+';
    const expDigits = Math.abs(X).toString().padStart(2, '0');
    const eLetter = conv === 'G' ? 'E' : 'e';
    body = mantissaDigit + (frac.length > 0 || flags.has('#') ? '.' + frac : '') + eLetter + expSign + expDigits;
  }
  const text = sign + body;
  return { text, signPrefixLen: sign.length, allowZero: true };
}

function formatS(arg: string, precision?: number): Result {
  let text = arg;
  if (precision !== undefined) text = text.slice(0, precision);
  return { text, signPrefixLen: 0, allowZero: false };
}

function formatC(arg: string): Result {
  return { text: arg, signPrefixLen: 0, allowZero: false };
}

const SPEC_RE = /%([-+ 0#]*)(\d*)(?:\.(\d*))?([diouxXeEfFgGsc%])/g;

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let argIndex = 0;
  let result = '';
  let lastIndex = 0;
  SPEC_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = SPEC_RE.exec(fmt)) !== null) {
    result += fmt.slice(lastIndex, m.index);
    lastIndex = SPEC_RE.lastIndex;
    const [, flagsStr, widthStr, precStr, conv] = m;
    if (conv === '%') {
      result += '%';
      continue;
    }
    const flags = new Set(flagsStr.split(''));
    const width = widthStr ? parseInt(widthStr, 10) : 0;
    const precision = precStr === undefined ? undefined : precStr === '' ? 0 : parseInt(precStr, 10);
    const arg = args[argIndex++];
    let res: Result;
    switch (conv) {
      case 'd':
      case 'i':
        res = formatInt(arg as number | bigint, flags, precision);
        break;
      case 'x':
      case 'X':
      case 'o':
        res = formatHexOct(arg as number | bigint, conv, flags, precision);
        break;
      case 'e':
      case 'E':
        res = formatExp(arg as number, conv, flags, precision);
        break;
      case 'f':
      case 'F':
        res = formatFixed(arg as number, conv, flags, precision);
        break;
      case 'g':
      case 'G':
        res = formatG(arg as number, conv, flags, precision);
        break;
      case 's':
        res = formatS(arg as string, precision);
        break;
      case 'c':
        res = formatC(arg as string);
        break;
      default:
        throw new Error('unreachable');
    }
    result += pad(res, width, flags);
  }
  result += fmt.slice(lastIndex);
  return result;
}
