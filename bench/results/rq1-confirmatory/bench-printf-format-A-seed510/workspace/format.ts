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

function applyWidth(str: string, width: number | undefined, minus: boolean): string {
  if (width === undefined || str.length >= width) return str;
  return minus ? str.padEnd(width) : str.padStart(width);
}

// Compose sign + prefix + rest, padding with spaces or (if useZero) zeros inserted
// right after sign+prefix.
function composeNumeric(
  sign: string,
  prefix: string,
  rest: string,
  width: number | undefined,
  useZero: boolean,
  minus: boolean,
): string {
  let body = sign + prefix + rest;
  if (width !== undefined && body.length < width) {
    if (useZero && !minus) {
      rest = '0'.repeat(width - body.length) + rest;
      body = sign + prefix + rest;
    } else {
      body = minus ? body.padEnd(width) : body.padStart(width);
    }
  }
  return body;
}

function computeSign(isNegative: boolean, flags: Flags): string {
  if (isNegative) return '-';
  if (flags.plus) return '+';
  if (flags.space) return ' ';
  return '';
}

// --- exact decimal decomposition of a finite double ---

function decomposeAbs(absValue: number): { D: bigint; n: number } {
  if (absValue === 0) return { D: 0n, n: 0 };
  const buf = new ArrayBuffer(8);
  const dv = new DataView(buf);
  dv.setFloat64(0, absValue);
  const bits = dv.getBigUint64(0);
  const expBits = Number((bits >> 52n) & 0x7ffn);
  const mantissaBits = bits & 0xfffffffffffffn;
  let mantissa: bigint;
  let exp: number;
  if (expBits === 0) {
    mantissa = mantissaBits;
    exp = -1074;
  } else {
    mantissa = mantissaBits | (1n << 52n);
    exp = expBits - 1023 - 52;
  }
  let numerator: bigint;
  let n: number;
  if (exp >= 0) {
    numerator = mantissa << BigInt(exp);
    n = 0;
  } else {
    numerator = mantissa;
    n = -exp;
  }
  const D = numerator * 5n ** BigInt(n);
  return { D, n };
}

function divRoundHalfEven(D: bigint, k: number): bigint {
  if (k <= 0) return D;
  const divisor = 10n ** BigInt(k);
  const q = D / divisor;
  const r = D % divisor;
  const twice = r * 2n;
  if (twice > divisor) return q + 1n;
  if (twice < divisor) return q;
  return q % 2n === 0n ? q : q + 1n;
}

// digits representing round(value * 10^p) as a non-negative integer string
function fixedDigits(D: bigint, n: number, p: number): string {
  if (p >= n) {
    return (D * 10n ** BigInt(p - n)).toString();
  }
  const k = n - p;
  return divRoundHalfEven(D, k).toString();
}

function buildFixedParts(D: bigint, n: number, p: number): { intPart: string; fracPart: string } {
  const digitsStr = fixedDigits(D, n, p);
  if (p === 0) return { intPart: digitsStr, fracPart: '' };
  const padded = digitsStr.padStart(p + 1, '0');
  return { intPart: padded.slice(0, padded.length - p), fracPart: padded.slice(padded.length - p) };
}

// round D (with D * 10^-n == value) to S significant digits, half-even
function sigDigits(D: bigint, n: number, S: number): { digits: string; X: number } {
  if (D === 0n) return { digits: '0'.repeat(S), X: 0 };
  const digitsStr0 = D.toString();
  const L = digitsStr0.length;
  let X = L - 1 - n;
  let digitsStr: string;
  if (S >= L) {
    digitsStr = digitsStr0 + '0'.repeat(S - L);
  } else {
    const k = L - S;
    let qStr = divRoundHalfEven(D, k).toString();
    if (qStr.length > S) {
      X += qStr.length - S;
      qStr = qStr.slice(0, S);
    }
    digitsStr = qStr;
  }
  return { digits: digitsStr, X };
}

function stripTrailingZeros(frac: string): string {
  return frac.replace(/0+$/, '');
}

function isNegativeValue(v: number): boolean {
  return v < 0 || Object.is(v, -0);
}

function expString(x: number): string {
  const s = x < 0 ? '-' : '+';
  const abs = Math.abs(x).toString().padStart(2, '0');
  return s + abs;
}

function formatFloat(
  value: number,
  conv: string,
  flags: Flags,
  width: number | undefined,
  precision: number | undefined,
): string {
  const upper = conv === 'E' || conv === 'F' || conv === 'G';

  if (Number.isNaN(value)) {
    const text = upper ? 'NAN' : 'nan';
    return applyWidth(text, width, flags.minus);
  }

  const neg = isNegativeValue(value);
  const sign = computeSign(neg, flags);

  if (!Number.isFinite(value)) {
    const text = upper ? 'INF' : 'inf';
    return applyWidth(sign + text, width, flags.minus);
  }

  const abs = Math.abs(value);
  const { D, n } = decomposeAbs(abs);
  const useZero = flags.zero;

  if (conv === 'f' || conv === 'F') {
    const p = precision === undefined ? 6 : precision;
    const { intPart, fracPart } = buildFixedParts(D, n, p);
    const rest = intPart + (p > 0 ? '.' + fracPart : flags.hash ? '.' : '');
    return composeNumeric(sign, '', rest, width, useZero, flags.minus);
  }

  if (conv === 'e' || conv === 'E') {
    const p = precision === undefined ? 6 : precision;
    const { digits, X } = sigDigits(D, n, p + 1);
    const frac = digits.slice(1);
    const mantissa = digits[0] + (p > 0 ? '.' + frac : flags.hash ? '.' : '');
    const rest = mantissa + (upper ? 'E' : 'e') + expString(X);
    return composeNumeric(sign, '', rest, width, useZero, flags.minus);
  }

  // g / G
  let P = precision === undefined ? 6 : precision === 0 ? 1 : precision;
  const { digits, X } = sigDigits(D, n, P);
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
    if (!flags.hash) fracPart = stripTrailingZeros(fracPart);
    rest = intPart + (fracPart.length > 0 ? '.' + fracPart : flags.hash ? '.' : '');
  } else {
    let fracPart = digits.slice(1);
    if (!flags.hash) fracPart = stripTrailingZeros(fracPart);
    const mantissa = digits[0] + (fracPart.length > 0 ? '.' + fracPart : flags.hash ? '.' : '');
    rest = mantissa + (upper ? 'E' : 'e') + expString(X);
  }
  return composeNumeric(sign, '', rest, width, useZero, flags.minus);
}

function toBigIntValue(v: number | bigint): bigint {
  return typeof v === 'bigint' ? v : BigInt(v);
}

function formatDecimal(
  value: number | bigint,
  flags: Flags,
  width: number | undefined,
  precision: number | undefined,
): string {
  const big = toBigIntValue(value);
  const neg = big < 0n;
  const mag = neg ? -big : big;
  let digits: string;
  if (precision !== undefined) {
    if (precision === 0 && mag === 0n) {
      digits = '';
    } else {
      digits = mag.toString().padStart(precision, '0');
    }
  } else {
    digits = mag.toString();
  }
  const sign = computeSign(neg, flags);
  const useZero = flags.zero && precision === undefined;
  return composeNumeric(sign, '', digits, width, useZero, flags.minus);
}

function formatHexOctal(
  value: number | bigint,
  conv: string,
  flags: Flags,
  width: number | undefined,
  precision: number | undefined,
): string {
  const mag = toBigIntValue(value);
  const base = conv === 'o' ? 8 : 16;
  let digits: string;
  if (precision !== undefined) {
    if (precision === 0 && mag === 0n) {
      digits = '';
    } else {
      digits = mag.toString(base).padStart(precision, '0');
    }
  } else {
    digits = mag.toString(base);
  }
  if (conv === 'X') digits = digits.toUpperCase();

  let prefix = '';
  if (flags.hash) {
    if (conv === 'o') {
      if (digits.length === 0 || digits[0] !== '0') digits = '0' + digits;
    } else if (mag !== 0n) {
      prefix = conv === 'X' ? '0X' : '0x';
    }
  }

  const useZero = flags.zero && precision === undefined;
  return composeNumeric('', prefix, digits, width, useZero, flags.minus);
}

const SPEC_RE = /%([-+ 0#]*)(\d*)(?:\.(\d*))?([diouxXeEfFgGsc%])/g;

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let result = '';
  let lastIndex = 0;
  let argIdx = 0;
  SPEC_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = SPEC_RE.exec(fmt)) !== null) {
    result += fmt.slice(lastIndex, match.index);
    lastIndex = SPEC_RE.lastIndex;

    const conv = match[4];
    if (conv === '%') {
      result += '%';
      continue;
    }

    const flags = parseFlags(match[1]);
    const widthStr = match[2];
    const width = widthStr === '' ? undefined : parseInt(widthStr, 10);
    const precGroup = match[3];
    const precision = precGroup === undefined ? undefined : precGroup === '' ? 0 : parseInt(precGroup, 10);

    const arg = args[argIdx++];

    if (conv === 'd' || conv === 'i') {
      result += formatDecimal(arg as number | bigint, flags, width, precision);
    } else if (conv === 'x' || conv === 'X' || conv === 'o') {
      result += formatHexOctal(arg as number | bigint, conv, flags, width, precision);
    } else if (conv === 'e' || conv === 'E' || conv === 'f' || conv === 'F' || conv === 'g' || conv === 'G') {
      result += formatFloat(arg as number, conv, flags, width, precision);
    } else if (conv === 's') {
      let text = String(arg);
      if (precision !== undefined) text = text.slice(0, precision);
      result += applyWidth(text, width, flags.minus);
    } else if (conv === 'c') {
      const text = String(arg);
      result += applyWidth(text, width, flags.minus);
    }
  }
  result += fmt.slice(lastIndex);
  return result;
}
