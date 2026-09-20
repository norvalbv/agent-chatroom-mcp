type Flags = {
  minus: boolean;
  plus: boolean;
  space: boolean;
  zero: boolean;
  hash: boolean;
};

function getBits(x: number): bigint {
  const buf = new ArrayBuffer(8);
  new Float64Array(buf)[0] = x;
  return new BigUint64Array(buf)[0];
}

// Exact magnitude of a finite double as N * 10^exp10 (N a nonnegative bigint).
function decomposeMagnitude(x: number): { N: bigint; exp10: number } {
  if (x === 0) return { N: 0n, exp10: 0 };
  const bits = getBits(x);
  const expField = (bits >> 52n) & 0x7ffn;
  const mantissaField = bits & 0xfffffffffffffn;
  let M: bigint;
  let E: number;
  if (expField === 0n) {
    M = mantissaField;
    E = -1074;
  } else {
    M = mantissaField | (1n << 52n);
    E = Number(expField) - 1075;
  }
  if (E >= 0) return { N: M << BigInt(E), exp10: 0 };
  const k = -E;
  return { N: M * 5n ** BigInt(k), exp10: -k };
}

// round(N / 10^s) to nearest integer, ties to even.
function roundDiv(N: bigint, s: bigint): bigint {
  if (s === 0n) return N;
  const tenS = 10n ** s;
  const q = N / tenS;
  const r = N % tenS;
  const twice = r * 2n;
  if (twice < tenS) return q;
  if (twice > tenS) return q + 1n;
  return q % 2n === 0n ? q : q + 1n;
}

function toFixedDigits(N: bigint, exp10: number, p: number): { intPart: string; fracPart: string } {
  const shift = exp10 + p;
  let R: bigint;
  if (shift >= 0) R = N * 10n ** BigInt(shift);
  else R = roundDiv(N, BigInt(-shift));
  let Rstr = R.toString();
  if (p === 0) return { intPart: Rstr, fracPart: '' };
  if (Rstr.length <= p) Rstr = Rstr.padStart(p + 1, '0');
  return { intPart: Rstr.slice(0, Rstr.length - p), fracPart: Rstr.slice(Rstr.length - p) };
}

// P significant digits (as a string of length P) and decimal exponent X,
// such that value = digits[0].digits[1:] * 10^X, rounded to P significant digits.
function toExpDigits(N: bigint, exp10: number, P: number): { digits: string; X: number } {
  if (N === 0n) return { digits: '0'.repeat(P), X: 0 };
  const lenN = N.toString().length;
  const rawExp = lenN - 1 + exp10;
  const shift = P - lenN;
  let R: bigint;
  if (shift >= 0) R = N * 10n ** BigInt(shift);
  else R = roundDiv(N, BigInt(-shift));
  let X = rawExp;
  const pow10P = 10n ** BigInt(P);
  if (R === pow10P) {
    R = pow10P / 10n;
    X += 1;
  }
  return { digits: R.toString().padStart(P, '0'), X };
}

// Place a decimal point after position X+1 within a P-digit string.
function placeDecimal(digits: string, X: number): { intPart: string; fracPart: string } {
  const pointPos = X + 1;
  if (pointPos <= 0) {
    return { intPart: '0', fracPart: '0'.repeat(-pointPos) + digits };
  }
  if (pointPos >= digits.length) {
    return { intPart: digits + '0'.repeat(pointPos - digits.length), fracPart: '' };
  }
  return { intPart: digits.slice(0, pointPos), fracPart: digits.slice(pointPos) };
}

function trimTrailingZeros(s: string): string {
  return s.replace(/0+$/, '');
}

function padNumeric(
  sign: string,
  numPrefix: string,
  body: string,
  width: number | undefined,
  flags: Flags,
  zeroAllowed: boolean,
): string {
  const core = sign + numPrefix + body;
  if (width === undefined || core.length >= width) return core;
  const pad = width - core.length;
  if (flags.minus) return core + ' '.repeat(pad);
  if (flags.zero && zeroAllowed) return sign + numPrefix + '0'.repeat(pad) + body;
  return ' '.repeat(pad) + core;
}

function padWidthSpaces(str: string, width: number | undefined, minus: boolean): string {
  if (width === undefined || str.length >= width) return str;
  const pad = width - str.length;
  return minus ? str + ' '.repeat(pad) : ' '.repeat(pad) + str;
}

function toBigIntValue(value: number | bigint): bigint {
  return typeof value === 'bigint' ? value : BigInt(value);
}

function formatIntSpec(flags: Flags, width: number | undefined, precision: number | undefined, value: number | bigint): string {
  const big = toBigIntValue(value);
  const negative = big < 0n;
  const mag = negative ? -big : big;
  let digits = precision === 0 && mag === 0n ? '' : mag.toString();
  if (precision !== undefined && digits.length < precision) digits = digits.padStart(precision, '0');
  const sign = negative ? '-' : flags.plus ? '+' : flags.space ? ' ' : '';
  const zeroAllowed = precision === undefined;
  return padNumeric(sign, '', digits, width, flags, zeroAllowed);
}

function formatRadixSpec(
  conv: 'x' | 'X' | 'o',
  flags: Flags,
  width: number | undefined,
  precision: number | undefined,
  value: number | bigint,
): string {
  const big = toBigIntValue(value);
  const base = conv === 'o' ? 8 : 16;
  let digits = precision === 0 && big === 0n ? '' : big.toString(base);
  if (precision !== undefined && digits.length < precision) digits = digits.padStart(precision, '0');
  if (conv === 'o' && flags.hash) {
    if (!digits.startsWith('0')) digits = '0' + digits;
  }
  let numPrefix = '';
  if ((conv === 'x' || conv === 'X') && flags.hash && big !== 0n) numPrefix = conv === 'x' ? '0x' : '0X';
  if (conv === 'X') digits = digits.toUpperCase();
  const zeroAllowed = precision === undefined;
  return padNumeric('', numPrefix, digits, width, flags, zeroAllowed);
}

function formatFloatSpec(
  conv: 'e' | 'E' | 'f' | 'F' | 'g' | 'G',
  flags: Flags,
  width: number | undefined,
  precision: number | undefined,
  value: number,
): string {
  const upper = conv === 'E' || conv === 'F' || conv === 'G';
  const hash = flags.hash;
  const bits = getBits(value);
  const negative = ((bits >> 63n) & 1n) === 1n;

  if (Number.isNaN(value)) {
    const core = upper ? 'NAN' : 'nan';
    return padNumeric('', '', core, width, flags, false);
  }
  if (!Number.isFinite(value)) {
    const core = upper ? 'INF' : 'inf';
    const sign = negative ? '-' : flags.plus ? '+' : flags.space ? ' ' : '';
    return padNumeric(sign, '', core, width, flags, false);
  }

  const sign = negative ? '-' : flags.plus ? '+' : flags.space ? ' ' : '';
  const { N, exp10 } = decomposeMagnitude(value);
  let body: string;

  if (conv === 'f' || conv === 'F') {
    const precisionVal = precision === undefined ? 6 : precision;
    const { intPart, fracPart } = toFixedDigits(N, exp10, precisionVal);
    body = intPart + (precisionVal > 0 ? '.' + fracPart : hash ? '.' : '');
  } else if (conv === 'e' || conv === 'E') {
    const precisionVal = precision === undefined ? 6 : precision;
    const P = precisionVal + 1;
    const { digits, X } = toExpDigits(N, exp10, P);
    const mantissa = digits[0] + (precisionVal > 0 ? '.' + digits.slice(1) : hash ? '.' : '');
    const expSign = X < 0 ? '-' : '+';
    const expDigits = Math.abs(X).toString().padStart(2, '0');
    body = mantissa + (upper ? 'E' : 'e') + expSign + expDigits;
  } else {
    const P = precision === undefined ? 6 : precision === 0 ? 1 : precision;
    const { digits, X } = toExpDigits(N, exp10, P);
    if (P > X && X >= -4) {
      const { intPart, fracPart } = placeDecimal(digits, X);
      const frac = hash ? fracPart : trimTrailingZeros(fracPart);
      body = intPart + (frac.length > 0 ? '.' + frac : hash ? '.' : '');
    } else {
      const fracDigitsRaw = digits.slice(1);
      const fracDigits = hash ? fracDigitsRaw : trimTrailingZeros(fracDigitsRaw);
      const mantissa = digits[0] + (fracDigits.length > 0 ? '.' + fracDigits : hash ? '.' : '');
      const expSign = X < 0 ? '-' : '+';
      const expDigits = Math.abs(X).toString().padStart(2, '0');
      body = mantissa + (upper ? 'E' : 'e') + expSign + expDigits;
    }
  }

  return padNumeric(sign, '', body, width, flags, true);
}

function formatStrSpec(flags: Flags, width: number | undefined, precision: number | undefined, value: string): string {
  const body = precision !== undefined ? value.slice(0, precision) : value;
  return padWidthSpaces(body, width, flags.minus);
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
    if (fmt[i + 1] === '%') {
      result += '%';
      i += 2;
      continue;
    }
    i++; // skip '%'

    const flags: Flags = { minus: false, plus: false, space: false, zero: false, hash: false };
    while (i < n && '-+0 #'.includes(fmt[i])) {
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
    const width = widthStr.length ? parseInt(widthStr, 10) : undefined;

    let precision: number | undefined = undefined;
    if (i < n && fmt[i] === '.') {
      i++;
      let precStr = '';
      while (i < n && fmt[i] >= '0' && fmt[i] <= '9') {
        precStr += fmt[i];
        i++;
      }
      precision = precStr.length ? parseInt(precStr, 10) : 0;
    }

    const conv = fmt[i];
    i++;
    const arg = args[argIndex++];

    switch (conv) {
      case 'd':
      case 'i':
        result += formatIntSpec(flags, width, precision, arg as number | bigint);
        break;
      case 'x':
      case 'X':
      case 'o':
        result += formatRadixSpec(conv, flags, width, precision, arg as number | bigint);
        break;
      case 'e':
      case 'E':
      case 'f':
      case 'F':
      case 'g':
      case 'G':
        result += formatFloatSpec(conv, flags, width, precision, arg as number);
        break;
      case 's':
        result += formatStrSpec(flags, width, precision, arg as string);
        break;
      case 'c':
        result += padWidthSpaces(arg as string, width, flags.minus);
        break;
    }
  }

  return result;
}
