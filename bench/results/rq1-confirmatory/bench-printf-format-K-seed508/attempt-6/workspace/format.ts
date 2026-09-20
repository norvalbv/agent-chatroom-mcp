interface Flags {
  minus: boolean;
  plus: boolean;
  space: boolean;
  zero: boolean;
  hash: boolean;
}

interface ConvResult {
  text: string;
  padWithZero: boolean;
  prefixLen: number;
}

function exactFraction(value: number): { D: bigint; fracDigits: number } {
  if (value === 0) return { D: 0n, fracDigits: 0 };
  const buf = new ArrayBuffer(8);
  const dv = new DataView(buf);
  dv.setFloat64(0, value);
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const exponentBits = (hi >>> 20) & 0x7ff;
  const mantissaHigh = hi & 0xfffff;
  let mantissa = (BigInt(mantissaHigh) << 32n) | BigInt(lo);
  let exp: number;
  if (exponentBits === 0) {
    exp = -1074;
  } else {
    mantissa |= 1n << 52n;
    exp = exponentBits - 1075;
  }
  if (exp >= 0) {
    return { D: mantissa << BigInt(exp), fracDigits: 0 };
  } else {
    const k = -exp;
    return { D: mantissa * 5n ** BigInt(k), fracDigits: k };
  }
}

function roundToScale(D: bigint, fracDigits: number, Q: number): bigint {
  if (Q >= fracDigits) {
    return D * 10n ** BigInt(Q - fracDigits);
  }
  const diff = fracDigits - Q;
  const divisor = 10n ** BigInt(diff);
  const q = D / divisor;
  const r = D % divisor;
  const twice = r * 2n;
  if (twice < divisor) return q;
  if (twice > divisor) return q + 1n;
  return q % 2n === 0n ? q : q + 1n;
}

function computeSignificantDigits(absValue: number, S: number): { digits: string; exponent: number } {
  if (absValue === 0) return { digits: '0'.repeat(S), exponent: 0 };
  const { D, fracDigits } = exactFraction(absValue);
  const Dstr = D.toString();
  const len = Dstr.length;
  let exponent = len - 1 - fracDigits;
  let digits: string;
  if (len === S) {
    digits = Dstr;
  } else if (len < S) {
    digits = Dstr + '0'.repeat(S - len);
  } else {
    const diff = len - S;
    const divisor = 10n ** BigInt(diff);
    const q = D / divisor;
    const r = D % divisor;
    const twice = r * 2n;
    let R: bigint;
    if (twice < divisor) R = q;
    else if (twice > divisor) R = q + 1n;
    else R = q % 2n === 0n ? q : q + 1n;
    let Rstr = R.toString();
    if (Rstr.length > S) {
      exponent += Rstr.length - S;
      Rstr = Rstr.slice(0, S);
    }
    digits = Rstr;
  }
  return { digits, exponent };
}

function stripTrailingZeros(s: string): string {
  if (!s.includes('.')) return s;
  s = s.replace(/0+$/, '');
  if (s.endsWith('.')) s = s.slice(0, -1);
  return s;
}

function signFor(negative: boolean, flags: Flags): string {
  if (negative) return '-';
  if (flags.plus) return '+';
  if (flags.space) return ' ';
  return '';
}

function convertDI(arg: number | bigint, flags: Flags, precision: number | null): ConvResult {
  let neg: boolean;
  let mag: bigint;
  if (typeof arg === 'bigint') {
    neg = arg < 0n;
    mag = neg ? -arg : arg;
  } else {
    neg = arg < 0;
    mag = BigInt(Math.trunc(Math.abs(arg)));
  }
  let digitsStr: string;
  if (precision !== null) {
    if (precision === 0 && mag === 0n) digitsStr = '';
    else digitsStr = mag.toString().padStart(precision, '0');
  } else {
    digitsStr = mag.toString();
  }
  const sign = signFor(neg, flags);
  const text = sign + digitsStr;
  return { text, padWithZero: flags.zero && precision === null, prefixLen: sign.length };
}

function convertXXO(conv: string, arg: number | bigint, flags: Flags, precision: number | null): ConvResult {
  const mag: bigint = typeof arg === 'bigint' ? arg : BigInt(Math.trunc(arg));
  const base = conv === 'o' ? 8 : 16;
  let raw = mag.toString(base);
  if (conv === 'X') raw = raw.toUpperCase();
  let digitsStr: string;
  if (precision !== null) {
    if (precision === 0 && mag === 0n) digitsStr = '';
    else digitsStr = raw.padStart(precision, '0');
  } else {
    digitsStr = raw;
  }
  let prefix = '';
  if (flags.hash) {
    if (conv === 'o') {
      if (digitsStr === '' || digitsStr[0] !== '0') digitsStr = '0' + digitsStr;
    } else if (mag !== 0n) {
      prefix = conv === 'x' ? '0x' : '0X';
    }
  }
  const text = prefix + digitsStr;
  return { text, padWithZero: flags.zero && precision === null, prefixLen: prefix.length };
}

function convertEF(conv: string, value: number, flags: Flags, precision: number | null): ConvResult {
  const isUpper = conv === 'E' || conv === 'F';
  if (Number.isNaN(value)) {
    return { text: isUpper ? 'NAN' : 'nan', padWithZero: false, prefixLen: 0 };
  }
  const negative = value < 0 || Object.is(value, -0);
  if (!Number.isFinite(value)) {
    const sign = signFor(negative, flags);
    const body = isUpper ? 'INF' : 'inf';
    return { text: sign + body, padWithZero: false, prefixLen: sign.length };
  }
  const absValue = Math.abs(value);
  const P = precision === null ? 6 : precision;
  const sign = signFor(negative, flags);
  let body: string;
  if (conv === 'e' || conv === 'E') {
    const { digits, exponent } = computeSignificantDigits(absValue, P + 1);
    const leading = digits[0];
    const frac = digits.slice(1);
    const mantissa = P === 0 ? (flags.hash ? leading + '.' : leading) : leading + '.' + frac;
    const expSign = exponent < 0 ? '-' : '+';
    const expAbs = Math.abs(exponent).toString().padStart(2, '0');
    const eChar = conv === 'E' ? 'E' : 'e';
    body = mantissa + eChar + expSign + expAbs;
  } else {
    const { D, fracDigits } = exactFraction(absValue);
    const R = roundToScale(D, fracDigits, P);
    const Rstr = R.toString().padStart(P + 1, '0');
    const intPart = Rstr.slice(0, Rstr.length - P) || '0';
    const fracPart = P > 0 ? Rstr.slice(Rstr.length - P) : '';
    body = P === 0 ? (flags.hash ? intPart + '.' : intPart) : intPart + '.' + fracPart;
  }
  const text = sign + body;
  return { text, padWithZero: flags.zero, prefixLen: sign.length };
}

function convertG(conv: string, value: number, flags: Flags, precision: number | null): ConvResult {
  const isUpper = conv === 'G';
  if (Number.isNaN(value)) {
    return { text: isUpper ? 'NAN' : 'nan', padWithZero: false, prefixLen: 0 };
  }
  const negative = value < 0 || Object.is(value, -0);
  if (!Number.isFinite(value)) {
    const sign = signFor(negative, flags);
    const body = isUpper ? 'INF' : 'inf';
    return { text: sign + body, padWithZero: false, prefixLen: sign.length };
  }
  const absValue = Math.abs(value);
  let P = precision === null ? 6 : precision;
  if (P === 0) P = 1;
  const { digits, exponent: X } = computeSignificantDigits(absValue, P);
  const sign = signFor(negative, flags);
  let body: string;
  if (P > X && X >= -4) {
    let fracPart: string;
    let intPart: string;
    if (X >= 0) {
      intPart = digits.slice(0, X + 1);
      fracPart = digits.slice(X + 1);
    } else {
      intPart = '0';
      fracPart = '0'.repeat(-X - 1) + digits;
    }
    body = fracPart.length > 0 ? intPart + '.' + fracPart : intPart + (flags.hash ? '.' : '');
    if (!flags.hash) body = stripTrailingZeros(body);
  } else {
    const leading = digits[0];
    const frac = digits.slice(1);
    let mantissa = frac.length > 0 ? leading + '.' + frac : leading + (flags.hash ? '.' : '');
    if (!flags.hash) mantissa = stripTrailingZeros(mantissa);
    const expSign = X < 0 ? '-' : '+';
    const expAbs = Math.abs(X).toString().padStart(2, '0');
    const eChar = conv === 'G' ? 'E' : 'e';
    body = mantissa + eChar + expSign + expAbs;
  }
  const text = sign + body;
  return { text, padWithZero: flags.zero, prefixLen: sign.length };
}

function pad(conv: ConvResult, width: number, minus: boolean): string {
  const { text, padWithZero, prefixLen } = conv;
  if (text.length >= width) return text;
  const fill = width - text.length;
  if (minus) return text + ' '.repeat(fill);
  if (padWithZero) {
    return text.slice(0, prefixLen) + '0'.repeat(fill) + text.slice(prefixLen);
  }
  return ' '.repeat(fill) + text;
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let argIndex = 0;
  let result = '';
  let i = 0;
  const n = fmt.length;
  while (i < n) {
    const ch = fmt[i];
    if (ch !== '%') {
      result += ch;
      i++;
      continue;
    }
    let j = i + 1;
    let flagsStr = '';
    while (j < n && '-+ 0#'.includes(fmt[j])) {
      flagsStr += fmt[j];
      j++;
    }
    let widthStr = '';
    while (j < n && fmt[j] >= '0' && fmt[j] <= '9') {
      widthStr += fmt[j];
      j++;
    }
    let precStr: string | null = null;
    if (fmt[j] === '.') {
      j++;
      precStr = '';
      while (j < n && fmt[j] >= '0' && fmt[j] <= '9') {
        precStr += fmt[j];
        j++;
      }
    }
    const conv = fmt[j];
    j++;

    if (conv === '%') {
      result += '%';
      i = j;
      continue;
    }

    const width = widthStr ? parseInt(widthStr, 10) : 0;
    const precision = precStr !== null ? (precStr === '' ? 0 : parseInt(precStr, 10)) : null;
    const flags: Flags = {
      minus: flagsStr.includes('-'),
      plus: flagsStr.includes('+'),
      space: flagsStr.includes(' '),
      zero: flagsStr.includes('0'),
      hash: flagsStr.includes('#'),
    };
    const arg = args[argIndex++];

    let convResult: ConvResult;
    switch (conv) {
      case 'd':
      case 'i':
        convResult = convertDI(arg as number | bigint, flags, precision);
        break;
      case 'x':
      case 'X':
      case 'o':
        convResult = convertXXO(conv, arg as number | bigint, flags, precision);
        break;
      case 'e':
      case 'E':
      case 'f':
      case 'F':
        convResult = convertEF(conv, arg as number, flags, precision);
        break;
      case 'g':
      case 'G':
        convResult = convertG(conv, arg as number, flags, precision);
        break;
      case 's': {
        const s = arg as string;
        const text = precision !== null ? s.slice(0, precision) : s;
        convResult = { text, padWithZero: false, prefixLen: 0 };
        break;
      }
      case 'c': {
        convResult = { text: arg as string, padWithZero: false, prefixLen: 0 };
        break;
      }
      default:
        throw new Error(`Unsupported conversion: %${conv}`);
    }

    result += pad(convResult, width, flags.minus);
    i = j;
  }
  return result;
}
