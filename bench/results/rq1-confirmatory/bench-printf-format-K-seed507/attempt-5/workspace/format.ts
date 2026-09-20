type Flags = {
  minus: boolean;
  plus: boolean;
  space: boolean;
  zero: boolean;
  hash: boolean;
};

function parseFlags(s: string): Flags {
  return {
    minus: s.includes('-'),
    plus: s.includes('+'),
    space: s.includes(' '),
    zero: s.includes('0'),
    hash: s.includes('#'),
  };
}

function padNumeric(
  main: string,
  sign: string,
  width: number,
  minus: boolean,
  zero: boolean,
): string {
  const full = sign + main;
  if (full.length >= width) return full;
  const padLen = width - full.length;
  if (minus) return full + ' '.repeat(padLen);
  if (zero) return sign + '0'.repeat(padLen) + main;
  return ' '.repeat(padLen) + full;
}

function padPlain(text: string, width: number, minus: boolean): string {
  if (text.length >= width) return text;
  const padLen = width - text.length;
  return minus ? text + ' '.repeat(padLen) : ' '.repeat(padLen) + text;
}

// Decompose |x| (finite, x !== 0 handled by caller separately if needed)
// into mantissa (non-negative BigInt) and exponent such that |x| = mantissa * 2^exponent.
function decompose(absX: number): { mantissa: bigint; exponent: number } {
  const buf = new ArrayBuffer(8);
  const dv = new DataView(buf);
  dv.setFloat64(0, absX);
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const expBits = (hi >>> 20) & 0x7ff;
  const mantHi = hi & 0xfffff;
  const mantissaBits = (BigInt(mantHi) << 32n) | BigInt(lo >>> 0);
  if (expBits === 0) {
    return { mantissa: mantissaBits, exponent: -1074 };
  }
  const mantissa = mantissaBits | (1n << 52n);
  const exponent = expBits - 1075;
  return { mantissa, exponent };
}

// Compute round-half-to-even(mantissa * 2^exponent * 10^scale) as a BigInt.
function roundToScale(mantissa: bigint, exponent: number, scale: number): bigint {
  if (mantissa === 0n) return 0n;
  const e2 = exponent + scale;
  const e5 = scale;
  let numerator = mantissa;
  let denominator = 1n;
  if (e2 >= 0) numerator *= 2n ** BigInt(e2);
  else denominator *= 2n ** BigInt(-e2);
  if (e5 >= 0) numerator *= 5n ** BigInt(e5);
  else denominator *= 5n ** BigInt(-e5);
  if (denominator === 1n) return numerator;
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  const twice = remainder * 2n;
  if (twice > denominator || (twice === denominator && quotient % 2n === 1n)) {
    return quotient + 1n;
  }
  return quotient;
}

function fStyleDigits(
  absX: number,
  precision: number,
): { intPart: string; fracPart: string } {
  const { mantissa, exponent } = decompose(absX);
  const rounded = roundToScale(mantissa, exponent, precision);
  let digitStr = rounded.toString();
  if (digitStr.length <= precision) {
    digitStr = '0'.repeat(precision - digitStr.length + 1) + digitStr;
  }
  if (precision === 0) return { intPart: digitStr, fracPart: '' };
  return {
    intPart: digitStr.slice(0, digitStr.length - precision),
    fracPart: digitStr.slice(digitStr.length - precision),
  };
}

function eStyleDigits(
  absX: number,
  precision: number,
): { first: string; rest: string; exp: number } {
  if (absX === 0) {
    return { first: '0', rest: '0'.repeat(precision), exp: 0 };
  }
  const { mantissa, exponent } = decompose(absX);
  let exp0 = Math.floor(Math.log10(absX));
  let digitStr = '';
  for (let guard = 0; guard < 50; guard++) {
    const rounded = roundToScale(mantissa, exponent, precision - exp0);
    digitStr = rounded.toString();
    if (digitStr.length > precision + 1) {
      exp0++;
      continue;
    }
    if (digitStr.length < precision + 1) {
      exp0--;
      continue;
    }
    break;
  }
  return { first: digitStr[0], rest: digitStr.slice(1), exp: exp0 };
}

function expSuffix(exp: number, upperE: boolean): string {
  const sign = exp >= 0 ? '+' : '-';
  const digits = Math.abs(exp).toString().padStart(2, '0');
  return (upperE ? 'E' : 'e') + sign + digits;
}

function signOf(isNeg: boolean, plus: boolean, space: boolean): string {
  if (isNeg) return '-';
  if (plus) return '+';
  if (space) return ' ';
  return '';
}

function formatFloatConversion(
  value: number,
  conv: string,
  flags: Flags,
  width: number,
  precisionGiven: number | undefined,
): string {
  const isUpper = conv === 'E' || conv === 'F' || conv === 'G';
  const isNeg = value < 0 || Object.is(value, -0);
  const absX = Math.abs(value);

  if (Number.isNaN(value)) {
    const text = isUpper ? 'NAN' : 'nan';
    return padNumeric(text, '', width, flags.minus, false);
  }
  if (!Number.isFinite(absX)) {
    const text = isUpper ? 'INF' : 'inf';
    const sign = signOf(isNeg, flags.plus, flags.space);
    return padNumeric(text, sign, width, flags.minus, false);
  }

  const sign = signOf(isNeg, flags.plus, flags.space);
  const lower = conv.toLowerCase();

  if (lower === 'f') {
    const precision = precisionGiven === undefined ? 6 : precisionGiven;
    const { intPart, fracPart } = fStyleDigits(absX, precision);
    const main =
      precision === 0
        ? intPart + (flags.hash ? '.' : '')
        : intPart + '.' + fracPart;
    return padNumeric(main, sign, width, flags.minus, flags.zero);
  }

  if (lower === 'e') {
    const precision = precisionGiven === undefined ? 6 : precisionGiven;
    const { first, rest, exp } = eStyleDigits(absX, precision);
    const main =
      (precision === 0
        ? first + (flags.hash ? '.' : '')
        : first + '.' + rest) + expSuffix(exp, isUpper);
    return padNumeric(main, sign, width, flags.minus, flags.zero);
  }

  // g / G
  const P = precisionGiven === undefined ? 6 : precisionGiven === 0 ? 1 : precisionGiven;
  const { first, rest, exp: X } = eStyleDigits(absX, P - 1);
  let main: string;
  if (P > X && X >= -4) {
    const fPrecision = P - 1 - X;
    const { intPart, fracPart } = fStyleDigits(absX, fPrecision);
    if (fPrecision === 0) {
      main = intPart + (flags.hash ? '.' : '');
    } else if (flags.hash) {
      main = intPart + '.' + fracPart;
    } else {
      const trimmed = fracPart.replace(/0+$/, '');
      main = trimmed ? intPart + '.' + trimmed : intPart;
    }
  } else {
    if (P - 1 === 0) {
      main = first + (flags.hash ? '.' : '') + expSuffix(X, isUpper);
    } else if (flags.hash) {
      main = first + '.' + rest + expSuffix(X, isUpper);
    } else {
      const trimmed = rest.replace(/0+$/, '');
      main = (trimmed ? first + '.' + trimmed : first) + expSuffix(X, isUpper);
    }
  }
  return padNumeric(main, sign, width, flags.minus, flags.zero);
}

function toBigIntValue(v: number | bigint): bigint {
  return typeof v === 'bigint' ? v : BigInt(v);
}

function formatIntConversion(
  arg: number | bigint,
  conv: string,
  flags: Flags,
  width: number,
  precisionGiven: number | undefined,
): string {
  const v = toBigIntValue(arg);

  if (conv === 'd' || conv === 'i') {
    const isNeg = v < 0n;
    const magnitude = isNeg ? -v : v;
    let digits = magnitude.toString(10);
    if (precisionGiven !== undefined) {
      if (precisionGiven === 0 && magnitude === 0n) digits = '';
      else if (digits.length < precisionGiven)
        digits = '0'.repeat(precisionGiven - digits.length) + digits;
    }
    const sign = signOf(isNeg, flags.plus, flags.space);
    const zero = flags.zero && precisionGiven === undefined;
    return padNumeric(digits, sign, width, flags.minus, zero);
  }

  // x, X, o
  const base = conv === 'o' ? 8 : 16;
  let digits = v.toString(base);
  if (conv === 'X') digits = digits.toUpperCase();
  if (precisionGiven !== undefined) {
    if (precisionGiven === 0 && v === 0n) digits = '';
    else if (digits.length < precisionGiven)
      digits = '0'.repeat(precisionGiven - digits.length) + digits;
  }
  let prefix = '';
  if (flags.hash) {
    if (conv === 'o') {
      if (digits === '' || digits[0] !== '0') digits = '0' + digits;
    } else if (v !== 0n) {
      prefix = conv === 'X' ? '0X' : '0x';
    }
  }
  const zero = flags.zero && precisionGiven === undefined;
  return padNumeric(prefix + digits, '', width, flags.minus, zero);
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let result = '';
  let argIndex = 0;
  const re = /%([-+0# ]*)(\d*)(\.\d*)?([diouxXeEfFgGsc%])/g;
  let lastEnd = 0;
  let m: RegExpExecArray | null;

  while ((m = re.exec(fmt)) !== null) {
    result += fmt.slice(lastEnd, m.index);
    lastEnd = re.lastIndex;

    const conv = m[4];
    if (conv === '%') {
      result += '%';
      continue;
    }

    const flags = parseFlags(m[1]);
    const width = m[2] ? parseInt(m[2], 10) : 0;
    const precisionGiven =
      m[3] === undefined
        ? undefined
        : m[3].length === 1
        ? 0
        : parseInt(m[3].slice(1), 10);

    const arg = args[argIndex++];

    if (conv === 'd' || conv === 'i' || conv === 'x' || conv === 'X' || conv === 'o') {
      result += formatIntConversion(
        arg as number | bigint,
        conv,
        flags,
        width,
        precisionGiven,
      );
    } else if (
      conv === 'e' ||
      conv === 'E' ||
      conv === 'f' ||
      conv === 'F' ||
      conv === 'g' ||
      conv === 'G'
    ) {
      result += formatFloatConversion(
        arg as number,
        conv,
        flags,
        width,
        precisionGiven,
      );
    } else if (conv === 's') {
      let text = arg as string;
      if (precisionGiven !== undefined) text = text.slice(0, precisionGiven);
      result += padPlain(text, width, flags.minus);
    } else if (conv === 'c') {
      const text = arg as string;
      result += padPlain(text, width, flags.minus);
    }
  }
  result += fmt.slice(lastEnd);
  return result;
}
