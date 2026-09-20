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

function padLeftRight(s: string, width: number, left: boolean): string {
  if (s.length >= width) return s;
  const pad = ' '.repeat(width - s.length);
  return left ? s + pad : pad + s;
}

function signPrefix(neg: boolean, flags: Flags): string {
  if (neg) return '-';
  if (flags.plus) return '+';
  if (flags.space) return ' ';
  return '';
}

function padNumeric(
  sign: string,
  rest: string,
  flags: Flags,
  width: number,
  allowZero: boolean
): string {
  const body = sign + rest;
  if (width <= body.length) return body;
  if (flags.minus) return body + ' '.repeat(width - body.length);
  if (flags.zero && allowZero) {
    return sign + '0'.repeat(width - body.length) + rest;
  }
  return ' '.repeat(width - body.length) + body;
}

function decompose(x: number): { M: bigint; e2: number } {
  const buf = new ArrayBuffer(8);
  const dv = new DataView(buf);
  dv.setFloat64(0, x);
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const expBits = (hi >>> 20) & 0x7ff;
  const mantHi = hi & 0xfffff;
  const mantissa = (BigInt(mantHi) << 32n) | BigInt(lo >>> 0);
  if (expBits === 0) {
    return { M: mantissa, e2: -1074 };
  }
  return { M: mantissa | (1n << 52n), e2: expBits - 1075 };
}

function roundExact(M: bigint, a: number, c: number): bigint {
  let num = M;
  let den = 1n;
  if (a >= 0) num <<= BigInt(a);
  else den <<= BigInt(-a);
  if (c >= 0) num *= 5n ** BigInt(c);
  else den *= 5n ** BigInt(-c);
  if (den === 1n) return num;
  const q = num / den;
  const r = num % den;
  const twice = r * 2n;
  if (twice > den) return q + 1n;
  if (twice < den) return q;
  return q % 2n === 0n ? q : q + 1n;
}

function toExponentialDigits(
  M: bigint,
  e2: number,
  p: number
): { digits: string; exponent: number } {
  if (M === 0n) return { digits: '0'.repeat(p + 1), exponent: 0 };
  let E = Math.floor(Math.log10(Number(M)) + e2 * Math.log10(2));
  for (let i = 0; i < 40; i++) {
    const c = p - E;
    const D = roundExact(M, e2 + c, c);
    const s = D.toString();
    if (s.length === p + 1) return { digits: s, exponent: E };
    if (s.length > p + 1) E += 1;
    else E -= 1;
  }
  const c = p - E;
  const D = roundExact(M, e2 + c, c);
  return { digits: D.toString().padStart(p + 1, '0'), exponent: E };
}

function toFixedDigits(M: bigint, e2: number, p: number): { intPart: string; fracPart: string } {
  const D = roundExact(M, e2 + p, p);
  const digits = D.toString().padStart(p + 1, '0');
  const intPart = digits.slice(0, digits.length - p) || '0';
  const fracPart = p > 0 ? digits.slice(digits.length - p) : '';
  return { intPart, fracPart };
}

function stripTrailingZeros(s: string): string {
  return s.replace(/0+$/, '');
}

function formatInt(arg: number | bigint, flags: Flags, width: number, precision?: number): string {
  let neg: boolean;
  let mag: bigint;
  if (typeof arg === 'bigint') {
    neg = arg < 0n;
    mag = neg ? -arg : arg;
  } else {
    neg = arg < 0;
    mag = BigInt(Math.abs(arg));
  }
  let digits = mag.toString(10);
  if (precision !== undefined) {
    digits = precision === 0 && mag === 0n ? '' : digits.padStart(precision, '0');
  }
  const sign = signPrefix(neg, flags);
  return padNumeric(sign, digits, flags, width, precision === undefined);
}

function formatHexOct(
  arg: number | bigint,
  flags: Flags,
  width: number,
  precision: number | undefined,
  base: 16 | 8,
  upper: boolean
): string {
  const mag = typeof arg === 'bigint' ? arg : BigInt(arg);
  let digits = mag.toString(base);
  if (upper) digits = digits.toUpperCase();
  if (precision !== undefined) {
    digits = precision === 0 && mag === 0n ? '' : digits.padStart(precision, '0');
  }
  let prefix = '';
  if (flags.hash) {
    if (base === 16) {
      if (mag !== 0n) prefix = upper ? '0X' : '0x';
    } else {
      if (digits.length === 0 || digits[0] !== '0') {
        digits = '0' + digits;
      }
    }
  }
  const body = prefix + digits;
  if (width <= body.length) return body;
  if (flags.minus) return body + ' '.repeat(width - body.length);
  if (flags.zero && precision === undefined) {
    return prefix + '0'.repeat(width - body.length) + digits;
  }
  return ' '.repeat(width - body.length) + body;
}

function specialFloat(arg: number, flags: Flags, width: number, upper: boolean): string | null {
  if (Number.isNaN(arg)) {
    const rest = upper ? 'NAN' : 'nan';
    return padNumeric('', rest, flags, width, false);
  }
  if (!Number.isFinite(arg)) {
    const neg = arg < 0;
    const rest = upper ? 'INF' : 'inf';
    return padNumeric(signPrefix(neg, flags), rest, flags, width, false);
  }
  return null;
}

function formatExp(arg: number, flags: Flags, width: number, precision: number | undefined, upper: boolean): string {
  const p = precision === undefined ? 6 : precision;
  const special = specialFloat(arg, flags, width, upper);
  if (special !== null) return special;
  const neg = arg < 0 || Object.is(arg, -0);
  const { M, e2 } = decompose(Math.abs(arg));
  const { digits, exponent } = toExponentialDigits(M, e2, p);
  const fracDigits = digits.slice(1);
  let mantissa = digits[0];
  if (p > 0 || flags.hash) mantissa += '.' + fracDigits;
  const expSign = exponent < 0 ? '-' : '+';
  const expAbs = Math.abs(exponent).toString().padStart(2, '0');
  const rest = mantissa + (upper ? 'E' : 'e') + expSign + expAbs;
  return padNumeric(signPrefix(neg, flags), rest, flags, width, true);
}

function formatFixed(arg: number, flags: Flags, width: number, precision: number | undefined, upper: boolean): string {
  const p = precision === undefined ? 6 : precision;
  const special = specialFloat(arg, flags, width, upper);
  if (special !== null) return special;
  const neg = arg < 0 || Object.is(arg, -0);
  const { M, e2 } = decompose(Math.abs(arg));
  const { intPart, fracPart } = toFixedDigits(M, e2, p);
  const rest = intPart + (p > 0 || flags.hash ? '.' + fracPart : '');
  return padNumeric(signPrefix(neg, flags), rest, flags, width, true);
}

function formatG(arg: number, flags: Flags, width: number, precision: number | undefined, upper: boolean): string {
  let p = precision === undefined ? 6 : precision;
  if (p === 0) p = 1;
  const special = specialFloat(arg, flags, width, upper);
  if (special !== null) return special;
  const neg = arg < 0 || Object.is(arg, -0);
  const { M, e2 } = decompose(Math.abs(arg));
  const { digits, exponent: X } = toExponentialDigits(M, e2, p - 1);

  let rest: string;
  if (p > X && X >= -4) {
    const fp = p - 1 - X;
    const { intPart, fracPart } = toFixedDigits(M, e2, fp);
    const frac = flags.hash ? fracPart : stripTrailingZeros(fracPart);
    rest = intPart + (frac.length > 0 ? '.' + frac : flags.hash ? '.' : '');
  } else {
    const fracDigits = digits.slice(1);
    const frac = flags.hash ? fracDigits : stripTrailingZeros(fracDigits);
    const mantissa = digits[0] + (frac.length > 0 ? '.' + frac : flags.hash ? '.' : '');
    const expSign = X < 0 ? '-' : '+';
    const expAbs = Math.abs(X).toString().padStart(2, '0');
    rest = mantissa + (upper ? 'E' : 'e') + expSign + expAbs;
  }
  return padNumeric(signPrefix(neg, flags), rest, flags, width, true);
}

function formatString(arg: string, flags: Flags, width: number, precision?: number): string {
  let s = arg;
  if (precision !== undefined) s = s.slice(0, precision);
  return padLeftRight(s, width, flags.minus);
}

function formatChar(arg: string, flags: Flags, width: number): string {
  return padLeftRight(arg, width, flags.minus);
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  const regex = /%([-+0# ]*)(\d*)(?:\.(\d*))?([diouxXeEfFgGsc%])/g;
  let result = '';
  let lastIndex = 0;
  let argIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(fmt)) !== null) {
    result += fmt.slice(lastIndex, match.index);
    lastIndex = regex.lastIndex;
    const [, flagsStr, widthStr, precStr, conv] = match;
    if (conv === '%') {
      result += '%';
      continue;
    }
    const flags = parseFlags(flagsStr);
    const width = widthStr ? parseInt(widthStr, 10) : 0;
    const precision = precStr !== undefined ? (precStr === '' ? 0 : parseInt(precStr, 10)) : undefined;
    const arg = args[argIndex++];
    let s: string;
    switch (conv) {
      case 'd':
      case 'i':
        s = formatInt(arg as number | bigint, flags, width, precision);
        break;
      case 'x':
        s = formatHexOct(arg as number | bigint, flags, width, precision, 16, false);
        break;
      case 'X':
        s = formatHexOct(arg as number | bigint, flags, width, precision, 16, true);
        break;
      case 'o':
        s = formatHexOct(arg as number | bigint, flags, width, precision, 8, false);
        break;
      case 'e':
        s = formatExp(arg as number, flags, width, precision, false);
        break;
      case 'E':
        s = formatExp(arg as number, flags, width, precision, true);
        break;
      case 'f':
        s = formatFixed(arg as number, flags, width, precision, false);
        break;
      case 'F':
        s = formatFixed(arg as number, flags, width, precision, true);
        break;
      case 'g':
        s = formatG(arg as number, flags, width, precision, false);
        break;
      case 'G':
        s = formatG(arg as number, flags, width, precision, true);
        break;
      case 's':
        s = formatString(arg as string, flags, width, precision);
        break;
      case 'c':
        s = formatChar(arg as string, flags, width);
        break;
      default:
        s = '';
    }
    result += s;
  }
  result += fmt.slice(lastIndex);
  return result;
}
