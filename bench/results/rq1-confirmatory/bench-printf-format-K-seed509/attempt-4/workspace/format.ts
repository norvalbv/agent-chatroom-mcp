type Flags = {
  minus: boolean;
  plus: boolean;
  space: boolean;
  zero: boolean;
  hash: boolean;
};

function getBits(mag: number): { mantissa: bigint; exp: number } {
  const buf = new ArrayBuffer(8);
  const dv = new DataView(buf);
  dv.setFloat64(0, mag);
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const expField = (hi >>> 20) & 0x7ff;
  const mantHi = BigInt(hi & 0xfffff);
  const mantissaBits = (mantHi << 32n) | BigInt(lo >>> 0);
  if (expField === 0) {
    return { mantissa: mantissaBits, exp: -1074 };
  }
  return { mantissa: mantissaBits | (1n << 52n), exp: expField - 1075 };
}

// Rounds mantissa*2^exp (exact) to the nearest integer scaled by 10^shift,
// using round-half-to-even on the exact rational value.
function roundScaled(mantissa: bigint, exp: number, shift: number): bigint {
  const a = exp + shift;
  const b = shift;
  let numerator = mantissa;
  let denominator = 1n;
  if (a >= 0) numerator *= 2n ** BigInt(a);
  else denominator *= 2n ** BigInt(-a);
  if (b >= 0) numerator *= 5n ** BigInt(b);
  else denominator *= 5n ** BigInt(-b);
  let q = numerator / denominator;
  const r = numerator % denominator;
  const twice = r * 2n;
  if (twice > denominator || (twice === denominator && q % 2n === 1n)) {
    q += 1n;
  }
  return q;
}

// Round the exact value mantissa*2^exp (mantissa > 0) to N significant
// decimal digits, half-to-even. Returns the N-digit string and the decimal
// exponent E such that the value ~= 0.digits[0] . digits[1..] * 10^(E+1).
function roundToNDigits(mantissa: bigint, exp: number, N: number): { digits: string; exp10: number } {
  let E = Math.floor(Math.log10(Number(mantissa)) + exp * Math.log10(2));
  for (;;) {
    const shift = N - 1 - E;
    const q = roundScaled(mantissa, exp, shift);
    const digits = q.toString();
    if (digits.length === N) return { digits, exp10: E };
    E += digits.length - N;
  }
}

function roundFixedPoint(mantissa: bigint, exp: number, p: number): bigint {
  return roundScaled(mantissa, exp, p);
}

function padGeneric(sign: string, prefix: string, digits: string, width: number, zero: boolean, minus: boolean): string {
  const content = sign + prefix + digits;
  if (content.length >= width) return content;
  const padLen = width - content.length;
  if (minus) return content + ' '.repeat(padLen);
  if (zero) return sign + prefix + '0'.repeat(padLen) + digits;
  return ' '.repeat(padLen) + content;
}

function padText(text: string, width: number, minus: boolean): string {
  if (text.length >= width) return text;
  const padLen = width - text.length;
  return minus ? text + ' '.repeat(padLen) : ' '.repeat(padLen) + text;
}

function applyPrecisionInt(digits: string, precision: number | undefined, valueIsZero: boolean): string {
  if (precision === undefined) return digits;
  if (precision === 0 && valueIsZero) return '';
  if (digits.length < precision) return '0'.repeat(precision - digits.length) + digits;
  return digits;
}

function dotPart(precision: number, frac: string, hash: boolean): string {
  if (precision === 0) return hash ? '.' : '';
  return '.' + frac;
}

function stripTrailingZeros(s: string, hash: boolean): string {
  if (hash) return s;
  let i = s.length;
  while (i > 0 && s[i - 1] === '0') i--;
  return s.slice(0, i);
}

function toBigIntValue(arg: number | bigint): bigint {
  return typeof arg === 'bigint' ? arg : BigInt(arg as number);
}

function formatDI(flags: Flags, width: number, precision: number | undefined, arg: number | bigint): string {
  const value = toBigIntValue(arg);
  const neg = value < 0n;
  const mag = neg ? -value : value;
  const digits = applyPrecisionInt(mag.toString(), precision, mag === 0n);
  const sign = neg ? '-' : flags.plus ? '+' : flags.space ? ' ' : '';
  const zero = flags.zero && precision === undefined;
  return padGeneric(sign, '', digits, width, zero, flags.minus);
}

function formatXO(conv: string, flags: Flags, width: number, precision: number | undefined, arg: number | bigint): string {
  const value = toBigIntValue(arg);
  const base = conv === 'o' ? 8 : 16;
  let digits = value.toString(base);
  if (conv === 'X') digits = digits.toUpperCase();
  digits = applyPrecisionInt(digits, precision, value === 0n);

  let prefix = '';
  if (flags.hash) {
    if (conv === 'x' && value !== 0n) prefix = '0x';
    else if (conv === 'X' && value !== 0n) prefix = '0X';
    else if (conv === 'o') {
      if (digits.length === 0 || digits[0] !== '0') digits = '0' + digits;
    }
  }

  const zero = flags.zero && precision === undefined;
  return padGeneric('', prefix, digits, width, zero, flags.minus);
}

function specialFloatText(x: number, isUpper: boolean): string | null {
  if (Number.isNaN(x)) return isUpper ? 'NAN' : 'nan';
  if (!Number.isFinite(x)) return isUpper ? 'INF' : 'inf';
  return null;
}

function signBitOf(x: number): boolean {
  return x < 0 || Object.is(x, -0);
}

function formatEF(conv: string, flags: Flags, width: number, precision: number | undefined, arg: number): string {
  const isUpper = conv === 'E' || conv === 'F';
  const p = precision === undefined ? 6 : precision;

  if (Number.isNaN(arg)) {
    const body = isUpper ? 'NAN' : 'nan';
    return padGeneric('', '', body, width, false, flags.minus);
  }
  if (!Number.isFinite(arg)) {
    const sign = arg < 0 ? '-' : flags.plus ? '+' : flags.space ? ' ' : '';
    const body = isUpper ? 'INF' : 'inf';
    return padGeneric(sign, '', body, width, false, flags.minus);
  }

  const negBit = signBitOf(arg);
  const mag = Math.abs(arg);
  const sign = negBit ? '-' : flags.plus ? '+' : flags.space ? ' ' : '';

  let bodyDigits: string;
  if (conv === 'e' || conv === 'E') {
    const N = p + 1;
    let digits: string;
    let exp10: number;
    if (mag === 0) {
      digits = '0'.repeat(N);
      exp10 = 0;
    } else {
      const { mantissa, exp } = getBits(mag);
      const r = roundToNDigits(mantissa, exp, N);
      digits = r.digits;
      exp10 = r.exp10;
    }
    const first = digits[0];
    const frac = digits.slice(1);
    const expSign = exp10 < 0 ? '-' : '+';
    let expDigits = Math.abs(exp10).toString();
    if (expDigits.length < 2) expDigits = '0'.repeat(2 - expDigits.length) + expDigits;
    bodyDigits = first + dotPart(p, frac, flags.hash) + (isUpper ? 'E' : 'e') + expSign + expDigits;
  } else {
    let D: bigint;
    if (mag === 0) {
      D = 0n;
    } else {
      const { mantissa, exp } = getBits(mag);
      D = roundFixedPoint(mantissa, exp, p);
    }
    let Ds = D.toString();
    let intPart: string;
    let frac: string;
    if (p === 0) {
      intPart = Ds;
      frac = '';
    } else {
      if (Ds.length <= p) Ds = '0'.repeat(p - Ds.length + 1) + Ds;
      intPart = Ds.slice(0, Ds.length - p);
      frac = Ds.slice(Ds.length - p);
    }
    bodyDigits = intPart + dotPart(p, frac, flags.hash);
  }

  return padGeneric(sign, '', bodyDigits, width, flags.zero, flags.minus);
}

function formatG(conv: string, flags: Flags, width: number, precision: number | undefined, arg: number): string {
  const isUpper = conv === 'G';
  const P = precision === undefined ? 6 : precision === 0 ? 1 : precision;

  if (Number.isNaN(arg)) {
    const body = isUpper ? 'NAN' : 'nan';
    return padGeneric('', '', body, width, false, flags.minus);
  }
  if (!Number.isFinite(arg)) {
    const sign = arg < 0 ? '-' : flags.plus ? '+' : flags.space ? ' ' : '';
    const body = isUpper ? 'INF' : 'inf';
    return padGeneric(sign, '', body, width, false, flags.minus);
  }

  const negBit = signBitOf(arg);
  const mag = Math.abs(arg);
  const sign = negBit ? '-' : flags.plus ? '+' : flags.space ? ' ' : '';

  let digits: string;
  let X: number;
  if (mag === 0) {
    digits = '0'.repeat(P);
    X = 0;
  } else {
    const { mantissa, exp } = getBits(mag);
    const r = roundToNDigits(mantissa, exp, P);
    digits = r.digits;
    X = r.exp10;
  }

  let bodyDigits: string;
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
    const frac = stripTrailingZeros(fracFull, flags.hash);
    bodyDigits = intPart + (frac.length > 0 ? '.' + frac : flags.hash ? '.' : '');
  } else {
    const first = digits[0];
    const rest = stripTrailingZeros(digits.slice(1), flags.hash);
    const dot = rest.length > 0 ? '.' + rest : flags.hash ? '.' : '';
    const expSign = X < 0 ? '-' : '+';
    let expDigits = Math.abs(X).toString();
    if (expDigits.length < 2) expDigits = '0'.repeat(2 - expDigits.length) + expDigits;
    bodyDigits = first + dot + (isUpper ? 'E' : 'e') + expSign + expDigits;
  }

  return padGeneric(sign, '', bodyDigits, width, flags.zero, flags.minus);
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let result = '';
  let argIndex = 0;
  const re = /%([-+0 #]*)(\d*)(?:\.(\d*))?([diouxXeEfFgGsc%])/g;
  let lastIndex = 0;
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
      minus: flagStr.includes('-'),
      plus: flagStr.includes('+'),
      space: flagStr.includes(' '),
      zero: flagStr.includes('0'),
      hash: flagStr.includes('#'),
    };
    const width = widthStr ? parseInt(widthStr, 10) : 0;
    const precision = precStr !== undefined ? (precStr === '' ? 0 : parseInt(precStr, 10)) : undefined;
    const arg = args[argIndex++];

    switch (conv) {
      case 'd':
      case 'i':
        result += formatDI(flags, width, precision, arg as number | bigint);
        break;
      case 'x':
      case 'X':
      case 'o':
        result += formatXO(conv, flags, width, precision, arg as number | bigint);
        break;
      case 'e':
      case 'E':
      case 'f':
      case 'F':
        result += formatEF(conv, flags, width, precision, arg as number);
        break;
      case 'g':
      case 'G':
        result += formatG(conv, flags, width, precision, arg as number);
        break;
      case 's': {
        const str = arg as string;
        const text = precision !== undefined ? str.slice(0, precision) : str;
        result += padText(text, width, flags.minus);
        break;
      }
      case 'c': {
        const text = arg as string;
        result += padText(text, width, flags.minus);
        break;
      }
    }
  }
  result += fmt.slice(lastIndex);
  return result;
}
