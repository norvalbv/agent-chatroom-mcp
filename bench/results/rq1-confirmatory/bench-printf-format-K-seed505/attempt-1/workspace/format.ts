type Flags = {
  minus: boolean;
  plus: boolean;
  space: boolean;
  zero: boolean;
  hash: boolean;
};

function frexpBig(x: number): { mantissa: bigint; exp: number } {
  const buf = new DataView(new ArrayBuffer(8));
  buf.setFloat64(0, x);
  const hi = buf.getUint32(0);
  const lo = buf.getUint32(4);
  const expBits = (hi >>> 20) & 0x7ff;
  const fracHi = hi & 0xfffff;
  const frac = (BigInt(fracHi) << 32n) | BigInt(lo);
  if (expBits === 0) {
    return { mantissa: frac, exp: -1074 };
  }
  const mantissa = frac | (1n << 52n);
  const exp = expBits - 1075;
  return { mantissa, exp };
}

function toFraction(absX: number): { num: bigint; den: bigint } {
  const { mantissa, exp } = frexpBig(absX);
  if (exp >= 0) {
    return { num: mantissa << BigInt(exp), den: 1n };
  }
  return { num: mantissa, den: 1n << BigInt(-exp) };
}

function roundScaled(num: bigint, den: bigint, k: number): bigint {
  let numerator = num;
  let denominator = den;
  if (k >= 0) {
    numerator = numerator * 10n ** BigInt(k);
  } else {
    denominator = denominator * 10n ** BigInt(-k);
  }
  const q = numerator / denominator;
  const r = numerator % denominator;
  const twice = r * 2n;
  if (twice < denominator) return q;
  if (twice > denominator) return q + 1n;
  return q % 2n === 0n ? q : q + 1n;
}

function toFixed(num: bigint, den: bigint, precision: number): { intPart: string; fracPart: string } {
  const N = roundScaled(num, den, precision);
  let s = N.toString();
  if (s.length <= precision) s = s.padStart(precision + 1, '0');
  if (precision === 0) return { intPart: s, fracPart: '' };
  return { intPart: s.slice(0, s.length - precision), fracPart: s.slice(s.length - precision) };
}

function cmpPow10(num: bigint, den: bigint, e: number): number {
  if (e >= 0) {
    const rhs = den * 10n ** BigInt(e);
    if (num < rhs) return -1;
    if (num > rhs) return 1;
    return 0;
  }
  const lhs = num * 10n ** BigInt(-e);
  if (lhs < den) return -1;
  if (lhs > den) return 1;
  return 0;
}

function toSci(x: number, num: bigint, den: bigint, sig: number): { digits: string; exp: number } {
  if (num === 0n) return { digits: '0'.repeat(sig), exp: 0 };
  let E = Math.floor(Math.log10(x));
  if (!Number.isFinite(E)) E = 0;
  while (cmpPow10(num, den, E) < 0) E--;
  while (cmpPow10(num, den, E + 1) >= 0) E++;
  let N = roundScaled(num, den, sig - 1 - E);
  let digits = N.toString();
  if (digits.length > sig) {
    const drop = digits.length - sig;
    E += drop;
    N = N / 10n ** BigInt(drop);
    digits = N.toString();
  }
  if (digits.length < sig) digits = digits.padStart(sig, '0');
  return { digits, exp: E };
}

function padSpace(body: string, width: number, minus: boolean): string {
  if (body.length >= width) return body;
  const pad = ' '.repeat(width - body.length);
  return minus ? body + pad : pad + body;
}

function padWithZero(prefix: string, digits: string, width: number, flags: Flags, zeroActive: boolean): string {
  const body = prefix + digits;
  if (body.length >= width) return body;
  const padLen = width - body.length;
  if (flags.minus) return body + ' '.repeat(padLen);
  if (zeroActive) return prefix + '0'.repeat(padLen) + digits;
  return ' '.repeat(padLen) + body;
}

function fmtDI(flags: Flags, width: number, precision: number | undefined, arg: number | bigint): string {
  let isNeg: boolean;
  let mag: bigint;
  if (typeof arg === 'bigint') {
    isNeg = arg < 0n;
    mag = isNeg ? -arg : arg;
  } else {
    isNeg = arg < 0;
    mag = BigInt(Math.abs(arg));
  }
  let digits = mag.toString();
  if (precision !== undefined) {
    if (precision === 0 && mag === 0n) digits = '';
    else if (digits.length < precision) digits = digits.padStart(precision, '0');
  }
  const sign = isNeg ? '-' : flags.plus ? '+' : flags.space ? ' ' : '';
  const zeroActive = flags.zero && !flags.minus && precision === undefined;
  return padWithZero(sign, digits, width, flags, zeroActive);
}

function fmtXXO(conv: string, flags: Flags, width: number, precision: number | undefined, arg: number | bigint): string {
  const mag = typeof arg === 'bigint' ? arg : BigInt(arg);
  const base = conv === 'o' ? 8 : 16;
  let digits = mag.toString(base);
  if (conv === 'X') digits = digits.toUpperCase();
  if (precision !== undefined) {
    if (precision === 0 && mag === 0n) digits = '';
    else if (digits.length < precision) digits = digits.padStart(precision, '0');
  }
  if (conv === 'o' && flags.hash) {
    if (digits.length === 0 || digits[0] !== '0') digits = '0' + digits;
  }
  let prefix = '';
  if ((conv === 'x' || conv === 'X') && flags.hash && mag !== 0n) {
    prefix = conv === 'x' ? '0x' : '0X';
  }
  const zeroActive = flags.zero && !flags.minus && precision === undefined;
  return padWithZero(prefix, digits, width, flags, zeroActive);
}

function formatSciBody(digits: string, X: number, p: number, hash: boolean, upper: boolean, stripZeros = false): string {
  const d0 = digits[0];
  let frac = digits.slice(1, 1 + p);
  if (stripZeros && !hash) {
    frac = frac.replace(/0+$/, '');
  }
  const dot = frac.length > 0 || hash ? '.' + frac : '';
  const expSign = X < 0 ? '-' : '+';
  const expDigits = Math.abs(X).toString().padStart(2, '0');
  const eChar = upper ? 'E' : 'e';
  return d0 + dot + eChar + expSign + expDigits;
}

function signBit(x: number): boolean {
  return x < 0 || Object.is(x, -0);
}

function computeSign(isNeg: boolean, flags: Flags): string {
  if (isNeg) return '-';
  if (flags.plus) return '+';
  if (flags.space) return ' ';
  return '';
}

function fmtFloat(conv: string, flags: Flags, width: number, precision: number | undefined, x: number): string {
  const upper = conv === 'E' || conv === 'F' || conv === 'G';
  if (Number.isNaN(x)) {
    const text = upper ? 'NAN' : 'nan';
    return padSpace(text, width, flags.minus);
  }
  const neg = signBit(x);
  const sign = computeSign(neg, flags);
  if (!Number.isFinite(x)) {
    const text = sign + (upper ? 'INF' : 'inf');
    return padSpace(text, width, flags.minus);
  }
  const absX = Math.abs(x);
  const { num, den } = toFraction(absX);
  const zeroActive = flags.zero && !flags.minus;
  let body: string;
  if (conv === 'f' || conv === 'F') {
    const p = precision === undefined ? 6 : precision;
    const { intPart, fracPart } = toFixed(num, den, p);
    body = intPart + (p > 0 || flags.hash ? '.' + fracPart : '');
  } else if (conv === 'e' || conv === 'E') {
    const p = precision === undefined ? 6 : precision;
    const { digits, exp: X } = toSci(absX, num, den, p + 1);
    body = formatSciBody(digits, X, p, flags.hash, upper);
  } else {
    let P = precision === undefined ? 6 : precision;
    if (P === 0) P = 1;
    const { digits, exp: X } = toSci(absX, num, den, P);
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
      if (!flags.hash) {
        fracPart = fracPart.replace(/0+$/, '');
      }
      body = intPart + (fracPart.length > 0 || flags.hash ? '.' + fracPart : '');
    } else {
      const p = P - 1;
      body = formatSciBody(digits, X, p, flags.hash, upper, true);
    }
  }
  return padWithZero(sign, body, width, flags, zeroActive);
}

function fmtS(flags: Flags, width: number, precision: number | undefined, arg: string): string {
  let text = String(arg);
  if (precision !== undefined) text = text.slice(0, precision);
  return padSpace(text, width, flags.minus);
}

function fmtC(flags: Flags, width: number, arg: string): string {
  return padSpace(String(arg), width, flags.minus);
}

function formatOne(
  conv: string,
  flags: Flags,
  width: number,
  precision: number | undefined,
  arg: number | bigint | string
): string {
  switch (conv) {
    case 'd':
    case 'i':
      return fmtDI(flags, width, precision, arg as number | bigint);
    case 'x':
    case 'X':
    case 'o':
      return fmtXXO(conv, flags, width, precision, arg as number | bigint);
    case 'e':
    case 'E':
    case 'f':
    case 'F':
    case 'g':
    case 'G':
      return fmtFloat(conv, flags, width, precision, arg as number);
    case 's':
      return fmtS(flags, width, precision, arg as string);
    case 'c':
      return fmtC(flags, width, arg as string);
    default:
      throw new Error('unsupported conversion: ' + conv);
  }
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let argIndex = 0;
  const re = /%([-+ 0#]*)(\d*)(?:\.(\d*))?([diouxXeEfFgGsc%])/g;
  return fmt.replace(re, (_match, flagsStr: string, widthStr: string, precStr: string | undefined, conv: string) => {
    if (conv === '%') return '%';
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
    return formatOne(conv, flags, width, precision, arg);
  });
}
