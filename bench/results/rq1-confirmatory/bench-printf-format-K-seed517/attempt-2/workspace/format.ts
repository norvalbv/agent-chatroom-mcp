type Flags = {
  minus: boolean;
  plus: boolean;
  space: boolean;
  zero: boolean;
  hash: boolean;
};

function decompose(x: number): { m: bigint; e: number } {
  const buf = new ArrayBuffer(8);
  const dv = new DataView(buf);
  dv.setFloat64(0, x);
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const exp = (hi >>> 20) & 0x7ff;
  const mantHi = hi & 0xfffff;
  let m = (BigInt(mantHi) << 32n) | BigInt(lo);
  let e: number;
  if (exp === 0) {
    e = -1074;
  } else {
    m = m | (1n << 52n);
    e = exp - 1075;
  }
  return { m, e };
}

// round(m * 2^e * 10^k) to nearest integer, ties to even, using exact arithmetic.
function fracRound(m: bigint, e: number, k: number): bigint {
  let N = m;
  let D = 1n;
  if (k >= 0) {
    N *= 5n ** BigInt(k);
  } else {
    D *= 5n ** BigInt(-k);
  }
  const e2 = e + k;
  if (e2 >= 0) {
    N <<= BigInt(e2);
  } else {
    D <<= BigInt(-e2);
  }
  let q = N / D;
  const r = N % D;
  const twice = r * 2n;
  if (twice > D || (twice === D && (q & 1n) === 1n)) q += 1n;
  return q;
}

// Returns P significant decimal digits of ax (ax > 0, finite) and the decimal
// exponent E such that ax ~= 0.d1d2...dP * 10^(E+1), i.e. digits[0] is the
// units digit of the e-style mantissa.
function sigDigits(ax: number, P: number): { digits: string; E: number } {
  const { m, e } = decompose(ax);
  let E = Math.floor(Math.log10(ax));
  for (let iter = 0; iter < 20; iter++) {
    const k = P - 1 - E;
    const N = fracRound(m, e, k);
    const digits = N.toString();
    if (digits.length > P) {
      E += 1;
      continue;
    }
    if (digits.length < P) {
      E -= 1;
      continue;
    }
    return { digits, E };
  }
  throw new Error('unreachable');
}

function signOf(negative: boolean, flags: Flags): string {
  if (negative) return '-';
  if (flags.plus) return '+';
  if (flags.space) return ' ';
  return '';
}

function pad(
  sign: string,
  prefix: string,
  digits: string,
  width: number,
  flags: Flags,
  zeroPad: boolean
): string {
  const full = sign + prefix + digits;
  if (full.length >= width) return full;
  const fill = width - full.length;
  if (flags.minus) return full + ' '.repeat(fill);
  if (zeroPad) return sign + prefix + '0'.repeat(fill) + digits;
  return ' '.repeat(fill) + full;
}

function toBigIntValue(v: number | bigint): bigint {
  return typeof v === 'bigint' ? v : BigInt(Math.trunc(v));
}

function convDI(value: number | bigint, flags: Flags, width: number, precision: number | undefined): string {
  const big = toBigIntValue(value);
  const negative = big < 0n;
  const mag = negative ? -big : big;
  let digits = mag.toString();
  if (precision !== undefined) {
    if (precision === 0 && mag === 0n) {
      digits = '';
    } else if (digits.length < precision) {
      digits = '0'.repeat(precision - digits.length) + digits;
    }
  }
  const sign = signOf(negative, flags);
  const zeroPad = flags.zero && !flags.minus && precision === undefined;
  return pad(sign, '', digits, width, flags, zeroPad);
}

function convXO(
  value: number | bigint,
  flags: Flags,
  width: number,
  precision: number | undefined,
  base: 16 | 8,
  upper: boolean
): string {
  const big = toBigIntValue(value);
  let digits = big.toString(base);
  if (upper) digits = digits.toUpperCase();
  if (precision !== undefined) {
    if (precision === 0 && big === 0n) {
      digits = '';
    } else if (digits.length < precision) {
      digits = '0'.repeat(precision - digits.length) + digits;
    }
  }
  let prefix = '';
  if (flags.hash) {
    if (base === 16) {
      if (big !== 0n) prefix = upper ? '0X' : '0x';
    } else {
      if (digits.length === 0 || digits[0] !== '0') digits = '0' + digits;
    }
  }
  const zeroPad = flags.zero && !flags.minus && precision === undefined;
  return pad('', prefix, digits, width, flags, zeroPad);
}

function expDigits(E: number): string {
  const sign = E < 0 ? '-' : '+';
  let abs = Math.abs(E).toString();
  if (abs.length < 2) abs = '0' + abs;
  return sign + abs;
}

function convF(x: number, flags: Flags, width: number, precision: number, upper: boolean): string {
  if (Number.isNaN(x)) {
    const body = upper ? 'NAN' : 'nan';
    return pad('', '', body, width, flags, false);
  }
  const negative = x < 0 || Object.is(x, -0);
  const sign = signOf(negative, flags);
  if (!Number.isFinite(x)) {
    const body = upper ? 'INF' : 'inf';
    return pad(sign, '', body, width, flags, false);
  }
  const ax = Math.abs(x);
  let s: string;
  if (ax === 0) {
    s = '0'.repeat(precision + 1);
  } else {
    const { m, e } = decompose(ax);
    const N = fracRound(m, e, precision);
    s = N.toString();
    if (s.length < precision + 1) s = '0'.repeat(precision + 1 - s.length) + s;
  }
  const intPart = precision === 0 ? s : s.slice(0, s.length - precision);
  const fracPart = precision === 0 ? '' : s.slice(s.length - precision);
  let digits = intPart;
  if (precision > 0 || flags.hash) digits += '.' + fracPart;
  const zeroPad = flags.zero && !flags.minus;
  return pad(sign, '', digits, width, flags, zeroPad);
}

function convE(x: number, flags: Flags, width: number, precision: number, upper: boolean): string {
  if (Number.isNaN(x)) {
    const body = upper ? 'NAN' : 'nan';
    return pad('', '', body, width, flags, false);
  }
  const negative = x < 0 || Object.is(x, -0);
  const sign = signOf(negative, flags);
  if (!Number.isFinite(x)) {
    const body = upper ? 'INF' : 'inf';
    return pad(sign, '', body, width, flags, false);
  }
  const ax = Math.abs(x);
  let digits: string;
  let E: number;
  if (ax === 0) {
    digits = '0'.repeat(precision + 1);
    E = 0;
  } else {
    const r = sigDigits(ax, precision + 1);
    digits = r.digits;
    E = r.E;
  }
  let mantissa = digits[0];
  if (precision > 0 || flags.hash) mantissa += '.' + digits.slice(1);
  const body = mantissa + (upper ? 'E' : 'e') + expDigits(E);
  const zeroPad = flags.zero && !flags.minus;
  return pad(sign, '', body, width, flags, zeroPad);
}

function trimFrac(frac: string, hash: boolean): string {
  if (hash) return frac;
  let end = frac.length;
  while (end > 0 && frac[end - 1] === '0') end -= 1;
  return frac.slice(0, end);
}

function convG(x: number, flags: Flags, width: number, precision: number, upper: boolean): string {
  if (Number.isNaN(x)) {
    const body = upper ? 'NAN' : 'nan';
    return pad('', '', body, width, flags, false);
  }
  const negative = x < 0 || Object.is(x, -0);
  const sign = signOf(negative, flags);
  if (!Number.isFinite(x)) {
    const body = upper ? 'INF' : 'inf';
    return pad(sign, '', body, width, flags, false);
  }
  const P = precision === 0 ? 1 : precision;
  const ax = Math.abs(x);
  let digits: string;
  let E: number;
  if (ax === 0) {
    digits = '0'.repeat(P);
    E = 0;
  } else {
    const r = sigDigits(ax, P);
    digits = r.digits;
    E = r.E;
  }
  let body: string;
  if (P > E && E >= -4) {
    let intPart: string;
    let fracPart: string;
    if (E >= 0) {
      intPart = digits.slice(0, E + 1);
      fracPart = digits.slice(E + 1);
    } else {
      intPart = '0';
      fracPart = '0'.repeat(-E - 1) + digits;
    }
    const trimmed = trimFrac(fracPart, flags.hash);
    body = intPart;
    if (trimmed.length > 0 || flags.hash) body += '.' + trimmed;
  } else {
    const fracPart = digits.slice(1);
    const trimmed = trimFrac(fracPart, flags.hash);
    let mantissa = digits[0];
    if (trimmed.length > 0 || flags.hash) mantissa += '.' + trimmed;
    body = mantissa + (upper ? 'E' : 'e') + expDigits(E);
  }
  const zeroPad = flags.zero && !flags.minus;
  return pad(sign, '', body, width, flags, zeroPad);
}

function convS(value: string, flags: Flags, width: number, precision: number | undefined): string {
  let s = value;
  if (precision !== undefined) s = s.slice(0, precision);
  if (s.length >= width) return s;
  const fill = ' '.repeat(width - s.length);
  return flags.minus ? s + fill : fill + s;
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  const re = /%([-+0 #]*)(\d*)(?:\.(\d*))?([diouxXeEfFgGsc%])/g;
  let result = '';
  let lastIndex = 0;
  let argIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(fmt)) !== null) {
    result += fmt.slice(lastIndex, match.index);
    lastIndex = re.lastIndex;
    const [, flagStr, widthStr, precStr, conv] = match;
    if (conv === '%') {
      result += '%';
      continue;
    }
    const flags: Flags = {
      minus: flagStr.includes('-'),
      plus: flagStr.includes('+'),
      space: flagStr.includes(' '),
      zero: flagStr.includes('0'),
      hash: flagStr.includes('#'),
    };
    const width = widthStr ? parseInt(widthStr, 10) : 0;
    const precision = precStr === undefined ? undefined : precStr === '' ? 0 : parseInt(precStr, 10);
    const arg = args[argIndex++];
    switch (conv) {
      case 'd':
      case 'i':
        result += convDI(arg as number | bigint, flags, width, precision);
        break;
      case 'x':
        result += convXO(arg as number | bigint, flags, width, precision, 16, false);
        break;
      case 'X':
        result += convXO(arg as number | bigint, flags, width, precision, 16, true);
        break;
      case 'o':
        result += convXO(arg as number | bigint, flags, width, precision, 8, false);
        break;
      case 'f':
        result += convF(arg as number, flags, width, precision ?? 6, false);
        break;
      case 'F':
        result += convF(arg as number, flags, width, precision ?? 6, true);
        break;
      case 'e':
        result += convE(arg as number, flags, width, precision ?? 6, false);
        break;
      case 'E':
        result += convE(arg as number, flags, width, precision ?? 6, true);
        break;
      case 'g':
        result += convG(arg as number, flags, width, precision ?? 6, false);
        break;
      case 'G':
        result += convG(arg as number, flags, width, precision ?? 6, true);
        break;
      case 's':
        result += convS(arg as string, flags, width, precision);
        break;
      case 'c':
        result += convS(arg as string, flags, width, undefined);
        break;
    }
  }
  result += fmt.slice(lastIndex);
  return result;
}
