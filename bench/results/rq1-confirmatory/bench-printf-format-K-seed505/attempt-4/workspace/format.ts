interface Flags {
  minus: boolean;
  plus: boolean;
  space: boolean;
  zero: boolean;
  hash: boolean;
}

function parseFlags(s: string): Flags {
  return {
    minus: s.includes('-'),
    plus: s.includes('+'),
    space: s.includes(' '),
    zero: s.includes('0'),
    hash: s.includes('#'),
  };
}

function padNumber(
  sign: string,
  prefix: string,
  digits: string,
  width: number,
  zeroFlag: boolean,
  minusFlag: boolean
): string {
  const content = sign + prefix + digits;
  if (content.length >= width) return content;
  const padLen = width - content.length;
  if (minusFlag) return content + ' '.repeat(padLen);
  if (zeroFlag) return sign + prefix + '0'.repeat(padLen) + digits;
  return ' '.repeat(padLen) + content;
}

// Decompose a positive finite double x into mantissa (BigInt) and exponent
// such that x === mantissa * 2^exponent, exactly.
function decompose(x: number): { mantissa: bigint; exponent: number } {
  const buf = new ArrayBuffer(8);
  const dv = new DataView(buf);
  dv.setFloat64(0, x);
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const expBits = (hi >>> 20) & 0x7ff;
  const mantHi = hi & 0xfffff;
  const mantissaBits = (BigInt(mantHi) << 32n) | BigInt(lo >>> 0);
  if (expBits === 0) {
    return { mantissa: mantissaBits, exponent: -1074 };
  }
  return { mantissa: mantissaBits | (1n << 52n), exponent: expBits - 1075 };
}

// Compute round(mantissa * 2^exponent * 10^s) to the nearest integer,
// ties rounding to even, using exact arithmetic.
function roundScaled(mantissa: bigint, exponent: number, s: number): bigint {
  const numerator =
    mantissa * 2n ** BigInt(Math.max(exponent, 0)) * 10n ** BigInt(Math.max(s, 0));
  const denominator =
    2n ** BigInt(Math.max(-exponent, 0)) * 10n ** BigInt(Math.max(-s, 0));
  let q = numerator / denominator;
  const r = numerator % denominator;
  const twice = r * 2n;
  if (twice > denominator) {
    q += 1n;
  } else if (twice === denominator && q % 2n !== 0n) {
    q += 1n;
  }
  return q;
}

// Compute P significant decimal digits of mantissa * 2^exponent (> 0),
// rounded to nearest/even, along with the decimal exponent of the leading digit.
function computeSig(
  mantissa: bigint,
  exponent: number,
  P: number,
  absX: number
): { digits: string; exp: number } {
  if (mantissa === 0n) return { digits: '0'.repeat(P), exp: 0 };
  let X = Math.floor(Math.log10(absX));
  let digits = '';
  for (let iter = 0; iter < 30; iter++) {
    const s = P - 1 - X;
    const R = roundScaled(mantissa, exponent, s);
    digits = R.toString();
    if (digits.length === P) break;
    if (digits.length > P) {
      X += digits.length - P;
    } else {
      X -= P - digits.length;
    }
  }
  return { digits, exp: X };
}

function formatInt(flags: Flags, width: number, precision: number | null, arg: number | bigint): string {
  let neg: boolean;
  let mag: bigint;
  if (typeof arg === 'bigint') {
    neg = arg < 0n;
    mag = neg ? -arg : arg;
  } else {
    neg = arg < 0;
    mag = BigInt(Math.trunc(Math.abs(arg)));
  }
  let digits: string;
  if (precision !== null) {
    digits = precision === 0 && mag === 0n ? '' : mag.toString().padStart(precision, '0');
  } else {
    digits = mag.toString();
  }
  const sign = neg ? '-' : flags.plus ? '+' : flags.space ? ' ' : '';
  const zeroFlag = flags.zero && !flags.minus && precision === null;
  return padNumber(sign, '', digits, width, zeroFlag, flags.minus);
}

function formatUint(
  conv: string,
  flags: Flags,
  width: number,
  precision: number | null,
  arg: number | bigint
): string {
  const mag: bigint = typeof arg === 'bigint' ? arg : BigInt(Math.trunc(arg));
  const base = conv === 'o' ? 8 : 16;
  let digits = mag.toString(base);
  if (conv === 'X') digits = digits.toUpperCase();
  if (precision !== null) {
    digits = precision === 0 && mag === 0n ? '' : digits.padStart(precision, '0');
  }
  let prefix = '';
  if (flags.hash) {
    if (conv === 'o') {
      if (digits === '' || digits[0] !== '0') digits = '0' + digits;
    } else if (mag !== 0n) {
      prefix = conv === 'X' ? '0X' : '0x';
    }
  }
  const zeroFlag = flags.zero && !flags.minus && precision === null;
  return padNumber('', prefix, digits, width, zeroFlag, flags.minus);
}

function formatFixed(conv: string, flags: Flags, width: number, precision: number | null, x: number): string {
  const upper = conv === 'F';
  if (Number.isNaN(x)) {
    return padNumber('', '', upper ? 'NAN' : 'nan', width, false, flags.minus);
  }
  const negative = x < 0 || Object.is(x, -0);
  const sign = negative ? '-' : flags.plus ? '+' : flags.space ? ' ' : '';
  if (!Number.isFinite(x)) {
    return padNumber(sign, '', upper ? 'INF' : 'inf', width, false, flags.minus);
  }
  const p = precision === null ? 6 : precision;
  const absX = Math.abs(x);
  const { mantissa, exponent } = absX === 0 ? { mantissa: 0n, exponent: 0 } : decompose(absX);
  const R = roundScaled(mantissa, exponent, p);
  const rs = R.toString().padStart(p + 1, '0');
  const intPart = rs.slice(0, rs.length - p);
  const fracPart = p > 0 ? rs.slice(rs.length - p) : '';
  const digits = p > 0 ? intPart + '.' + fracPart : intPart + (flags.hash ? '.' : '');
  const zeroFlag = flags.zero && !flags.minus;
  return padNumber(sign, '', digits, width, zeroFlag, flags.minus);
}

function formatExp(conv: string, flags: Flags, width: number, precision: number | null, x: number): string {
  const upper = conv === 'E';
  if (Number.isNaN(x)) {
    return padNumber('', '', upper ? 'NAN' : 'nan', width, false, flags.minus);
  }
  const negative = x < 0 || Object.is(x, -0);
  const sign = negative ? '-' : flags.plus ? '+' : flags.space ? ' ' : '';
  if (!Number.isFinite(x)) {
    return padNumber(sign, '', upper ? 'INF' : 'inf', width, false, flags.minus);
  }
  const p = precision === null ? 6 : precision;
  const P = p + 1;
  const absX = Math.abs(x);
  let digitsStr: string;
  let X: number;
  if (absX === 0) {
    digitsStr = '0'.repeat(P);
    X = 0;
  } else {
    const { mantissa, exponent } = decompose(absX);
    const res = computeSig(mantissa, exponent, P, absX);
    digitsStr = res.digits;
    X = res.exp;
  }
  const first = digitsStr[0];
  const rest = digitsStr.slice(1);
  const mantissaStr = first + (p > 0 || flags.hash ? '.' + rest : '');
  const expSign = X < 0 ? '-' : '+';
  const expDigits = Math.abs(X).toString().padStart(2, '0');
  const letter = upper ? 'E' : 'e';
  const digits = mantissaStr + letter + expSign + expDigits;
  const zeroFlag = flags.zero && !flags.minus;
  return padNumber(sign, '', digits, width, zeroFlag, flags.minus);
}

function formatGeneral(conv: string, flags: Flags, width: number, precision: number | null, x: number): string {
  const upper = conv === 'G';
  if (Number.isNaN(x)) {
    return padNumber('', '', upper ? 'NAN' : 'nan', width, false, flags.minus);
  }
  const negative = x < 0 || Object.is(x, -0);
  const sign = negative ? '-' : flags.plus ? '+' : flags.space ? ' ' : '';
  if (!Number.isFinite(x)) {
    return padNumber(sign, '', upper ? 'INF' : 'inf', width, false, flags.minus);
  }
  const P = precision === null ? 6 : precision === 0 ? 1 : precision;
  const absX = Math.abs(x);
  let digitsStr: string;
  let X: number;
  if (absX === 0) {
    digitsStr = '0'.repeat(P);
    X = 0;
  } else {
    const { mantissa, exponent } = decompose(absX);
    const res = computeSig(mantissa, exponent, P, absX);
    digitsStr = res.digits;
    X = res.exp;
  }
  let body: string;
  if (P > X && X >= -4) {
    let intPart: string;
    let fracPart: string;
    if (X >= 0) {
      intPart = digitsStr.slice(0, X + 1);
      fracPart = digitsStr.slice(X + 1);
    } else {
      intPart = '0';
      fracPart = '0'.repeat(-X - 1) + digitsStr;
    }
    if (flags.hash) {
      body = intPart + '.' + fracPart;
    } else {
      const f = fracPart.replace(/0+$/, '');
      body = f.length > 0 ? intPart + '.' + f : intPart;
    }
  } else {
    const first = digitsStr[0];
    const rest = digitsStr.slice(1);
    let mantissaStr: string;
    if (flags.hash) {
      mantissaStr = first + '.' + rest;
    } else {
      const r = rest.replace(/0+$/, '');
      mantissaStr = r.length > 0 ? first + '.' + r : first;
    }
    const expSign = X < 0 ? '-' : '+';
    const expDigits = Math.abs(X).toString().padStart(2, '0');
    body = mantissaStr + (upper ? 'E' : 'e') + expSign + expDigits;
  }
  const zeroFlag = flags.zero && !flags.minus;
  return padNumber(sign, '', body, width, zeroFlag, flags.minus);
}

function formatString(flags: Flags, width: number, precision: number | null, arg: string): string {
  const str = precision !== null ? arg.slice(0, precision) : arg;
  return padNumber('', '', str, width, false, flags.minus);
}

function formatChar(flags: Flags, width: number, arg: string): string {
  return padNumber('', '', arg, width, false, flags.minus);
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
      return formatInt(flags, width, precision, arg as number | bigint);
    case 'x':
    case 'X':
    case 'o':
      return formatUint(conv, flags, width, precision, arg as number | bigint);
    case 'e':
    case 'E':
      return formatExp(conv, flags, width, precision, arg as number);
    case 'f':
    case 'F':
      return formatFixed(conv, flags, width, precision, arg as number);
    case 'g':
    case 'G':
      return formatGeneral(conv, flags, width, precision, arg as number);
    case 's':
      return formatString(flags, width, precision, arg as string);
    case 'c':
      return formatChar(flags, width, arg as string);
    default:
      throw new Error(`unsupported conversion: ${conv}`);
  }
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let result = '';
  let argIndex = 0;
  const re = /%([-+ 0#]*)(\d*)(?:\.(\d*))?([diouxXeEfFgGsc%])/g;
  let lastEnd = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(fmt)) !== null) {
    result += fmt.slice(lastEnd, m.index);
    lastEnd = re.lastIndex;
    const [, flagsStr, widthStr, precStr, conv] = m;
    if (conv === '%') {
      result += '%';
      continue;
    }
    const flags = parseFlags(flagsStr);
    const width = widthStr === '' ? 0 : parseInt(widthStr, 10);
    const precision = precStr === undefined ? null : precStr === '' ? 0 : parseInt(precStr, 10);
    const arg = args[argIndex++];
    result += formatOne(conv, flags, width, precision, arg);
  }
  result += fmt.slice(lastEnd);
  return result;
}
