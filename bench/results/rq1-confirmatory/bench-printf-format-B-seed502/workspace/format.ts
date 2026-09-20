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
  dv.setFloat64(0, x);
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const expBits = (hi >>> 20) & 0x7ff;
  const mantHigh = hi & 0xfffff;
  const mantissa = (BigInt(mantHigh) << 32n) | BigInt(lo);
  if (expBits === 0) {
    return { M: mantissa, E: -1074 };
  }
  return { M: mantissa | (1n << 52n), E: expBits - 1075 };
}

// round(x * 10^d) to nearest integer, ties to even, using the exact binary value of x.
function roundToDigits(x: number, d: number): bigint {
  if (x === 0) return 0n;
  const { M, E } = decompose(x);
  const pow5 = d >= 0 ? 5n ** BigInt(d) : 1n;
  const pow5den = d < 0 ? 5n ** BigInt(-d) : 1n;
  const e2 = E + d;
  const pow2num = e2 >= 0 ? 2n ** BigInt(e2) : 1n;
  const pow2den = e2 < 0 ? 2n ** BigInt(-e2) : 1n;
  const numerator = M * pow5 * pow2num;
  const denominator = pow5den * pow2den;
  let q = numerator / denominator;
  const r = numerator % denominator;
  const twice = r * 2n;
  if (twice > denominator) {
    q += 1n;
  } else if (twice === denominator) {
    if (q % 2n === 1n) q += 1n;
  }
  return q;
}

// Returns P+1 significant digits of x (x > 0, finite) and the base-10 exponent,
// correctly rounded (ties to even) using the exact binary value of x.
function sciDigits(x: number, P: number): { digits: string; exp: number } {
  let exp = Math.floor(Math.log10(x));
  for (let i = 0; i < 10; i++) {
    const d = P - exp;
    const r = roundToDigits(x, d);
    const s = r.toString();
    const diff = s.length - (P + 1);
    if (diff === 0) return { digits: s, exp };
    exp += diff;
  }
  throw new Error('sciDigits failed to converge');
}

function applyWidth(
  sign: string,
  prefix: string,
  digits: string,
  width: number | undefined,
  leftAlign: boolean,
  zeroPad: boolean
): string {
  const bodyStr = sign + prefix + digits;
  if (width === undefined || width <= bodyStr.length) return bodyStr;
  const padLen = width - bodyStr.length;
  if (leftAlign) return bodyStr + ' '.repeat(padLen);
  if (zeroPad) return sign + prefix + '0'.repeat(padLen) + digits;
  return ' '.repeat(padLen) + bodyStr;
}

function padPlain(str: string, width: number | undefined, leftAlign: boolean): string {
  if (width === undefined || width <= str.length) return str;
  const pad = ' '.repeat(width - str.length);
  return leftAlign ? str + pad : pad + str;
}

function toBig(arg: number | bigint): bigint {
  return typeof arg === 'bigint' ? arg : BigInt(arg);
}

function convertSignedInt(
  flags: Flags,
  width: number | undefined,
  precision: number | undefined,
  arg: number | bigint
): string {
  const big = toBig(arg);
  const negative = big < 0n;
  const absDigits = (negative ? -big : big).toString();
  let digits = absDigits;
  if (precision !== undefined) {
    if (precision === 0 && big === 0n) {
      digits = '';
    } else if (digits.length < precision) {
      digits = '0'.repeat(precision - digits.length) + digits;
    }
  }
  const sign = negative ? '-' : flags.plus ? '+' : flags.space ? ' ' : '';
  const zeroPad = flags.zero && !flags.minus && precision === undefined;
  return applyWidth(sign, '', digits, width, flags.minus, zeroPad);
}

function convertUnsignedInt(
  flags: Flags,
  width: number | undefined,
  precision: number | undefined,
  arg: number | bigint,
  base: 16 | 8,
  upper: boolean
): string {
  const big = toBig(arg);
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
      if (digits === '' || digits[0] !== '0') digits = '0' + digits;
    }
  }
  const zeroPad = flags.zero && !flags.minus && precision === undefined;
  return applyWidth('', prefix, digits, width, flags.minus, zeroPad);
}

function specialFloat(
  value: number,
  flags: Flags,
  upper: boolean,
  width: number | undefined
): string | null {
  if (Number.isNaN(value)) {
    const s = upper ? 'NAN' : 'nan';
    return applyWidth('', '', s, width, flags.minus, false);
  }
  if (!Number.isFinite(value)) {
    const negative = value < 0;
    const sign = negative ? '-' : flags.plus ? '+' : flags.space ? ' ' : '';
    const s = upper ? 'INF' : 'inf';
    return applyWidth(sign, '', s, width, flags.minus, false);
  }
  return null;
}

function floatSignAndAbs(value: number, flags: Flags): { sign: string; abs: number } {
  const negative = value < 0 || Object.is(value, -0);
  const sign = negative ? '-' : flags.plus ? '+' : flags.space ? ' ' : '';
  return { sign, abs: Math.abs(value) };
}

function convertE(
  flags: Flags,
  width: number | undefined,
  precision: number | undefined,
  arg: number,
  upper: boolean
): string {
  const special = specialFloat(arg, flags, upper, width);
  if (special !== null) return special;
  const { sign, abs } = floatSignAndAbs(arg, flags);
  const P = precision === undefined ? 6 : precision;
  let mantissa: string, exp: number;
  if (abs === 0) {
    mantissa = '0'.repeat(P + 1);
    exp = 0;
  } else {
    const r = sciDigits(abs, P);
    mantissa = r.digits;
    exp = r.exp;
  }
  const first = mantissa[0];
  const frac = mantissa.slice(1);
  const pointPart = P === 0 ? (flags.hash ? '.' : '') : '.' + frac;
  const expSign = exp < 0 ? '-' : '+';
  const expDigits = Math.abs(exp).toString().padStart(2, '0');
  const body = first + pointPart + (upper ? 'E' : 'e') + expSign + expDigits;
  const zeroPad = flags.zero && !flags.minus;
  return applyWidth(sign, '', body, width, flags.minus, zeroPad);
}

function convertF(
  flags: Flags,
  width: number | undefined,
  precision: number | undefined,
  arg: number,
  upper: boolean
): string {
  const special = specialFloat(arg, flags, upper, width);
  if (special !== null) return special;
  const { sign, abs } = floatSignAndAbs(arg, flags);
  const P = precision === undefined ? 6 : precision;
  let s: string;
  if (abs === 0) {
    s = '0'.repeat(P + 1);
  } else {
    s = roundToDigits(abs, P).toString();
    if (s.length < P + 1) s = s.padStart(P + 1, '0');
  }
  const splitPoint = s.length - P;
  const intPart = s.slice(0, splitPoint);
  const fracPart = s.slice(splitPoint);
  const pointPart = P === 0 ? (flags.hash ? '.' : '') : '.' + fracPart;
  const body = intPart + pointPart;
  const zeroPad = flags.zero && !flags.minus;
  return applyWidth(sign, '', body, width, flags.minus, zeroPad);
}

function convertG(
  flags: Flags,
  width: number | undefined,
  precision: number | undefined,
  arg: number,
  upper: boolean
): string {
  const special = specialFloat(arg, flags, upper, width);
  if (special !== null) return special;
  const { sign, abs } = floatSignAndAbs(arg, flags);
  const P = precision === undefined ? 6 : precision === 0 ? 1 : precision;
  const X = abs === 0 ? 0 : sciDigits(abs, P - 1).exp;
  let body: string;
  if (P > X && X >= -4) {
    const Pf = P - 1 - X;
    let s: string;
    if (abs === 0) {
      s = '0'.repeat(Pf + 1);
    } else {
      s = roundToDigits(abs, Pf).toString();
      if (s.length < Pf + 1) s = s.padStart(Pf + 1, '0');
    }
    const splitPoint = s.length - Pf;
    const intPart = s.slice(0, splitPoint);
    let fracPart = s.slice(splitPoint);
    if (!flags.hash) fracPart = fracPart.replace(/0+$/, '');
    body = fracPart.length > 0 ? intPart + '.' + fracPart : flags.hash ? intPart + '.' : intPart;
  } else {
    const Pe = P - 1;
    let mantissa: string, exp: number;
    if (abs === 0) {
      mantissa = '0'.repeat(Pe + 1);
      exp = 0;
    } else {
      const r = sciDigits(abs, Pe);
      mantissa = r.digits;
      exp = r.exp;
    }
    const first = mantissa[0];
    let frac = mantissa.slice(1);
    if (!flags.hash) frac = frac.replace(/0+$/, '');
    const core = frac.length > 0 ? first + '.' + frac : flags.hash ? first + '.' : first;
    const expSign = exp < 0 ? '-' : '+';
    const expDigits = Math.abs(exp).toString().padStart(2, '0');
    body = core + (upper ? 'E' : 'e') + expSign + expDigits;
  }
  const zeroPad = flags.zero && !flags.minus;
  return applyWidth(sign, '', body, width, flags.minus, zeroPad);
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let argIndex = 0;
  let result = '';
  const re = /%([-+0 #]*)(\d*)(?:\.(\d*))?([diouxXeEfFgGsc%])/g;
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(fmt)) !== null) {
    result += fmt.slice(lastIndex, m.index);
    lastIndex = re.lastIndex;
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
    const width = widthStr === '' ? undefined : parseInt(widthStr, 10);
    const precision = precStr === undefined ? undefined : precStr === '' ? 0 : parseInt(precStr, 10);
    const arg = args[argIndex++];

    switch (conv) {
      case 'd':
      case 'i':
        result += convertSignedInt(flags, width, precision, arg as number | bigint);
        break;
      case 'x':
        result += convertUnsignedInt(flags, width, precision, arg as number | bigint, 16, false);
        break;
      case 'X':
        result += convertUnsignedInt(flags, width, precision, arg as number | bigint, 16, true);
        break;
      case 'o':
        result += convertUnsignedInt(flags, width, precision, arg as number | bigint, 8, false);
        break;
      case 'e':
        result += convertE(flags, width, precision, arg as number, false);
        break;
      case 'E':
        result += convertE(flags, width, precision, arg as number, true);
        break;
      case 'f':
        result += convertF(flags, width, precision, arg as number, false);
        break;
      case 'F':
        result += convertF(flags, width, precision, arg as number, true);
        break;
      case 'g':
        result += convertG(flags, width, precision, arg as number, false);
        break;
      case 'G':
        result += convertG(flags, width, precision, arg as number, true);
        break;
      case 's': {
        let str = arg as string;
        if (precision !== undefined) str = str.slice(0, precision);
        result += padPlain(str, width, flags.minus);
        break;
      }
      case 'c': {
        const str = arg as string;
        result += padPlain(str, width, flags.minus);
        break;
      }
    }
  }
  result += fmt.slice(lastIndex);
  return result;
}
