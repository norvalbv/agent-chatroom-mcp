type Flags = {
  minus: boolean;
  plus: boolean;
  space: boolean;
  zero: boolean;
  hash: boolean;
};

function decompose(x: number): { M: bigint; E: number } {
  const buf = new ArrayBuffer(8);
  const dv = new DataView(buf);
  dv.setFloat64(0, Math.abs(x));
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const expBits = (hi >>> 20) & 0x7ff;
  const mantHigh = hi & 0xfffff;
  const mant = (BigInt(mantHigh) << 32n) | BigInt(lo);
  if (expBits === 0) {
    return { M: mant, E: -1074 };
  }
  return { M: mant | (1n << 52n), E: expBits - 1075 };
}

function exactRound(num: bigint, den: bigint): bigint {
  const q = num / den;
  const r = num % den;
  const twice = r * 2n;
  if (twice < den) return q;
  if (twice > den) return q + 1n;
  return q % 2n === 0n ? q : q + 1n;
}

// round(M * 2^E * 10^p) as an exact integer, ties to even.
function scaledInt(M: bigint, E: number, p: number): bigint {
  if (M === 0n) return 0n;
  const a = E + p;
  const b = p;
  let numerator = M;
  let denominator = 1n;
  if (a >= 0) numerator *= 2n ** BigInt(a);
  else denominator *= 2n ** BigInt(-a);
  if (b >= 0) numerator *= 5n ** BigInt(b);
  else denominator *= 5n ** BigInt(-b);
  return exactRound(numerator, denominator);
}

// Returns sigDigits significant decimal digits of |x| (M * 2^E), rounded
// to nearest with ties to even, along with the decimal exponent X such
// that the value equals 0.digits * 10^(X+1).
function roundToSignificant(
  absX: number,
  M: bigint,
  E: number,
  sigDigits: number,
): { digits: string; exp: number } {
  if (M === 0n) return { digits: '0'.repeat(sigDigits), exp: 0 };
  let X0 = Math.floor(Math.log10(absX));
  for (let iter = 0; iter < 10; iter++) {
    const p = sigDigits - 1 - X0;
    const N = scaledInt(M, E, p);
    const s = N.toString();
    if (s.length === sigDigits) return { digits: s, exp: X0 };
    if (s.length === sigDigits + 1) {
      return { digits: s.slice(0, sigDigits), exp: X0 + 1 };
    }
    if (s.length < sigDigits) {
      X0 -= sigDigits - s.length;
    } else {
      X0 += s.length - sigDigits;
    }
  }
  throw new Error('roundToSignificant failed to converge');
}

function padNumeric(
  sign: string,
  prefix: string,
  digits: string,
  width: number | undefined,
  flags: Flags,
  zeroOk: boolean,
): string {
  const core = sign + prefix + digits;
  if (width === undefined || core.length >= width) return core;
  const padLen = width - core.length;
  if (flags.minus) return core + ' '.repeat(padLen);
  if (zeroOk && flags.zero) return sign + prefix + '0'.repeat(padLen) + digits;
  return ' '.repeat(padLen) + core;
}

function padGeneric(str: string, width: number | undefined, leftAlign: boolean): string {
  if (width === undefined || str.length >= width) return str;
  const padLen = width - str.length;
  return leftAlign ? str + ' '.repeat(padLen) : ' '.repeat(padLen) + str;
}

function signFor(isNeg: boolean, flags: Flags): string {
  if (isNeg) return '-';
  if (flags.plus) return '+';
  if (flags.space) return ' ';
  return '';
}

function convertD(flags: Flags, width: number | undefined, precision: number | undefined, arg: number | bigint): string {
  const v = typeof arg === 'bigint' ? arg : BigInt(arg);
  const neg = v < 0n;
  const mag = neg ? -v : v;
  let digits = mag.toString();
  if (precision !== undefined) {
    if (precision === 0 && mag === 0n) digits = '';
    else digits = digits.padStart(precision, '0');
  }
  const sign = signFor(neg, flags);
  const zeroOk = !flags.minus && precision === undefined;
  return padNumeric(sign, '', digits, width, flags, zeroOk);
}

function convertXO(
  conv: 'x' | 'X' | 'o',
  flags: Flags,
  width: number | undefined,
  precision: number | undefined,
  arg: number | bigint,
): string {
  const v = typeof arg === 'bigint' ? arg : BigInt(arg);
  const base = conv === 'o' ? 8 : 16;
  let digits = v.toString(base);
  if (conv === 'X') digits = digits.toUpperCase();
  if (precision !== undefined) {
    if (precision === 0 && v === 0n) digits = '';
    else digits = digits.padStart(precision, '0');
  }
  let prefix = '';
  if (flags.hash) {
    if (conv === 'o') {
      if (digits.length === 0 || digits[0] !== '0') digits = '0' + digits;
    } else if (v !== 0n) {
      prefix = conv === 'X' ? '0X' : '0x';
    }
  }
  const zeroOk = !flags.minus && precision === undefined;
  return padNumeric('', prefix, digits, width, flags, zeroOk);
}

function convertE(
  conv: 'e' | 'E',
  flags: Flags,
  width: number | undefined,
  precision: number | undefined,
  arg: number,
): string {
  const x = arg;
  const upper = conv === 'E';
  if (Number.isNaN(x)) return padGeneric(upper ? 'NAN' : 'nan', width, flags.minus);
  const isNeg = x < 0 || Object.is(x, -0);
  if (!Number.isFinite(x)) {
    const sign = signFor(isNeg, flags);
    return padGeneric(sign + (upper ? 'INF' : 'inf'), width, flags.minus);
  }
  const p = precision === undefined ? 6 : precision;
  const absX = Math.abs(x);
  const { M, E } = decompose(x);
  const { digits, exp } = roundToSignificant(absX, M, E, p + 1);
  const sign = signFor(isNeg, flags);
  const frac = digits.slice(1);
  const pointPart = p > 0 || flags.hash ? '.' + frac : '';
  const expLetter = upper ? 'E' : 'e';
  const expSign = exp < 0 ? '-' : '+';
  const expAbs = Math.abs(exp).toString().padStart(2, '0');
  const body = digits[0] + pointPart + expLetter + expSign + expAbs;
  return padNumeric(sign, '', body, width, flags, !flags.minus);
}

function convertF(
  conv: 'f' | 'F',
  flags: Flags,
  width: number | undefined,
  precision: number | undefined,
  arg: number,
): string {
  const x = arg;
  const upper = conv === 'F';
  if (Number.isNaN(x)) return padGeneric(upper ? 'NAN' : 'nan', width, flags.minus);
  const isNeg = x < 0 || Object.is(x, -0);
  if (!Number.isFinite(x)) {
    const sign = signFor(isNeg, flags);
    return padGeneric(sign + (upper ? 'INF' : 'inf'), width, flags.minus);
  }
  const p = precision === undefined ? 6 : precision;
  const { M, E } = decompose(x);
  const N = scaledInt(M, E, p);
  let s = N.toString();
  if (s.length <= p) s = s.padStart(p + 1, '0');
  const intPart = s.slice(0, s.length - p) || '0';
  const fracPart = p > 0 ? s.slice(s.length - p) : '';
  const pointPart = p > 0 || flags.hash ? '.' + fracPart : '';
  const sign = signFor(isNeg, flags);
  const body = intPart + pointPart;
  return padNumeric(sign, '', body, width, flags, !flags.minus);
}

function convertG(
  conv: 'g' | 'G',
  flags: Flags,
  width: number | undefined,
  precision: number | undefined,
  arg: number,
): string {
  const x = arg;
  const upper = conv === 'G';
  if (Number.isNaN(x)) return padGeneric(upper ? 'NAN' : 'nan', width, flags.minus);
  const isNeg = x < 0 || Object.is(x, -0);
  if (!Number.isFinite(x)) {
    const sign = signFor(isNeg, flags);
    return padGeneric(sign + (upper ? 'INF' : 'inf'), width, flags.minus);
  }
  let P = precision === undefined ? 6 : precision;
  if (P === 0) P = 1;
  const absX = Math.abs(x);
  const { M, E } = decompose(x);
  const { digits, exp } = roundToSignificant(absX, M, E, P);
  const X = exp;
  const sign = signFor(isNeg, flags);
  let body: string;
  if (P > X && X >= -4) {
    let intPart: string;
    let fracFull: string;
    if (X >= 0) {
      intPart = digits.slice(0, X + 1);
      fracFull = digits.slice(X + 1);
    } else {
      intPart = '0';
      fracFull = '0'.repeat(-X - 1) + digits;
    }
    if (!flags.hash) fracFull = fracFull.replace(/0+$/, '');
    const pointPart = fracFull.length > 0 || flags.hash ? '.' + fracFull : '';
    body = intPart + pointPart;
  } else {
    let fracFull = digits.slice(1);
    if (!flags.hash) fracFull = fracFull.replace(/0+$/, '');
    const pointPart = fracFull.length > 0 || flags.hash ? '.' + fracFull : '';
    const expLetter = upper ? 'E' : 'e';
    const expSign = X < 0 ? '-' : '+';
    const expAbs = Math.abs(X).toString().padStart(2, '0');
    body = digits[0] + pointPart + expLetter + expSign + expAbs;
  }
  return padNumeric(sign, '', body, width, flags, !flags.minus);
}

function convertS(flags: Flags, width: number | undefined, precision: number | undefined, arg: string): string {
  let s = arg;
  if (precision !== undefined) s = s.slice(0, precision);
  return padGeneric(s, width, flags.minus);
}

function convertC(flags: Flags, width: number | undefined, arg: string): string {
  return padGeneric(arg, width, flags.minus);
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
    let j = i + 1;
    const flags: Flags = { minus: false, plus: false, space: false, zero: false, hash: false };
    while (j < n && '-+ 0#'.includes(fmt[j])) {
      switch (fmt[j]) {
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
      j++;
    }
    let widthStr = '';
    while (j < n && fmt[j] >= '0' && fmt[j] <= '9') {
      widthStr += fmt[j];
      j++;
    }
    const width = widthStr === '' ? undefined : parseInt(widthStr, 10);
    let precision: number | undefined;
    if (j < n && fmt[j] === '.') {
      j++;
      let precStr = '';
      while (j < n && fmt[j] >= '0' && fmt[j] <= '9') {
        precStr += fmt[j];
        j++;
      }
      precision = precStr === '' ? 0 : parseInt(precStr, 10);
    }
    const conv = fmt[j];
    j++;
    i = j;

    if (conv === '%') {
      result += '%';
      continue;
    }

    const arg = args[argIndex++];
    switch (conv) {
      case 'd':
      case 'i':
        result += convertD(flags, width, precision, arg as number | bigint);
        break;
      case 'x':
      case 'X':
      case 'o':
        result += convertXO(conv, flags, width, precision, arg as number | bigint);
        break;
      case 'e':
      case 'E':
        result += convertE(conv, flags, width, precision, arg as number);
        break;
      case 'f':
      case 'F':
        result += convertF(conv, flags, width, precision, arg as number);
        break;
      case 'g':
      case 'G':
        result += convertG(conv, flags, width, precision, arg as number);
        break;
      case 's':
        result += convertS(flags, width, precision, arg as string);
        break;
      case 'c':
        result += convertC(flags, width, arg as string);
        break;
      default:
        throw new Error(`Unsupported conversion: %${conv}`);
    }
  }
  return result;
}
