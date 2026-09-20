type Flags = Set<string>;

interface Spec {
  flags: Flags;
  width: number;
  precision: number | null;
  conv: string;
}

function decomposeDouble(value: number): { neg: boolean; num: bigint; den: bigint } {
  const buf = new ArrayBuffer(8);
  const dv = new DataView(buf);
  dv.setFloat64(0, value);
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const neg = (hi >>> 31) !== 0;
  const expBits = (hi >>> 20) & 0x7ff;
  const mantHigh = hi & 0xfffff;
  let mantissa = (BigInt(mantHigh) << 32n) | BigInt(lo);
  let exp2: number;
  if (expBits === 0) {
    exp2 = -1074;
  } else {
    mantissa = mantissa | (1n << 52n);
    exp2 = expBits - 1075;
  }
  let num: bigint;
  let den: bigint;
  if (exp2 >= 0) {
    num = mantissa << BigInt(exp2);
    den = 1n;
  } else {
    num = mantissa;
    den = 1n << BigInt(-exp2);
  }
  return { neg, num, den };
}

function roundDiv(numerator: bigint, denominator: bigint): bigint {
  let q = numerator / denominator;
  const r = numerator % denominator;
  const twiceR = r * 2n;
  if (twiceR > denominator) {
    q += 1n;
  } else if (twiceR === denominator) {
    if (q % 2n === 1n) q += 1n;
  }
  return q;
}

// Round num/den to `p` fractional decimal digits, returning the full digit
// string of round(num/den * 10^p) (an integer with no embedded point).
function roundFixed(num: bigint, den: bigint, p: number): string {
  let numerator: bigint;
  let denominator: bigint;
  if (p >= 0) {
    numerator = num * 10n ** BigInt(p);
    denominator = den;
  } else {
    numerator = num;
    denominator = den * 10n ** BigInt(-p);
  }
  const q = roundDiv(numerator, denominator);
  return q.toString();
}

// Find exponent E such that 10^E <= num/den < 10^(E+1), for num/den > 0.
function findExponent(num: bigint, den: bigint, guess: number): number {
  function geThreshold(e: number): boolean {
    if (e >= 0) return num >= den * 10n ** BigInt(e);
    return num * 10n ** BigInt(-e) >= den;
  }
  let E = guess;
  while (!geThreshold(E)) E -= 1;
  while (geThreshold(E + 1)) E += 1;
  return E;
}

// Estimate floor(log10(num/den)) without overflowing Number for huge
// bigints (e.g. denominators as large as 2^1074 for subnormal doubles).
function log10Estimate(num: bigint, den: bigint): number {
  return num.toString().length - den.toString().length;
}

// Compute p+1 significant digits and the (possibly adjusted) exponent.
function significantDigits(num: bigint, den: bigint, p: number): { digits: string; exp: number } {
  let E = findExponent(num, den, log10Estimate(num, den));

  let numerator: bigint;
  let denominator: bigint;
  const shift = p - E;
  if (shift >= 0) {
    numerator = num * 10n ** BigInt(shift);
    denominator = den;
  } else {
    numerator = num;
    denominator = den * 10n ** BigInt(-shift);
  }
  let N = roundDiv(numerator, denominator);
  const upperBound = 10n ** BigInt(p + 1);
  if (N >= upperBound) {
    N = N / 10n;
    E += 1;
  }
  let digits = N.toString();
  while (digits.length < p + 1) digits = '0' + digits;
  return { digits, exp: E };
}

function padWithZero(sign: string, prefix: string, digits: string, width: number, minus: boolean, zero: boolean): string {
  const total = sign.length + prefix.length + digits.length;
  if (total >= width) return sign + prefix + digits;
  const pad = width - total;
  if (minus) return sign + prefix + digits + ' '.repeat(pad);
  if (zero) return sign + prefix + '0'.repeat(pad) + digits;
  return ' '.repeat(pad) + sign + prefix + digits;
}

function padSpacesOnly(text: string, width: number, minus: boolean): string {
  if (text.length >= width) return text;
  const pad = ' '.repeat(width - text.length);
  return minus ? text + pad : pad + text;
}

function formatInt(rawValue: bigint, conv: string, flags: Flags, width: number, precision: number | null): string {
  const neg = rawValue < 0n;
  const abs = neg ? -rawValue : rawValue;

  let base: number;
  let upper = false;
  if (conv === 'x' || conv === 'X') {
    base = 16;
    upper = conv === 'X';
  } else if (conv === 'o') {
    base = 8;
  } else {
    base = 10;
  }

  let digits: string;
  if (precision !== null && precision === 0 && abs === 0n) {
    digits = '';
  } else {
    digits = abs.toString(base);
    if (upper) digits = digits.toUpperCase();
    if (precision !== null && digits.length < precision) {
      digits = '0'.repeat(precision - digits.length) + digits;
    }
  }

  let prefix = '';
  if ((conv === 'x' || conv === 'X') && flags.has('#') && abs !== 0n) {
    prefix = conv === 'x' ? '0x' : '0X';
  }
  if (conv === 'o' && flags.has('#')) {
    if (digits.length === 0 || digits[0] !== '0') {
      digits = '0' + digits;
    }
  }

  let sign = '';
  if (conv === 'd' || conv === 'i') {
    sign = neg ? '-' : flags.has('+') ? '+' : flags.has(' ') ? ' ' : '';
  }

  const zeroAllowed = flags.has('0') && !flags.has('-') && precision === null;
  return padWithZero(sign, prefix, digits, width, flags.has('-'), zeroAllowed);
}

function signFor(neg: boolean, flags: Flags): string {
  return neg ? '-' : flags.has('+') ? '+' : flags.has(' ') ? ' ' : '';
}

function formatFloat(value: number, conv: string, flags: Flags, width: number, precision: number | null): string {
  const upper = conv === conv.toUpperCase();
  const kind = conv.toLowerCase();

  if (Number.isNaN(value)) {
    const word = upper ? 'NAN' : 'nan';
    return padSpacesOnly(word, width, flags.has('-'));
  }

  const neg = value < 0 || Object.is(value, -0);

  if (!isFinite(value)) {
    const sign = signFor(neg, flags);
    const word = upper ? 'INF' : 'inf';
    return padWithZero(sign, '', word, width, flags.has('-'), false);
  }

  const { neg: signBit, num, den } = decomposeDouble(value);
  const sign = signFor(signBit, flags);
  const isZero = num === 0n;
  const zeroAllowed = flags.has('0') && !flags.has('-');

  if (kind === 'f') {
    const p = precision === null ? 6 : precision;
    const digitsStr = isZero ? '0'.repeat(p + 1) : roundFixed(num, den, p).padStart(p + 1, '0');
    const intPart = digitsStr.slice(0, digitsStr.length - p) || '0';
    const fracPart = p > 0 ? digitsStr.slice(digitsStr.length - p) : '';
    const dot = p > 0 || flags.has('#') ? '.' : '';
    const body = intPart + dot + fracPart;
    return padWithZero(sign, '', body, width, flags.has('-'), zeroAllowed);
  }

  if (kind === 'e') {
    const p = precision === null ? 6 : precision;
    let digits: string;
    let exp: number;
    if (isZero) {
      digits = '0'.repeat(p + 1);
      exp = 0;
    } else {
      const r = significantDigits(num, den, p);
      digits = r.digits;
      exp = r.exp;
    }
    const dot = p > 0 || flags.has('#') ? '.' : '';
    const frac = p > 0 ? digits.slice(1) : '';
    const expLetter = upper ? 'E' : 'e';
    const expSign = exp < 0 ? '-' : '+';
    const expDigits = Math.abs(exp).toString().padStart(2, '0');
    const body = digits[0] + dot + frac + expLetter + expSign + expDigits;
    return padWithZero(sign, '', body, width, flags.has('-'), zeroAllowed);
  }

  // g / G
  let P = precision === null ? 6 : precision === 0 ? 1 : precision;
  let digits: string;
  let X: number;
  if (isZero) {
    digits = '0'.repeat(P);
    X = 0;
  } else {
    const r = significantDigits(num, den, P - 1);
    digits = r.digits;
    X = r.exp;
  }

  const useF = P > X && X >= -4;
  let body: string;
  if (useF) {
    const fracPrecision = P - 1 - X;
    const digitsStr = isZero
      ? '0'.repeat(fracPrecision + 1)
      : roundFixed(num, den, fracPrecision).padStart(fracPrecision + 1, '0');
    const intPart = digitsStr.slice(0, digitsStr.length - fracPrecision) || '0';
    let fracPart = fracPrecision > 0 ? digitsStr.slice(digitsStr.length - fracPrecision) : '';
    if (!flags.has('#')) {
      fracPart = fracPart.replace(/0+$/, '');
    }
    body = fracPart.length > 0 ? intPart + '.' + fracPart : flags.has('#') ? intPart + '.' : intPart;
  } else {
    const p = P - 1;
    let frac = p > 0 ? digits.slice(1) : '';
    if (!flags.has('#')) {
      frac = frac.replace(/0+$/, '');
    }
    const dot = frac.length > 0 || flags.has('#') ? '.' : '';
    const expLetter = upper ? 'E' : 'e';
    const expSign = X < 0 ? '-' : '+';
    const expDigits = Math.abs(X).toString().padStart(2, '0');
    body = digits[0] + dot + frac + expLetter + expSign + expDigits;
  }

  return padWithZero(sign, '', body, width, flags.has('-'), zeroAllowed);
}

function toBigIntArg(arg: number | bigint): bigint {
  return typeof arg === 'bigint' ? arg : BigInt(arg);
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  const specRe = /%([-+0 #]*)(\d*)(?:\.(\d*))?([a-zA-Z%])/g;
  let result = '';
  let lastIndex = 0;
  let argIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = specRe.exec(fmt)) !== null) {
    result += fmt.slice(lastIndex, match.index);
    lastIndex = specRe.lastIndex;

    const [, flagsStr, widthStr, precisionStr, conv] = match;

    if (conv === '%') {
      result += '%';
      continue;
    }

    const flags: Flags = new Set(flagsStr.split('').filter((c) => c.length > 0));
    const width = widthStr === '' ? 0 : parseInt(widthStr, 10);
    const precision = precisionStr === undefined ? null : precisionStr === '' ? 0 : parseInt(precisionStr, 10);

    const arg = args[argIndex++];

    if (conv === 'd' || conv === 'i') {
      result += formatInt(toBigIntArg(arg as number | bigint), conv, flags, width, precision);
    } else if (conv === 'x' || conv === 'X' || conv === 'o') {
      result += formatInt(toBigIntArg(arg as number | bigint), conv, flags, width, precision);
    } else if (conv === 'e' || conv === 'E' || conv === 'f' || conv === 'F' || conv === 'g' || conv === 'G') {
      result += formatFloat(arg as number, conv, flags, width, precision);
    } else if (conv === 's') {
      let s = arg as string;
      if (precision !== null) s = s.slice(0, precision);
      result += padSpacesOnly(s, width, flags.has('-'));
    } else if (conv === 'c') {
      const s = arg as string;
      result += padSpacesOnly(s, width, flags.has('-'));
    }
  }

  result += fmt.slice(lastIndex);
  return result;
}
