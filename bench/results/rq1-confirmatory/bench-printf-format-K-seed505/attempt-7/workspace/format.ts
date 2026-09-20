// Exact-rounding printf-style formatter. All rounding for floating point
// conversions is performed on the exact binary value of the double using
// BigInt arithmetic (round-half-to-even), never via built-in toFixed/toPrecision.

interface Flags {
  minus: boolean;
  plus: boolean;
  space: boolean;
  zero: boolean;
  hash: boolean;
}

function decompose(x: number): { M: bigint; E: number } {
  const buf = new ArrayBuffer(8);
  const view = new DataView(buf);
  view.setFloat64(0, x);
  const bits = view.getBigUint64(0);
  const expBits = Number((bits >> 52n) & 0x7ffn);
  const mantissaBits = bits & 0xfffffffffffffn;
  if (expBits === 0) {
    return { M: mantissaBits, E: -1074 };
  }
  return { M: mantissaBits | (1n << 52n), E: expBits - 1075 };
}

// Round numerator/denom to nearest integer, ties to even.
function roundExact(numerator: bigint, denom: bigint): bigint {
  let N = numerator / denom;
  const r = numerator % denom;
  const twice = r * 2n;
  if (twice > denom) {
    N += 1n;
  } else if (twice === denom && N % 2n === 1n) {
    N += 1n;
  }
  return N;
}

// round(M * 2^E * 10^d) using exact arithmetic, round-half-to-even.
function roundTimesPow10(M: bigint, E: number, d: number): bigint {
  const a = E + d;
  const b = d;
  let numerator = M;
  let denom = 1n;
  if (a >= 0) numerator *= 2n ** BigInt(a);
  else denom *= 2n ** BigInt(-a);
  if (b >= 0) numerator *= 5n ** BigInt(b);
  else denom *= 5n ** BigInt(-b);
  return roundExact(numerator, denom);
}

function fixedDigits(x: number, d: number): bigint {
  const { M, E } = decompose(x);
  return roundTimesPow10(M, E, d);
}

function splitFixed(N: bigint, d: number): { intPart: string; fracPart: string } {
  let s = N.toString();
  if (d === 0) return { intPart: s, fracPart: '' };
  if (s.length <= d) s = '0'.repeat(d - s.length + 1) + s;
  return { intPart: s.slice(0, s.length - d), fracPart: s.slice(s.length - d) };
}

// Returns P+1 significant digits and decimal exponent X such that
// value ~= digits[0].digits[1:] * 10^X, rounded to P digits after the point.
function sciDigits(x: number, P: number): { digits: string; X: number } {
  if (x === 0) return { digits: '0'.repeat(P + 1), X: 0 };
  const { M, E } = decompose(x);
  let X = Math.floor(Math.log10(x));
  for (let i = 0; i < 20; i++) {
    const d = P - X;
    const N = roundTimesPow10(M, E, d);
    const s = N.toString();
    if (s.length === P + 1) return { digits: s, X };
    X += s.length - (P + 1);
  }
  throw new Error('sciDigits failed to converge');
}

function sigToFixed(digits: string, X: number): { intPart: string; fracPart: string } {
  if (X >= 0) {
    const introduced = X + 1;
    if (digits.length <= introduced) {
      return { intPart: digits.padEnd(introduced, '0'), fracPart: '' };
    }
    return { intPart: digits.slice(0, introduced), fracPart: digits.slice(introduced) };
  }
  return { intPart: '0', fracPart: '0'.repeat(-X - 1) + digits };
}

function formatExponent(X: number): string {
  const sign = X < 0 ? '-' : '+';
  let abs = Math.abs(X).toString();
  if (abs.length < 2) abs = '0'.repeat(2 - abs.length) + abs;
  return sign + abs;
}

function toBigIntArg(arg: number | bigint): bigint {
  return typeof arg === 'bigint' ? arg : BigInt(arg);
}

interface Converted {
  text: string;
  zeroPadPoint: number | null;
}

function convertInt(conv: 'd' | 'i', flags: Flags, precision: number | undefined, arg: number | bigint): Converted {
  const value = toBigIntArg(arg);
  const neg = value < 0n;
  const magnitude = neg ? -value : value;
  let digits = magnitude.toString();
  if (precision !== undefined) {
    if (precision === 0 && magnitude === 0n) digits = '';
    else if (digits.length < precision) digits = '0'.repeat(precision - digits.length) + digits;
  }
  const sign = neg ? '-' : flags.plus ? '+' : flags.space ? ' ' : '';
  const text = sign + digits;
  const zeroPadPoint = flags.zero && precision === undefined ? sign.length : null;
  return { text, zeroPadPoint };
}

function convertRadix(conv: 'x' | 'X' | 'o', flags: Flags, precision: number | undefined, arg: number | bigint): Converted {
  const value = toBigIntArg(arg);
  let raw = value.toString(conv === 'o' ? 8 : 16);
  if (precision !== undefined && precision === 0 && value === 0n) {
    raw = '';
  } else if (precision !== undefined && raw.length < precision) {
    raw = '0'.repeat(precision - raw.length) + raw;
  }
  if (conv === 'X') raw = raw.toUpperCase();
  let prefix = '';
  if (flags.hash) {
    if (conv === 'o') {
      if (raw.length === 0 || raw[0] !== '0') raw = '0' + raw;
    } else if (value !== 0n) {
      prefix = conv === 'x' ? '0x' : '0X';
    }
  }
  const text = prefix + raw;
  const zeroPadPoint = flags.zero && precision === undefined ? prefix.length : null;
  return { text, zeroPadPoint };
}

function signFor(neg: boolean, flags: Flags): string {
  if (neg) return '-';
  if (flags.plus) return '+';
  if (flags.space) return ' ';
  return '';
}

function convertFloat(
  conv: 'e' | 'E' | 'f' | 'F' | 'g' | 'G',
  flags: Flags,
  hasPrecision: boolean,
  precision: number | undefined,
  arg: number,
): Converted {
  const isUpper = conv === 'E' || conv === 'F' || conv === 'G';
  const isNaN = Number.isNaN(arg);
  const isInf = !isNaN && !Number.isFinite(arg);
  const negSignBit = Object.is(arg, -0) || arg < 0;

  if (isNaN) {
    return { text: isUpper ? 'NAN' : 'nan', zeroPadPoint: null };
  }
  if (isInf) {
    const sign = signFor(negSignBit, flags);
    const body = isUpper ? 'INF' : 'inf';
    return { text: sign + body, zeroPadPoint: null };
  }

  const sign = signFor(negSignBit, flags);
  const x = Math.abs(arg);
  let body: string;

  if (conv === 'f' || conv === 'F') {
    const prec = hasPrecision ? (precision as number) : 6;
    const N = fixedDigits(x, prec);
    const { intPart, fracPart } = splitFixed(N, prec);
    const dot = prec > 0 || flags.hash ? '.' : '';
    body = intPart + dot + fracPart;
  } else if (conv === 'e' || conv === 'E') {
    const prec = hasPrecision ? (precision as number) : 6;
    const { digits, X } = sciDigits(x, prec);
    const d0 = digits[0];
    const rest = digits.slice(1);
    const dot = prec > 0 || flags.hash ? '.' : '';
    body = d0 + dot + rest + (conv === 'E' ? 'E' : 'e') + formatExponent(X);
  } else {
    // g, G
    let P = hasPrecision ? (precision as number) : 6;
    if (P === 0) P = 1;
    const { digits, X } = sciDigits(x, P - 1);
    if (P > X && X >= -4) {
      const { intPart, fracPart } = sigToFixed(digits, X);
      let frac = fracPart;
      if (!flags.hash) frac = frac.replace(/0+$/, '');
      const dot = frac.length > 0 ? '.' : flags.hash ? '.' : '';
      body = intPart + dot + frac;
    } else {
      const d0 = digits[0];
      let rest = digits.slice(1);
      if (!flags.hash) rest = rest.replace(/0+$/, '');
      const dot = rest.length > 0 ? '.' : flags.hash ? '.' : '';
      body = d0 + dot + rest + (conv === 'G' ? 'E' : 'e') + formatExponent(X);
    }
  }

  const text = sign + body;
  const zeroPadPoint = flags.zero ? sign.length : null;
  return { text, zeroPadPoint };
}

function convertString(conv: 's' | 'c', precision: number | undefined, arg: string): Converted {
  let text = arg;
  if (conv === 's' && precision !== undefined) {
    text = text.slice(0, precision);
  }
  return { text, zeroPadPoint: null };
}

function applyWidth(text: string, width: number, flags: Flags, zeroPadPoint: number | null): string {
  const len = text.length;
  if (len >= width) return text;
  const padLen = width - len;
  if (flags.minus) return text + ' '.repeat(padLen);
  if (flags.zero && zeroPadPoint !== null) {
    return text.slice(0, zeroPadPoint) + '0'.repeat(padLen) + text.slice(zeroPadPoint);
  }
  return ' '.repeat(padLen) + text;
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let result = '';
  let argIndex = 0;
  let lastIndex = 0;
  const specRe = /%([-+ 0#]*)(\d*)(?:\.(\d*))?([diouxXeEfFgGsc%])/g;
  let m: RegExpExecArray | null;
  while ((m = specRe.exec(fmt)) !== null) {
    result += fmt.slice(lastIndex, m.index);
    lastIndex = specRe.lastIndex;
    const [, flagsStr, widthStr, precStr, conv] = m;

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
    const hasPrecision = precStr !== undefined;
    const precision = hasPrecision ? (precStr === '' ? 0 : parseInt(precStr, 10)) : undefined;
    const arg = args[argIndex++];

    let converted: Converted;
    switch (conv) {
      case 'd':
      case 'i':
        converted = convertInt(conv, flags, precision, arg as number | bigint);
        break;
      case 'x':
      case 'X':
      case 'o':
        converted = convertRadix(conv, flags, precision, arg as number | bigint);
        break;
      case 'e':
      case 'E':
      case 'f':
      case 'F':
      case 'g':
      case 'G':
        converted = convertFloat(conv, flags, hasPrecision, precision, arg as number);
        break;
      case 's':
      case 'c':
        converted = convertString(conv, precision, arg as string);
        break;
      default:
        throw new Error(`Unsupported conversion: ${conv}`);
    }

    result += applyWidth(converted.text, width, flags, converted.zeroPadPoint);
  }
  result += fmt.slice(lastIndex);
  return result;
}
