type Flags = Set<string>;

function pad(
  sign: string,
  prefix: string,
  digits: string,
  flags: Flags,
  width: number,
  zeroAllowed: boolean,
): string {
  const bodyLen = sign.length + prefix.length + digits.length;
  if (bodyLen >= width) return sign + prefix + digits;
  const padLen = width - bodyLen;
  if (flags.has('-')) return sign + prefix + digits + ' '.repeat(padLen);
  if (zeroAllowed && flags.has('0')) {
    return sign + prefix + '0'.repeat(padLen) + digits;
  }
  return ' '.repeat(padLen) + sign + prefix + digits;
}

function divRoundEven(n: bigint, d: bigint): bigint {
  const q = n / d;
  const r = n % d;
  const twice = r * 2n;
  if (twice < d) return q;
  if (twice > d) return q + 1n;
  return q % 2n === 0n ? q : q + 1n;
}

interface ExactDecimal {
  N: bigint;
  e: number;
}

function exactDecimal(x: number): ExactDecimal {
  const buf = new ArrayBuffer(8);
  const view = new DataView(buf);
  view.setFloat64(0, Math.abs(x));
  const hi = view.getUint32(0);
  const lo = view.getUint32(4);
  const biasedExp = (hi >>> 20) & 0x7ff;
  const mantHi = hi & 0xfffff;
  let mantissa = (BigInt(mantHi) << 32n) | BigInt(lo >>> 0);
  let exp: number;
  if (biasedExp === 0) {
    if (mantissa === 0n) return { N: 0n, e: 0 };
    exp = 1 - 1023 - 52;
  } else {
    mantissa |= 1n << 52n;
    exp = biasedExp - 1023 - 52;
  }
  if (exp >= 0) {
    return { N: mantissa << BigInt(exp), e: 0 };
  }
  return { N: mantissa * 5n ** BigInt(-exp), e: -exp };
}

function roundFixed(N: bigint, e: number, p: number): bigint {
  if (p >= e) return N * 10n ** BigInt(p - e);
  return divRoundEven(N, 10n ** BigInt(e - p));
}

function buildFixedBody(N: bigint, e: number, p: number, hashFlag: boolean): string {
  const R = roundFixed(N, e, p);
  let rstr = R.toString();
  if (rstr.length < p + 1) rstr = rstr.padStart(p + 1, '0');
  const intPart = rstr.slice(0, rstr.length - p);
  const fracPart = p > 0 ? rstr.slice(rstr.length - p) : '';
  const dot = p > 0 ? '.' : hashFlag ? '.' : '';
  return intPart + dot + fracPart;
}

function stripTrailingZeros(body: string): string {
  if (!body.includes('.')) return body;
  body = body.replace(/0+$/, '');
  if (body.endsWith('.')) body = body.slice(0, -1);
  return body;
}

function buildMantissa(digitsStr: string, p: number, hashFlag: boolean): string {
  const first = digitsStr[0];
  const rest = digitsStr.slice(1);
  const dot = p > 0 ? '.' : hashFlag ? '.' : '';
  return first + dot + rest;
}

function significantDigits(N: bigint, e: number, S: number): { digitsStr: string; exponent: number } {
  if (N === 0n) return { digitsStr: '0'.repeat(S), exponent: 0 };
  const D = N.toString().length;
  const R = D >= S ? divRoundEven(N, 10n ** BigInt(D - S)) : N * 10n ** BigInt(S - D);
  let rstr = R.toString();
  let exponent: number;
  if (rstr.length > S) {
    rstr = rstr.slice(0, S);
    exponent = D - e;
  } else {
    exponent = D - e - 1;
  }
  return { digitsStr: rstr, exponent };
}

function signOf(neg: boolean, flags: Flags): string {
  return neg ? '-' : flags.has('+') ? '+' : flags.has(' ') ? ' ' : '';
}

function formatD(value: number | bigint, flags: Flags, width: number, precision: number | undefined): string {
  let n = typeof value === 'bigint' ? value : BigInt(value);
  const neg = n < 0n;
  if (neg) n = -n;
  let digits = n.toString();
  if (precision !== undefined) {
    if (precision === 0 && n === 0n) digits = '';
    else digits = digits.padStart(precision, '0');
  }
  const sign = signOf(neg, flags);
  const zeroAllowed = flags.has('0') && precision === undefined;
  return pad(sign, '', digits, flags, width, zeroAllowed);
}

function formatHexOct(
  value: number | bigint,
  conv: 'x' | 'X' | 'o',
  flags: Flags,
  width: number,
  precision: number | undefined,
): string {
  const n = typeof value === 'bigint' ? value : BigInt(value);
  const base = conv === 'o' ? 8 : 16;
  let digits = n.toString(base);
  if (conv === 'X') digits = digits.toUpperCase();
  if (precision !== undefined) {
    if (precision === 0 && n === 0n) digits = '';
    else digits = digits.padStart(precision, '0');
  }
  let prefix = '';
  if (flags.has('#')) {
    if (conv === 'o') {
      if (digits.length === 0 || digits[0] !== '0') digits = '0' + digits;
    } else if (n !== 0n) {
      prefix = conv === 'x' ? '0x' : '0X';
    }
  }
  const zeroAllowed = flags.has('0') && precision === undefined;
  return pad('', prefix, digits, flags, width, zeroAllowed);
}

function formatF(x: number, flags: Flags, width: number, precision: number | undefined, upper: boolean): string {
  const p = precision === undefined ? 6 : precision;
  if (Number.isNaN(x)) return pad('', '', upper ? 'NAN' : 'nan', flags, width, false);
  const neg = x < 0 || Object.is(x, -0);
  const sign = signOf(neg, flags);
  if (!Number.isFinite(x)) return pad(sign, '', upper ? 'INF' : 'inf', flags, width, false);
  const { N, e } = exactDecimal(x);
  const digits = buildFixedBody(N, e, p, flags.has('#'));
  return pad(sign, '', digits, flags, width, flags.has('0'));
}

function formatE(x: number, flags: Flags, width: number, precision: number | undefined, upper: boolean): string {
  const p = precision === undefined ? 6 : precision;
  if (Number.isNaN(x)) return pad('', '', upper ? 'NAN' : 'nan', flags, width, false);
  const neg = x < 0 || Object.is(x, -0);
  const sign = signOf(neg, flags);
  if (!Number.isFinite(x)) return pad(sign, '', upper ? 'INF' : 'inf', flags, width, false);
  const { N, e } = exactDecimal(x);
  const S = p + 1;
  const { digitsStr, exponent } = significantDigits(N, e, S);
  const mantissa = buildMantissa(digitsStr, p, flags.has('#'));
  const expSign = exponent < 0 ? '-' : '+';
  const expAbs = Math.abs(exponent).toString().padStart(2, '0');
  const eChar = upper ? 'E' : 'e';
  const digits = mantissa + eChar + expSign + expAbs;
  return pad(sign, '', digits, flags, width, flags.has('0'));
}

function formatG(x: number, flags: Flags, width: number, precision: number | undefined, upper: boolean): string {
  let P = precision === undefined ? 6 : precision;
  if (P === 0) P = 1;
  if (Number.isNaN(x)) return pad('', '', upper ? 'NAN' : 'nan', flags, width, false);
  const neg = x < 0 || Object.is(x, -0);
  const sign = signOf(neg, flags);
  if (!Number.isFinite(x)) return pad(sign, '', upper ? 'INF' : 'inf', flags, width, false);
  const { N, e } = exactDecimal(x);
  const hashFlag = flags.has('#');
  const { digitsStr, exponent: X } = significantDigits(N, e, P);
  let digitsOut: string;
  if (P > X && X >= -4) {
    const p = P - 1 - X;
    const body = buildFixedBody(N, e, p, hashFlag);
    digitsOut = hashFlag ? body : stripTrailingZeros(body);
  } else {
    const p = P - 1;
    const mantissa = buildMantissa(digitsStr, p, hashFlag);
    const mantissaOut = hashFlag ? mantissa : stripTrailingZeros(mantissa);
    const expSign = X < 0 ? '-' : '+';
    const expAbs = Math.abs(X).toString().padStart(2, '0');
    const eChar = upper ? 'E' : 'e';
    digitsOut = mantissaOut + eChar + expSign + expAbs;
  }
  return pad(sign, '', digitsOut, flags, width, flags.has('0'));
}

function formatS(value: string, flags: Flags, width: number, precision: number | undefined): string {
  const s = precision !== undefined ? value.slice(0, precision) : value;
  return pad('', '', s, flags, width, false);
}

function formatC(value: string, flags: Flags, width: number): string {
  return pad('', '', value, flags, width, false);
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let argIndex = 0;
  const re = /%%|%([-+0#\x20]*)(\d*)(?:\.(\d*))?([diouxXeEfFgGsc])/g;
  return fmt.replace(re, (match: string, flagsStr: string, widthStr: string, precStr: string | undefined, conv: string) => {
    if (match === '%%') return '%';
    const flags: Flags = new Set(flagsStr.split(''));
    const width = widthStr ? parseInt(widthStr, 10) : 0;
    const precision = precStr !== undefined ? (precStr === '' ? 0 : parseInt(precStr, 10)) : undefined;
    const arg = args[argIndex++];
    switch (conv) {
      case 'd':
      case 'i':
        return formatD(arg as number | bigint, flags, width, precision);
      case 'x':
      case 'X':
      case 'o':
        return formatHexOct(arg as number | bigint, conv as 'x' | 'X' | 'o', flags, width, precision);
      case 'e':
        return formatE(arg as number, flags, width, precision, false);
      case 'E':
        return formatE(arg as number, flags, width, precision, true);
      case 'f':
        return formatF(arg as number, flags, width, precision, false);
      case 'F':
        return formatF(arg as number, flags, width, precision, true);
      case 'g':
        return formatG(arg as number, flags, width, precision, false);
      case 'G':
        return formatG(arg as number, flags, width, precision, true);
      case 's':
        return formatS(arg as string, flags, width, precision);
      case 'c':
        return formatC(arg as string, flags, width);
      default:
        return match;
    }
  });
}
