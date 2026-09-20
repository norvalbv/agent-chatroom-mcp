type Flags = {
  minus: boolean;
  plus: boolean;
  space: boolean;
  zero: boolean;
  hash: boolean;
};

function padNumeric(
  signPrefix: string,
  digits: string,
  width: number,
  flags: Flags,
  zeroAllowed: boolean
): string {
  const full = signPrefix + digits;
  if (full.length >= width) return full;
  const padLen = width - full.length;
  if (flags.minus) return full + ' '.repeat(padLen);
  if (flags.zero && zeroAllowed) return signPrefix + '0'.repeat(padLen) + digits;
  return ' '.repeat(padLen) + full;
}

function padGeneric(s: string, width: number, minus: boolean): string {
  if (s.length >= width) return s;
  const padLen = width - s.length;
  return minus ? s + ' '.repeat(padLen) : ' '.repeat(padLen) + s;
}

// ---- exact double decomposition and rounding ----

function decompose(x: number): { sign: boolean; m: bigint; e: number } {
  const buf = new ArrayBuffer(8);
  const dv = new DataView(buf);
  dv.setFloat64(0, x);
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const sign = hi >>> 31 === 1;
  const expBits = (hi >>> 20) & 0x7ff;
  const mantHi = hi & 0xfffff;
  const mantissa = (BigInt(mantHi) << 32n) | BigInt(lo);
  let m: bigint;
  let e: number;
  if (expBits === 0) {
    m = mantissa;
    e = -1074;
  } else {
    m = mantissa | (1n << 52n);
    e = expBits - 1075;
  }
  return { sign, m, e };
}

function roundHalfEven(num: bigint, den: bigint): bigint {
  if (den === 1n) return num;
  const q = num / den;
  const r = num % den;
  const twice = r * 2n;
  if (twice < den) return q;
  if (twice > den) return q + 1n;
  return q % 2n === 0n ? q : q + 1n;
}

// round(m * 2^e * 10^s) using exact arithmetic, round-half-to-even
function scaledRound(m: bigint, e: number, s: number): bigint {
  if (m === 0n) return 0n;
  const numPow5 = s >= 0 ? 5n ** BigInt(s) : 1n;
  const denPow5 = s < 0 ? 5n ** BigInt(-s) : 1n;
  const e2 = e + s;
  const numPow2 = e2 >= 0 ? 2n ** BigInt(e2) : 1n;
  const denPow2 = e2 < 0 ? 2n ** BigInt(-e2) : 1n;
  const num = m * numPow5 * numPow2;
  const den = denPow5 * denPow2;
  return roundHalfEven(num, den);
}

// digit string of length >= precision+1 representing round(value * 10^precision)
function fixedDigits(m: bigint, e: number, precision: number): string {
  const N = scaledRound(m, e, precision);
  return N.toString().padStart(precision + 1, '0');
}

// P significant digits (P = precision+1) and decimal exponent X such that
// value = 0.digits * 10^(X+1) i.e. digits[0].digits[1:] * 10^X
function expDigitsAndExp(m: bigint, e: number, precision: number): { digits: string; X: number } {
  if (m === 0n) {
    return { digits: '0'.repeat(precision + 1), X: 0 };
  }
  let X = Math.floor((Math.log2(Number(m)) + e) * Math.log10(2));
  for (let iter = 0; iter < 8; iter++) {
    const s = precision - X;
    const N = scaledRound(m, e, s);
    const digitsStr = N.toString();
    if (digitsStr.length === precision + 1) {
      return { digits: digitsStr, X };
    } else if (digitsStr.length > precision + 1) {
      X += digitsStr.length - (precision + 1);
    } else {
      X -= precision + 1 - digitsStr.length;
    }
  }
  const s = precision - X;
  const N = scaledRound(m, e, s);
  return { digits: N.toString().padStart(precision + 1, '0'), X };
}

// ---- integer conversions ----

function fmtInt(value: number | bigint, flags: Flags, width: number, precision: number | undefined): string {
  const big = typeof value === 'bigint' ? value : BigInt(value);
  const neg = big < 0n;
  const abs = neg ? -big : big;
  let digits: string;
  if (precision === 0 && abs === 0n) {
    digits = '';
  } else {
    digits = abs.toString(10);
    if (precision !== undefined) digits = digits.padStart(precision, '0');
  }
  const sign = neg ? '-' : flags.plus ? '+' : flags.space ? ' ' : '';
  const zeroAllowed = precision === undefined;
  return padNumeric(sign, digits, width, flags, zeroAllowed);
}

function fmtRadix(
  value: number | bigint,
  conv: 'x' | 'X' | 'o',
  flags: Flags,
  width: number,
  precision: number | undefined
): string {
  const big = typeof value === 'bigint' ? value : BigInt(value);
  const radix = conv === 'o' ? 8 : 16;
  let digits: string;
  if (precision === 0 && big === 0n) {
    digits = '';
  } else {
    digits = big.toString(radix);
    if (conv === 'X') digits = digits.toUpperCase();
    if (precision !== undefined) digits = digits.padStart(precision, '0');
  }
  if (flags.hash && conv === 'o') {
    if (digits.length === 0 || digits[0] !== '0') digits = '0' + digits;
  }
  let prefix = '';
  if (flags.hash && (conv === 'x' || conv === 'X') && big !== 0n) {
    prefix = conv === 'x' ? '0x' : '0X';
  }
  const zeroAllowed = precision === undefined;
  return padNumeric(prefix, digits, width, flags, zeroAllowed);
}

// ---- floating point conversions ----

function fmtFloat(
  conv: 'e' | 'E' | 'f' | 'F' | 'g' | 'G',
  value: number,
  flags: Flags,
  width: number,
  precision: number | undefined
): string {
  const upper = conv === 'E' || conv === 'F' || conv === 'G';
  const kind = conv.toLowerCase() as 'e' | 'f' | 'g';

  const isNaN = Number.isNaN(value);
  const isInf = !isFinite(value) && !isNaN;
  const { sign: negBit, m, e } = decompose(value);

  const signStr = isNaN ? '' : negBit ? '-' : flags.plus ? '+' : flags.space ? ' ' : '';

  if (isNaN) {
    return padNumeric(signStr, upper ? 'NAN' : 'nan', width, flags, false);
  }
  if (isInf) {
    return padNumeric(signStr, upper ? 'INF' : 'inf', width, flags, false);
  }

  const prec = precision === undefined ? 6 : precision;
  let core: string;

  if (kind === 'f') {
    const digits = fixedDigits(m, e, prec);
    const intPart = digits.slice(0, digits.length - prec) || '0';
    const fracPart = prec > 0 ? digits.slice(digits.length - prec) : '';
    core = intPart + (prec > 0 ? '.' + fracPart : flags.hash ? '.' : '');
  } else if (kind === 'e') {
    const { digits, X } = expDigitsAndExp(m, e, prec);
    const lead = digits[0];
    const frac = digits.slice(1);
    const mantissa = lead + (prec > 0 ? '.' + frac : flags.hash ? '.' : '');
    const expLetter = upper ? 'E' : 'e';
    const expSign = X < 0 ? '-' : '+';
    const expAbs = Math.abs(X).toString().padStart(2, '0');
    core = mantissa + expLetter + expSign + expAbs;
  } else {
    const P = prec === 0 ? 1 : prec;
    const { digits, X } = expDigitsAndExp(m, e, P - 1);
    if (P > X && X >= -4) {
      const fPrecision = P - 1 - X;
      const fdigits = fixedDigits(m, e, fPrecision);
      const intPart = fdigits.slice(0, fdigits.length - fPrecision) || '0';
      let fracPart = fPrecision > 0 ? fdigits.slice(fdigits.length - fPrecision) : '';
      if (!flags.hash) fracPart = fracPart.replace(/0+$/, '');
      core = intPart + (fracPart.length > 0 ? '.' + fracPart : flags.hash ? '.' : '');
    } else {
      const lead = digits[0];
      let frac = digits.slice(1);
      if (!flags.hash) frac = frac.replace(/0+$/, '');
      const mantissa = lead + (frac.length > 0 ? '.' + frac : flags.hash ? '.' : '');
      const expLetter = upper ? 'E' : 'e';
      const expSign = X < 0 ? '-' : '+';
      const expAbs = Math.abs(X).toString().padStart(2, '0');
      core = mantissa + expLetter + expSign + expAbs;
    }
  }

  return padNumeric(signStr, core, width, flags, true);
}

// ---- string/char conversions ----

function fmtStr(value: string, flags: Flags, width: number, precision: number | undefined): string {
  let s = String(value);
  if (precision !== undefined) s = s.slice(0, precision);
  return padGeneric(s, width, flags.minus);
}

function fmtChar(value: string, flags: Flags, width: number): string {
  return padGeneric(String(value), width, flags.minus);
}

// ---- top level ----

const SPEC_RE = /%([-+ 0#]*)(\d*)(?:\.(\d*))?([diouxXeEfFgGsc%])/g;

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let argIndex = 0;
  let result = '';
  let lastIndex = 0;
  SPEC_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = SPEC_RE.exec(fmt)) !== null) {
    result += fmt.slice(lastIndex, match.index);
    lastIndex = SPEC_RE.lastIndex;
    const [, flagsStr, widthStr, precStr, conv] = match;

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
    const precision = precStr !== undefined ? (precStr === '' ? 0 : parseInt(precStr, 10)) : undefined;
    const arg = args[argIndex++];

    switch (conv) {
      case 'd':
      case 'i':
        result += fmtInt(arg as number | bigint, flags, width, precision);
        break;
      case 'x':
      case 'X':
      case 'o':
        result += fmtRadix(arg as number | bigint, conv, flags, width, precision);
        break;
      case 'e':
      case 'E':
      case 'f':
      case 'F':
      case 'g':
      case 'G':
        result += fmtFloat(conv, arg as number, flags, width, precision);
        break;
      case 's':
        result += fmtStr(arg as string, flags, width, precision);
        break;
      case 'c':
        result += fmtChar(arg as string, flags, width);
        break;
    }
  }
  result += fmt.slice(lastIndex);
  return result;
}
