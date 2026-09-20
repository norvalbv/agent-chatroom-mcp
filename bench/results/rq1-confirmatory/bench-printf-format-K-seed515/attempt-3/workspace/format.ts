interface FlagSet {
  minus: boolean;
  plus: boolean;
  space: boolean;
  zero: boolean;
  hash: boolean;
}

function padSpace(str: string, width: number, leftJustify: boolean): string {
  if (str.length >= width) return str;
  const p = ' '.repeat(width - str.length);
  return leftJustify ? str + p : p + str;
}

// Exact fraction absValue = num / den (den is a power of two), for a finite non-negative double.
function exactFraction(absValue: number): { num: bigint; den: bigint } {
  if (absValue === 0) return { num: 0n, den: 1n };
  const buf = new ArrayBuffer(8);
  const dv = new DataView(buf);
  dv.setFloat64(0, absValue);
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const exponentBits = (hi >>> 20) & 0x7ff;
  const mantissaHi = hi & 0xfffff;
  const mantissa = (BigInt(mantissaHi) << 32n) | BigInt(lo);
  let num: bigint;
  let exp: number;
  if (exponentBits === 0) {
    num = mantissa;
    exp = -1074;
  } else {
    num = mantissa | (1n << 52n);
    exp = exponentBits - 1075;
  }
  let den: bigint;
  if (exp >= 0) {
    num = num * 2n ** BigInt(exp);
    den = 1n;
  } else {
    den = 2n ** BigInt(-exp);
  }
  return { num, den };
}

// round(num/den * 10^k) to nearest, ties to even. num >= 0, den > 0.
function roundExact(num: bigint, den: bigint, k: number): bigint {
  let numerator: bigint;
  let denom: bigint;
  if (k >= 0) {
    numerator = num * 10n ** BigInt(k);
    denom = den;
  } else {
    numerator = num;
    denom = den * 10n ** BigInt(-k);
  }
  let quotient = numerator / denom;
  const remainder = numerator % denom;
  const twice = remainder * 2n;
  if (twice > denom) {
    quotient += 1n;
  } else if (twice === denom) {
    if (quotient % 2n !== 0n) quotient += 1n;
  }
  return quotient;
}

function fDigits(num: bigint, den: bigint, precision: number): { intPart: string; fracDigits: string } {
  const total = roundExact(num, den, precision);
  let s = total.toString();
  if (precision === 0) return { intPart: s, fracDigits: '' };
  if (s.length <= precision) s = s.padStart(precision + 1, '0');
  return { intPart: s.slice(0, s.length - precision), fracDigits: s.slice(s.length - precision) };
}

function computeSigDigits(
  num: bigint,
  den: bigint,
  absValue: number,
  P: number,
): { digits: string; exp: number } {
  if (num === 0n) return { digits: '0'.repeat(P), exp: 0 };
  let x0 = Math.floor(Math.log10(absValue));
  let digitsStr = '';
  for (let iter = 0; iter < 30; iter++) {
    const k = P - 1 - x0;
    const digitsBig = roundExact(num, den, k);
    digitsStr = digitsBig.toString();
    if (digitsStr.length === P) break;
    if (digitsStr.length > P) {
      x0++;
    } else {
      x0--;
    }
  }
  return { digits: digitsStr, exp: x0 };
}

function fStyleString(num: bigint, den: bigint, precision: number, hash: boolean): string {
  const { intPart, fracDigits } = fDigits(num, den, precision);
  const fracPart = precision === 0 ? (hash ? '.' : '') : '.' + fracDigits;
  return intPart + fracPart;
}

function eStyleString(
  num: bigint,
  den: bigint,
  absValue: number,
  precision: number,
  hash: boolean,
  letter: string,
): string {
  const P = precision + 1;
  const { digits, exp } = computeSigDigits(num, den, absValue, P);
  const first = digits[0];
  const frac = digits.slice(1);
  const fracPart = precision === 0 ? (hash ? '.' : '') : '.' + frac;
  const expSign = exp < 0 ? '-' : '+';
  const expAbs = String(Math.abs(exp)).padStart(2, '0');
  return first + fracPart + letter + expSign + expAbs;
}

function gStyleString(
  num: bigint,
  den: bigint,
  absValue: number,
  precisionRaw: number | null,
  hash: boolean,
  upper: boolean,
): string {
  const P = precisionRaw === null ? 6 : precisionRaw === 0 ? 1 : precisionRaw;
  const { digits, exp } = computeSigDigits(num, den, absValue, P);
  const X = exp;
  if (P > X && X >= -4) {
    const fPrecision = P - 1 - X;
    const { intPart, fracDigits } = fDigits(num, den, fPrecision);
    let frac = fracDigits;
    if (!hash) frac = frac.replace(/0+$/, '');
    const dot = frac.length > 0 ? '.' + frac : hash ? '.' : '';
    return intPart + dot;
  }
  const first = digits[0];
  let frac = digits.slice(1);
  if (!hash) frac = frac.replace(/0+$/, '');
  const dot = frac.length > 0 ? '.' + frac : hash ? '.' : '';
  const expSign = X < 0 ? '-' : '+';
  const expAbs = String(Math.abs(X)).padStart(2, '0');
  const letter = upper ? 'E' : 'e';
  return first + dot + letter + expSign + expAbs;
}

function formatFloatConv(
  conv: string,
  flags: FlagSet,
  width: number,
  precisionRaw: number | null,
  value: number,
): string {
  const upper = conv === conv.toUpperCase();
  const isNegSign = value < 0 || Object.is(value, -0);
  const isNaNVal = Number.isNaN(value);
  const isFiniteNum = Number.isFinite(value);
  let sign: string;
  let bodyText: string;
  if (isNaNVal) {
    sign = '';
    bodyText = upper ? 'NAN' : 'nan';
  } else {
    sign = isNegSign ? '-' : flags.plus ? '+' : flags.space ? ' ' : '';
    if (!isFiniteNum) {
      bodyText = upper ? 'INF' : 'inf';
    } else {
      const absValue = Math.abs(value);
      const { num, den } = exactFraction(absValue);
      const lower = conv.toLowerCase();
      if (lower === 'f') {
        const precision = precisionRaw === null ? 6 : precisionRaw;
        bodyText = fStyleString(num, den, precision, flags.hash);
      } else if (lower === 'e') {
        const precision = precisionRaw === null ? 6 : precisionRaw;
        bodyText = eStyleString(num, den, absValue, precision, flags.hash, upper ? 'E' : 'e');
      } else {
        bodyText = gStyleString(num, den, absValue, precisionRaw, flags.hash, upper);
      }
    }
  }
  const zeroActive = flags.zero && !flags.minus && isFiniteNum && !isNaNVal;
  const full = sign + bodyText;
  if (zeroActive && width > full.length) {
    return sign + '0'.repeat(width - full.length) + bodyText;
  }
  return padSpace(full, width, flags.minus);
}

function intDigits(mag: bigint, base: number, precision: number | null): string {
  const natural = mag.toString(base);
  if (precision !== null) {
    if (precision === 0 && mag === 0n) return '';
    return natural.padStart(precision, '0');
  }
  return natural;
}

function formatIntConv(
  conv: string,
  flags: FlagSet,
  width: number,
  precisionRaw: number | null,
  arg: number | bigint,
): string {
  let mag: bigint;
  let isNeg = false;
  if (conv === 'd' || conv === 'i') {
    if (typeof arg === 'bigint') {
      isNeg = arg < 0n;
      mag = isNeg ? -arg : arg;
    } else {
      isNeg = arg < 0;
      mag = BigInt(Math.trunc(Math.abs(arg)));
    }
  } else {
    mag = typeof arg === 'bigint' ? arg : BigInt(arg);
  }

  let digits: string;
  let prefix = '';
  let sign = '';
  if (conv === 'd' || conv === 'i') {
    sign = isNeg ? '-' : flags.plus ? '+' : flags.space ? ' ' : '';
    digits = intDigits(mag, 10, precisionRaw);
  } else if (conv === 'x' || conv === 'X') {
    digits = intDigits(mag, 16, precisionRaw);
    if (conv === 'X') digits = digits.toUpperCase();
    if (flags.hash && mag !== 0n) prefix = conv === 'x' ? '0x' : '0X';
  } else {
    digits = intDigits(mag, 8, precisionRaw);
    if (flags.hash) {
      if (digits === '' || digits[0] !== '0') digits = '0' + digits;
    }
  }

  const zeroActive = flags.zero && !flags.minus && precisionRaw === null;
  const prefixSign = sign + prefix;
  const full = prefixSign + digits;
  if (zeroActive && width > full.length) {
    return prefixSign + '0'.repeat(width - full.length) + digits;
  }
  return padSpace(full, width, flags.minus);
}

function formatStringConv(
  conv: string,
  flags: FlagSet,
  width: number,
  precisionRaw: number | null,
  arg: string,
): string {
  let text = arg;
  if (conv === 's' && precisionRaw !== null) text = text.slice(0, precisionRaw);
  return padSpace(text, width, flags.minus);
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  const re = /%([-+0# ]*)(\d*)(?:\.(\d*))?([a-zA-Z%])/g;
  let result = '';
  let lastIndex = 0;
  let argIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = re.exec(fmt)) !== null) {
    result += fmt.slice(lastIndex, match.index);
    lastIndex = re.lastIndex;

    const [, flagStr, widthStr, precisionStr, conv] = match;

    if (conv === '%') {
      result += '%';
      continue;
    }

    const flags: FlagSet = {
      minus: flagStr.includes('-'),
      plus: flagStr.includes('+'),
      space: flagStr.includes(' '),
      zero: flagStr.includes('0'),
      hash: flagStr.includes('#'),
    };
    const width = widthStr === '' ? 0 : parseInt(widthStr, 10);
    const precisionRaw = precisionStr === undefined ? null : precisionStr === '' ? 0 : parseInt(precisionStr, 10);

    const arg = args[argIndex++];

    if (conv === 'd' || conv === 'i' || conv === 'x' || conv === 'X' || conv === 'o') {
      result += formatIntConv(conv, flags, width, precisionRaw, arg as number | bigint);
    } else if (
      conv === 'e' ||
      conv === 'E' ||
      conv === 'f' ||
      conv === 'F' ||
      conv === 'g' ||
      conv === 'G'
    ) {
      result += formatFloatConv(conv, flags, width, precisionRaw, arg as number);
    } else if (conv === 's' || conv === 'c') {
      result += formatStringConv(conv, flags, width, precisionRaw, arg as string);
    }
  }

  result += fmt.slice(lastIndex);
  return result;
}
