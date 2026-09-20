type Flags = {
  left: boolean;
  plus: boolean;
  space: boolean;
  zero: boolean;
  hash: boolean;
};

function decomposeDouble(absX: number): { mantissa: bigint; exp: number } {
  const buf = new ArrayBuffer(8);
  const dv = new DataView(buf);
  dv.setFloat64(0, absX);
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const exponent = (hi >>> 20) & 0x7ff;
  const mantissaHi = hi & 0xfffff;
  let mantissa = (BigInt(mantissaHi) << 32n) | BigInt(lo >>> 0);
  let exp: number;
  if (exponent === 0) {
    exp = -1074;
  } else {
    mantissa = mantissa | (1n << 52n);
    exp = exponent - 1075;
  }
  return { mantissa, exp };
}

// Returns exact decimal value of a non-negative finite double as N / 10^k.
function toExactDecimal(absX: number): { N: bigint; k: number } {
  if (absX === 0) return { N: 0n, k: 0 };
  const { mantissa, exp } = decomposeDouble(absX);
  if (mantissa === 0n) return { N: 0n, k: 0 };
  if (exp >= 0) {
    return { N: mantissa << BigInt(exp), k: 0 };
  }
  return { N: mantissa * 5n ** BigInt(-exp), k: -exp };
}

function divRoundHalfEven(N: bigint, D: bigint): bigint {
  const q = N / D;
  const r = N % D;
  const twiceR = r * 2n;
  if (twiceR < D) return q;
  if (twiceR > D) return q + 1n;
  return q % 2n === 0n ? q : q + 1n;
}

// Rounds N/10^k to P digits after the decimal point.
function roundToFixed(N: bigint, k: number, P: number): { intPart: string; fracPart: string } {
  let M: bigint;
  if (P >= k) {
    M = N * 10n ** BigInt(P - k);
  } else {
    M = divRoundHalfEven(N, 10n ** BigInt(k - P));
  }
  let s = M.toString();
  if (P === 0) {
    return { intPart: s, fracPart: '' };
  }
  if (s.length <= P) s = '0'.repeat(P - s.length + 1) + s;
  return { intPart: s.slice(0, s.length - P), fracPart: s.slice(s.length - P) };
}

// Rounds N/10^k to P+1 significant digits, returning digits and the base-10
// exponent of the leading digit (as in scientific notation).
function roundSignificant(N: bigint, k: number, P: number): { digits: string; exp: number } {
  if (N === 0n) {
    return { digits: '0'.repeat(P + 1), exp: 0 };
  }
  const s = N.toString();
  const len = s.length;
  let exp = len - k - 1;
  const shift = P - (len - 1);
  let M: bigint;
  if (shift >= 0) {
    M = N * 10n ** BigInt(shift);
  } else {
    M = divRoundHalfEven(N, 10n ** BigInt(-shift));
  }
  let sM = M.toString();
  if (sM.length === P + 2) {
    exp += 1;
    sM = sM.slice(0, P + 1);
  } else if (sM.length < P + 1) {
    sM = '0'.repeat(P + 1 - sM.length) + sM;
  }
  return { digits: sM, exp };
}

function pad(sign: string, prefix: string, digits: string, width: number, opts: { left: boolean; zero: boolean }): string {
  const core = sign + prefix + digits;
  if (core.length >= width) return core;
  const padLen = width - core.length;
  if (opts.left) {
    return core + ' '.repeat(padLen);
  }
  if (opts.zero) {
    return sign + prefix + '0'.repeat(padLen) + digits;
  }
  return ' '.repeat(padLen) + core;
}

function numSign(neg: boolean, flags: Flags): string {
  return neg ? '-' : flags.plus ? '+' : flags.space ? ' ' : '';
}

function formatDI(arg: number | bigint, flags: Flags, width: number, precision: number | null): string {
  let neg: boolean;
  let magnitude: bigint;
  if (typeof arg === 'bigint') {
    neg = arg < 0n;
    magnitude = neg ? -arg : arg;
  } else {
    neg = arg < 0 || Object.is(arg, -0);
    magnitude = BigInt(Math.abs(arg));
  }
  let digits: string;
  if (precision === 0 && magnitude === 0n) {
    digits = '';
  } else {
    digits = magnitude.toString();
    if (precision !== null && digits.length < precision) {
      digits = '0'.repeat(precision - digits.length) + digits;
    }
  }
  const sign = numSign(neg, flags);
  const zeroFlag = flags.zero && precision === null;
  return pad(sign, '', digits, width, { left: flags.left, zero: zeroFlag });
}

function formatBase(arg: number | bigint, base: 16 | 8, upper: boolean, flags: Flags, width: number, precision: number | null): string {
  const magnitude: bigint = typeof arg === 'bigint' ? arg : BigInt(arg);
  let digits = magnitude.toString(base);
  if (upper) digits = digits.toUpperCase();
  if (precision !== null) {
    if (precision === 0 && magnitude === 0n) {
      digits = '';
    } else if (digits.length < precision) {
      digits = '0'.repeat(precision - digits.length) + digits;
    }
  }
  let prefix = '';
  if (flags.hash) {
    if (base === 16) {
      if (magnitude !== 0n) prefix = upper ? '0X' : '0x';
    } else {
      if (digits.length === 0 || digits[0] !== '0') {
        digits = '0' + digits;
      }
    }
  }
  const zeroFlag = flags.zero && precision === null;
  return pad('', prefix, digits, width, { left: flags.left, zero: zeroFlag });
}

function formatSpecialFloat(arg: number, upper: boolean, flags: Flags, width: number): string {
  let text: string;
  let sign = '';
  if (Number.isNaN(arg)) {
    text = upper ? 'NAN' : 'nan';
  } else {
    text = upper ? 'INF' : 'inf';
    sign = numSign(arg < 0, flags);
  }
  return pad(sign, '', text, width, { left: flags.left, zero: false });
}

function expDigits(exp: number): string {
  const sign = exp < 0 ? '-' : '+';
  let abs = Math.abs(exp).toString();
  if (abs.length < 2) abs = '0'.repeat(2 - abs.length) + abs;
  return sign + abs;
}

function formatExp(arg: number, upper: boolean, flags: Flags, width: number, precision: number | null): string {
  const P = precision === null ? 6 : precision;
  if (!Number.isFinite(arg)) return formatSpecialFloat(arg, upper, flags, width);
  const neg = arg < 0 || Object.is(arg, -0);
  const absX = Math.abs(arg);
  const { N, k } = toExactDecimal(absX);
  const { digits, exp } = roundSignificant(N, k, P);
  const frac = digits.slice(1);
  const mantissa = digits[0] + (P > 0 ? '.' + frac : flags.hash ? '.' : '');
  const eChar = upper ? 'E' : 'e';
  const body = mantissa + eChar + expDigits(exp);
  const sign = numSign(neg, flags);
  return pad(sign, '', body, width, { left: flags.left, zero: flags.zero });
}

function formatFixed(arg: number, upper: boolean, flags: Flags, width: number, precision: number | null): string {
  const P = precision === null ? 6 : precision;
  if (!Number.isFinite(arg)) return formatSpecialFloat(arg, upper, flags, width);
  const neg = arg < 0 || Object.is(arg, -0);
  const absX = Math.abs(arg);
  const { N, k } = toExactDecimal(absX);
  const { intPart, fracPart } = roundToFixed(N, k, P);
  const body = intPart + (P > 0 ? '.' + fracPart : flags.hash ? '.' : '');
  const sign = numSign(neg, flags);
  return pad(sign, '', body, width, { left: flags.left, zero: flags.zero });
}

function formatG(arg: number, upper: boolean, flags: Flags, width: number, precision: number | null): string {
  let P = precision === null ? 6 : precision;
  if (P === 0) P = 1;
  if (!Number.isFinite(arg)) return formatSpecialFloat(arg, upper, flags, width);
  const neg = arg < 0 || Object.is(arg, -0);
  const absX = Math.abs(arg);
  const { N, k } = toExactDecimal(absX);
  const { exp: X } = roundSignificant(N, k, P - 1);
  let body: string;
  if (P > X && X >= -4) {
    const F = P - 1 - X;
    const { intPart, fracPart } = roundToFixed(N, k, F);
    let frac = fracPart;
    if (!flags.hash) frac = frac.replace(/0+$/, '');
    body = frac.length > 0 ? intPart + '.' + frac : flags.hash ? intPart + '.' : intPart;
  } else {
    const { digits, exp } = roundSignificant(N, k, P - 1);
    let frac = digits.slice(1);
    if (!flags.hash) frac = frac.replace(/0+$/, '');
    const mantissa = frac.length > 0 ? digits[0] + '.' + frac : flags.hash ? digits[0] + '.' : digits[0];
    const eChar = upper ? 'E' : 'e';
    body = mantissa + eChar + expDigits(exp);
  }
  const sign = numSign(neg, flags);
  return pad(sign, '', body, width, { left: flags.left, zero: flags.zero });
}

function formatS(arg: string, flags: Flags, width: number, precision: number | null): string {
  const text = precision !== null ? arg.slice(0, precision) : arg;
  return pad('', '', text, width, { left: flags.left, zero: false });
}

function formatC(arg: string, flags: Flags, width: number): string {
  return pad('', '', arg, width, { left: flags.left, zero: false });
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let result = '';
  let argIndex = 0;
  let lastIndex = 0;
  const re = /%([-+0 #]*)(\d*)(?:\.(\d*))?([dioxXeEfFgGsc%])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(fmt)) !== null) {
    result += fmt.slice(lastIndex, m.index);
    lastIndex = re.lastIndex;
    const [, flagStr, widthStr, precStr, conv] = m;
    if (conv === '%') {
      result += '%';
      continue;
    }
    const flags: Flags = {
      left: flagStr.includes('-'),
      plus: flagStr.includes('+'),
      space: flagStr.includes(' '),
      zero: flagStr.includes('0'),
      hash: flagStr.includes('#'),
    };
    const width = widthStr ? parseInt(widthStr, 10) : 0;
    const precision = precStr !== undefined ? (precStr === '' ? 0 : parseInt(precStr, 10)) : null;
    const arg = args[argIndex++];
    switch (conv) {
      case 'd':
      case 'i':
        result += formatDI(arg as number | bigint, flags, width, precision);
        break;
      case 'x':
        result += formatBase(arg as number | bigint, 16, false, flags, width, precision);
        break;
      case 'X':
        result += formatBase(arg as number | bigint, 16, true, flags, width, precision);
        break;
      case 'o':
        result += formatBase(arg as number | bigint, 8, false, flags, width, precision);
        break;
      case 'e':
        result += formatExp(arg as number, false, flags, width, precision);
        break;
      case 'E':
        result += formatExp(arg as number, true, flags, width, precision);
        break;
      case 'f':
      case 'F':
        result += formatFixed(arg as number, conv === 'F', flags, width, precision);
        break;
      case 'g':
        result += formatG(arg as number, false, flags, width, precision);
        break;
      case 'G':
        result += formatG(arg as number, true, flags, width, precision);
        break;
      case 's':
        result += formatS(arg as string, flags, width, precision);
        break;
      case 'c':
        result += formatC(arg as string, flags, width);
        break;
    }
  }
  result += fmt.slice(lastIndex);
  return result;
}
