type Flags = {
  minus: boolean;
  plus: boolean;
  space: boolean;
  zero: boolean;
  hash: boolean;
};

function signPrefix(negative: boolean, flags: Flags): string {
  if (negative) return '-';
  if (flags.plus) return '+';
  if (flags.space) return ' ';
  return '';
}

function padNumber(prefix: string, body: string, width: number, leftAlign: boolean, zeroFlag: boolean): string {
  const total = prefix.length + body.length;
  if (total >= width) return prefix + body;
  const padLen = width - total;
  if (leftAlign) return prefix + body + ' '.repeat(padLen);
  if (zeroFlag) return prefix + '0'.repeat(padLen) + body;
  return ' '.repeat(padLen) + prefix + body;
}

function padText(s: string, width: number, leftAlign: boolean): string {
  if (s.length >= width) return s;
  const padLen = width - s.length;
  return leftAlign ? s + ' '.repeat(padLen) : ' '.repeat(padLen) + s;
}

function toBigInt(v: number | bigint): bigint {
  return typeof v === 'bigint' ? v : BigInt(v);
}

// Exact decomposition of a finite non-negative double into mantissa * 2^exp.
function bitsOf(x: number): { exponent: number; mantissa: bigint } {
  const buf = new ArrayBuffer(8);
  const view = new DataView(buf);
  view.setFloat64(0, x);
  const hi = view.getUint32(0);
  const lo = view.getUint32(4);
  const exponent = (hi >>> 20) & 0x7ff;
  const mantissa = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  return { exponent, mantissa };
}

// Exact decimal digits of a finite non-negative double (binary fractions terminate in decimal).
function exactParts(absX: number): { intPart: string; fracPart: string } {
  if (absX === 0) return { intPart: '0', fracPart: '' };
  const { exponent: rawExp, mantissa: rawMantissa } = bitsOf(absX);
  let mantissa = rawMantissa;
  let exp: number;
  if (rawExp === 0) {
    exp = 1 - 1023 - 52;
  } else {
    mantissa = mantissa | (1n << 52n);
    exp = rawExp - 1023 - 52;
  }
  if (exp >= 0) {
    const intVal = mantissa << BigInt(exp);
    return { intPart: intVal.toString(), fracPart: '' };
  }
  const n = -exp;
  const numerator = mantissa * 5n ** BigInt(n);
  let s = numerator.toString();
  if (s.length <= n) s = s.padStart(n + 1, '0');
  return { intPart: s.slice(0, s.length - n), fracPart: s.slice(s.length - n) };
}

// Round intPart.fracPart to exactly k fractional digits, ties-to-even (exact, since fracPart is exact).
function roundFraction(intPart: string, fracPart: string, k: number): { intPart: string; fracPart: string } {
  if (k >= fracPart.length) {
    return { intPart, fracPart: fracPart.padEnd(k, '0') };
  }
  const keep = fracPart.slice(0, k);
  const rest = fracPart.slice(k);
  let roundUp: boolean;
  const firstDropped = rest[0];
  if (firstDropped > '5') roundUp = true;
  else if (firstDropped < '5') roundUp = false;
  else if (/[1-9]/.test(rest.slice(1))) roundUp = true;
  else {
    const lastKept = k > 0 ? keep[k - 1] : intPart[intPart.length - 1] ?? '0';
    roundUp = parseInt(lastKept, 10) % 2 === 1;
  }
  let combined = intPart + keep;
  if (roundUp) {
    combined = (BigInt(combined === '' ? '0' : combined) + 1n).toString();
  }
  if (combined.length < k) combined = combined.padStart(k, '0');
  const newFrac = k > 0 ? combined.slice(combined.length - k) : '';
  const newInt = k > 0 ? combined.slice(0, combined.length - k) || '0' : combined;
  return { intPart: newInt, fracPart: newFrac };
}

// Round a significant-digit string to `digitsWanted` digits, ties-to-even (exact).
function roundSignificant(sig: string, digitsWanted: number): { digits: string; exponentShift: number } {
  if (digitsWanted >= sig.length) {
    return { digits: sig.padEnd(digitsWanted, '0'), exponentShift: 0 };
  }
  const keep = sig.slice(0, digitsWanted);
  const rest = sig.slice(digitsWanted);
  let roundUp: boolean;
  const firstDropped = rest[0];
  if (firstDropped > '5') roundUp = true;
  else if (firstDropped < '5') roundUp = false;
  else if (/[1-9]/.test(rest.slice(1))) roundUp = true;
  else roundUp = parseInt(keep[keep.length - 1], 10) % 2 === 1;

  if (!roundUp) return { digits: keep, exponentShift: 0 };
  const big = (BigInt(keep) + 1n).toString();
  if (big.length > keep.length) {
    return { digits: big.slice(0, digitsWanted), exponentShift: 1 };
  }
  return { digits: big.padStart(digitsWanted, '0'), exponentShift: 0 };
}

function toExponentialParts(absValue: number, precision: number): { digits: string; exponent: number } {
  if (absValue === 0) {
    return { digits: '0'.repeat(precision + 1), exponent: 0 };
  }
  const { intPart, fracPart } = exactParts(absValue);
  const full = intPart + fracPart;
  const dp = intPart.length;
  const firstNonZero = full.search(/[1-9]/);
  const sig = full.slice(firstNonZero);
  const exponentBase = dp - 1 - firstNonZero;
  const { digits, exponentShift } = roundSignificant(sig, precision + 1);
  return { digits, exponent: exponentBase + exponentShift };
}

function isNegativeValue(x: number): boolean {
  if (Number.isNaN(x)) return false;
  return x < 0 || Object.is(x, -0);
}

function fmtDI(v: number | bigint, flags: Flags, width: number, precision: number | undefined): string {
  const value = toBigInt(v);
  const negative = value < 0n;
  const abs = negative ? -value : value;
  let digits = abs.toString(10);
  if (precision !== undefined) {
    digits = precision === 0 && abs === 0n ? '' : digits.padStart(precision, '0');
  }
  const prefix = signPrefix(negative, flags);
  const zero = flags.zero && !flags.minus && precision === undefined;
  return padNumber(prefix, digits, width, flags.minus, zero);
}

function fmtHexOct(v: number | bigint, base: 8 | 16, upper: boolean, flags: Flags, width: number, precision: number | undefined): string {
  const abs = toBigInt(v);
  let digits = abs.toString(base);
  if (precision !== undefined) {
    digits = precision === 0 && abs === 0n ? '' : digits.padStart(precision, '0');
  }
  if (base === 8 && flags.hash) {
    if (digits.length === 0 || digits[0] !== '0') digits = '0' + digits;
  }
  let prefix = '';
  if (base === 16 && flags.hash && abs !== 0n) {
    prefix = upper ? '0X' : '0x';
  }
  if (upper) digits = digits.toUpperCase();
  const zero = flags.zero && !flags.minus && precision === undefined;
  return padNumber(prefix, digits, width, flags.minus, zero);
}

function fmtF(x: number, upper: boolean, flags: Flags, width: number, precision0: number | undefined): string {
  const precision = precision0 === undefined ? 6 : precision0;
  if (Number.isNaN(x)) {
    return padNumber('', upper ? 'NAN' : 'nan', width, flags.minus, false);
  }
  const negative = isNegativeValue(x);
  const sign = signPrefix(negative, flags);
  if (!Number.isFinite(x)) {
    return padNumber(sign, upper ? 'INF' : 'inf', width, flags.minus, false);
  }
  const abs = Math.abs(x);
  const { intPart, fracPart } = exactParts(abs);
  const { intPart: ri, fracPart: rf } = roundFraction(intPart, fracPart, precision);
  const dot = rf.length > 0 || flags.hash ? '.' : '';
  const body = ri + dot + rf;
  const zero = flags.zero && !flags.minus;
  return padNumber(sign, body, width, flags.minus, zero);
}

function fmtE(x: number, upper: boolean, flags: Flags, width: number, precision0: number | undefined): string {
  const precision = precision0 === undefined ? 6 : precision0;
  if (Number.isNaN(x)) {
    return padNumber('', upper ? 'NAN' : 'nan', width, flags.minus, false);
  }
  const negative = isNegativeValue(x);
  const sign = signPrefix(negative, flags);
  if (!Number.isFinite(x)) {
    return padNumber(sign, upper ? 'INF' : 'inf', width, flags.minus, false);
  }
  const abs = Math.abs(x);
  const { digits, exponent } = toExponentialParts(abs, precision);
  const fracDigits = digits.slice(1);
  const dot = fracDigits.length > 0 || flags.hash ? '.' : '';
  const expSign = exponent < 0 ? '-' : '+';
  const expDigits = Math.abs(exponent).toString().padStart(2, '0');
  const body = digits[0] + dot + fracDigits + (upper ? 'E' : 'e') + expSign + expDigits;
  const zero = flags.zero && !flags.minus;
  return padNumber(sign, body, width, flags.minus, zero);
}

function fmtG(x: number, upper: boolean, flags: Flags, width: number, precision0: number | undefined): string {
  let P = precision0 === undefined ? 6 : precision0;
  if (P === 0) P = 1;
  if (Number.isNaN(x)) {
    return padNumber('', upper ? 'NAN' : 'nan', width, flags.minus, false);
  }
  const negative = isNegativeValue(x);
  const sign = signPrefix(negative, flags);
  if (!Number.isFinite(x)) {
    return padNumber(sign, upper ? 'INF' : 'inf', width, flags.minus, false);
  }
  const abs = Math.abs(x);
  const { digits, exponent: X } = toExponentialParts(abs, P - 1);
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
    if (!flags.hash) fracPart = fracPart.replace(/0+$/, '');
    const dot = fracPart.length > 0 || flags.hash ? '.' : '';
    body = intPart + dot + fracPart;
  } else {
    let fracDigits = digits.slice(1);
    if (!flags.hash) fracDigits = fracDigits.replace(/0+$/, '');
    const dot = fracDigits.length > 0 || flags.hash ? '.' : '';
    const expSign = X < 0 ? '-' : '+';
    const expDigits = Math.abs(X).toString().padStart(2, '0');
    body = digits[0] + dot + fracDigits + (upper ? 'E' : 'e') + expSign + expDigits;
  }
  const zero = flags.zero && !flags.minus;
  return padNumber(sign, body, width, flags.minus, zero);
}

function fmtS(v: string, flags: Flags, width: number, precision: number | undefined): string {
  let s = String(v);
  if (precision !== undefined) s = s.slice(0, precision);
  return padText(s, width, flags.minus);
}

function fmtC(v: string, flags: Flags, width: number): string {
  return padText(String(v), width, flags.minus);
}

function convert(
  conv: string,
  arg: number | bigint | string,
  flags: Flags,
  width: number,
  precision: number | undefined,
): string {
  switch (conv) {
    case 'd':
    case 'i':
      return fmtDI(arg as number | bigint, flags, width, precision);
    case 'x':
      return fmtHexOct(arg as number | bigint, 16, false, flags, width, precision);
    case 'X':
      return fmtHexOct(arg as number | bigint, 16, true, flags, width, precision);
    case 'o':
      return fmtHexOct(arg as number | bigint, 8, false, flags, width, precision);
    case 'e':
      return fmtE(arg as number, false, flags, width, precision);
    case 'E':
      return fmtE(arg as number, true, flags, width, precision);
    case 'f':
      return fmtF(arg as number, false, flags, width, precision);
    case 'F':
      return fmtF(arg as number, true, flags, width, precision);
    case 'g':
      return fmtG(arg as number, false, flags, width, precision);
    case 'G':
      return fmtG(arg as number, true, flags, width, precision);
    case 's':
      return fmtS(arg as string, flags, width, precision);
    case 'c':
      return fmtC(arg as string, flags, width);
    default:
      throw new Error(`Unsupported conversion: ${conv}`);
  }
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  const re = /%([-+0# ]*)(\d*)(?:\.(\d*))?(.)/g;
  let result = '';
  let lastIndex = 0;
  let argIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(fmt)) !== null) {
    result += fmt.slice(lastIndex, match.index);
    lastIndex = re.lastIndex;
    const [, flagsStr, widthStr, precStr, conv] = match;
    if (conv === '%') {
      result += '%';
      continue;
    }
    const flags: Flags = {
      minus: flagsStr.includes('-'),
      plus: flagsStr.includes('+'),
      space: flagsStr.includes(' '),
      zero: flagsStr.includes('0'),
      hash: flagsStr.includes('#'),
    };
    const width = widthStr ? parseInt(widthStr, 10) : 0;
    const precision = precStr !== undefined ? (precStr === '' ? 0 : parseInt(precStr, 10)) : undefined;
    const arg = args[argIndex++];
    result += convert(conv, arg, flags, width, precision);
  }
  result += fmt.slice(lastIndex);
  return result;
}
