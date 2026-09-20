type Flags = Set<string>;

interface Spec {
  flags: Flags;
  width: number | null;
  precision: number | null;
  conversion: string;
}

function decomposeDouble(absValue: number): { mantissa: bigint; exp: number } {
  const buf = new ArrayBuffer(8);
  const dv = new DataView(buf);
  dv.setFloat64(0, absValue);
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const exponentBits = (hi >>> 20) & 0x7ff;
  const mantissaHigh = hi & 0xfffff;
  const mantissaBig = (BigInt(mantissaHigh) << 32n) | BigInt(lo >>> 0);
  if (exponentBits === 0) {
    return { mantissa: mantissaBig, exp: -1074 };
  }
  return { mantissa: mantissaBig | (1n << 52n), exp: exponentBits - 1075 };
}

function roundRatio(num: bigint, den: bigint): bigint {
  let q = num / den;
  const r = num % den;
  const twice = r * 2n;
  if (twice > den) {
    q += 1n;
  } else if (twice === den) {
    if (q % 2n === 1n) q += 1n;
  }
  return q;
}

// Returns round(absValue * 10^precision) as an exact integer (ties to even).
function roundFixed(absValue: number, precision: number): bigint {
  if (absValue === 0) return 0n;
  const { mantissa, exp } = decomposeDouble(absValue);
  const tenPow = 10n ** BigInt(precision);
  let num: bigint;
  let den: bigint;
  if (exp >= 0) {
    num = mantissa * (2n ** BigInt(exp)) * tenPow;
    den = 1n;
  } else {
    num = mantissa * tenPow;
    den = 2n ** BigInt(-exp);
  }
  return roundRatio(num, den);
}

// Returns exactly P significant decimal digits of absValue, correctly rounded
// (ties to even), plus the decimal exponent of the leading digit.
function roundSignificant(absValue: number, P: number): { digits: string; exp: number } {
  if (absValue === 0) return { digits: '0'.repeat(P), exp: 0 };
  const { mantissa, exp: binExp } = decomposeDouble(absValue);
  let exp0 = Math.floor(Math.log10(absValue));
  for (let iter = 0; iter < 8; iter++) {
    const k = (P - 1) - exp0;
    let num: bigint = mantissa;
    let den: bigint = 1n;
    if (binExp >= 0) num *= 2n ** BigInt(binExp);
    else den *= 2n ** BigInt(-binExp);
    if (k >= 0) num *= 10n ** BigInt(k);
    else den *= 10n ** BigInt(-k);
    const R = roundRatio(num, den);
    const digits = R.toString();
    if (digits.length === P) {
      return { digits, exp: exp0 };
    } else if (digits.length > P) {
      exp0 += digits.length - P;
    } else {
      exp0 -= P - digits.length;
    }
  }
  // Fallback (should not normally be reached).
  const k = (P - 1) - exp0;
  let num: bigint = mantissa;
  let den: bigint = 1n;
  if (binExp >= 0) num *= 2n ** BigInt(binExp);
  else den *= 2n ** BigInt(-binExp);
  if (k >= 0) num *= 10n ** BigInt(k);
  else den *= 10n ** BigInt(-k);
  const R = roundRatio(num, den);
  return { digits: R.toString().padStart(P, '0').slice(0, P), exp: exp0 };
}

function applyWidth(
  sign: string,
  prefix: string,
  digits: string,
  width: number | null,
  flags: Flags,
  allowZeroPad: boolean
): string {
  const body = sign + prefix + digits;
  if (width === null || body.length >= width) return body;
  const padLen = width - body.length;
  if (flags.has('-')) return body + ' '.repeat(padLen);
  if (allowZeroPad && flags.has('0')) return sign + prefix + '0'.repeat(padLen) + digits;
  return ' '.repeat(padLen) + body;
}

function signFor(flags: Flags, negative: boolean): string {
  if (negative) return '-';
  if (flags.has('+')) return '+';
  if (flags.has(' ')) return ' ';
  return '';
}

function formatSpecialFloat(value: number, flags: Flags, width: number | null, upper: boolean): string | null {
  if (Number.isNaN(value)) {
    const body = upper ? 'NAN' : 'nan';
    return applyWidth('', '', body, width, flags, false);
  }
  if (!Number.isFinite(value)) {
    const sign = signFor(flags, value < 0);
    const body = upper ? 'INF' : 'inf';
    return applyWidth(sign, '', body, width, flags, false);
  }
  return null;
}

function toBigIntMagnitude(value: number | bigint): { negative: boolean; mag: bigint } {
  if (typeof value === 'bigint') {
    return value < 0n ? { negative: true, mag: -value } : { negative: false, mag: value };
  }
  const negative = value < 0;
  return { negative, mag: BigInt(Math.trunc(Math.abs(value))) };
}

function fmtDecimal(value: number | bigint, flags: Flags, width: number | null, precision: number | null): string {
  const { negative, mag } = toBigIntMagnitude(value);
  let digits: string;
  if (precision === null) {
    digits = mag.toString();
  } else if (precision === 0 && mag === 0n) {
    digits = '';
  } else {
    digits = mag.toString().padStart(precision, '0');
  }
  const sign = signFor(flags, negative);
  const allowZeroPad = flags.has('0') && precision === null;
  return applyWidth(sign, '', digits, width, flags, allowZeroPad);
}

function fmtRadix(
  value: number | bigint,
  flags: Flags,
  width: number | null,
  precision: number | null,
  radix: 8 | 16,
  upper: boolean
): string {
  const mag = typeof value === 'bigint' ? value : BigInt(Math.trunc(value));
  let digits: string;
  if (precision === null) {
    digits = mag.toString(radix);
  } else if (precision === 0 && mag === 0n) {
    digits = '';
  } else {
    digits = mag.toString(radix).padStart(precision, '0');
  }
  if (upper) digits = digits.toUpperCase();

  let prefix = '';
  if (flags.has('#')) {
    if (radix === 16) {
      if (mag !== 0n) prefix = upper ? '0X' : '0x';
    } else {
      if (digits === '') digits = '0';
      else if (digits[0] !== '0') digits = '0' + digits;
    }
  }
  const allowZeroPad = flags.has('0') && precision === null;
  return applyWidth('', prefix, digits, width, flags, allowZeroPad);
}

function fmtExp(value: number, flags: Flags, width: number | null, precision: number | null, upper: boolean): string {
  const special = formatSpecialFloat(value, flags, width, upper);
  if (special !== null) return special;

  const prec = precision ?? 6;
  const negative = value < 0 || Object.is(value, -0);
  const absValue = Math.abs(value);
  const { digits, exp } = roundSignificant(absValue, prec + 1);
  const first = digits[0];
  const rest = digits.slice(1);
  let mantissa = first;
  if (prec > 0) mantissa += '.' + rest;
  else if (flags.has('#')) mantissa += '.';

  const expSign = exp >= 0 ? '+' : '-';
  const expDigits = Math.abs(exp).toString().padStart(2, '0');
  const eChar = upper ? 'E' : 'e';
  const numStr = mantissa + eChar + expSign + expDigits;

  const sign = signFor(flags, negative);
  const allowZeroPad = flags.has('0');
  return applyWidth(sign, '', numStr, width, flags, allowZeroPad);
}

function fmtFixed(value: number, flags: Flags, width: number | null, precision: number | null, upper: boolean): string {
  const special = formatSpecialFloat(value, flags, width, upper);
  if (special !== null) return special;

  const prec = precision ?? 6;
  const negative = value < 0 || Object.is(value, -0);
  const absValue = Math.abs(value);
  const scaled = roundFixed(absValue, prec);
  let numStr: string;
  if (prec > 0) {
    const s = scaled.toString().padStart(prec + 1, '0');
    const intPart = s.slice(0, s.length - prec);
    const fracPart = s.slice(s.length - prec);
    numStr = intPart + '.' + fracPart;
  } else {
    numStr = scaled.toString() + (flags.has('#') ? '.' : '');
  }

  const sign = signFor(flags, negative);
  const allowZeroPad = flags.has('0');
  return applyWidth(sign, '', numStr, width, flags, allowZeroPad);
}

function fmtG(value: number, flags: Flags, width: number | null, precision: number | null, upper: boolean): string {
  const special = formatSpecialFloat(value, flags, width, upper);
  if (special !== null) return special;

  const given = precision ?? 6;
  const P = given === 0 ? 1 : given;
  const negative = value < 0 || Object.is(value, -0);
  const absValue = Math.abs(value);
  const { digits, exp: X } = roundSignificant(absValue, P);

  let numStr: string;
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
    if (flags.has('#')) {
      numStr = intPart + '.' + fracPart;
    } else {
      fracPart = fracPart.replace(/0+$/, '');
      numStr = fracPart.length > 0 ? intPart + '.' + fracPart : intPart;
    }
  } else {
    const first = digits[0];
    let rest = digits.slice(1);
    let mantissa: string;
    if (flags.has('#')) {
      mantissa = first + '.' + rest;
    } else {
      rest = rest.replace(/0+$/, '');
      mantissa = rest.length > 0 ? first + '.' + rest : first;
    }
    const expSign = X >= 0 ? '+' : '-';
    const expDigits = Math.abs(X).toString().padStart(2, '0');
    const eChar = upper ? 'E' : 'e';
    numStr = mantissa + eChar + expSign + expDigits;
  }

  const sign = signFor(flags, negative);
  const allowZeroPad = flags.has('0');
  return applyWidth(sign, '', numStr, width, flags, allowZeroPad);
}

function fmtString(value: string, flags: Flags, width: number | null, precision: number | null): string {
  const s = precision !== null ? value.slice(0, precision) : value;
  return applyWidth('', '', s, width, flags, false);
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let result = '';
  let argIndex = 0;
  const re = /%([-+0# ]*)(\d*)(?:\.(\d*))?([diouxXeEfFgGsc%])/g;
  let lastEnd = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(fmt)) !== null) {
    result += fmt.slice(lastEnd, match.index);
    lastEnd = re.lastIndex;

    const [, flagsStr, widthStr, precStr, conversion] = match;
    if (conversion === '%') {
      result += '%';
      continue;
    }

    const flags: Flags = new Set(flagsStr.split('').filter((c) => c.length > 0));
    const width = widthStr === '' ? null : parseInt(widthStr, 10);
    const precision = precStr === undefined ? null : precStr === '' ? 0 : parseInt(precStr, 10);
    const arg = args[argIndex++];

    switch (conversion) {
      case 'd':
      case 'i':
        result += fmtDecimal(arg as number | bigint, flags, width, precision);
        break;
      case 'x':
        result += fmtRadix(arg as number | bigint, flags, width, precision, 16, false);
        break;
      case 'X':
        result += fmtRadix(arg as number | bigint, flags, width, precision, 16, true);
        break;
      case 'o':
        result += fmtRadix(arg as number | bigint, flags, width, precision, 8, false);
        break;
      case 'e':
        result += fmtExp(arg as number, flags, width, precision, false);
        break;
      case 'E':
        result += fmtExp(arg as number, flags, width, precision, true);
        break;
      case 'f':
        result += fmtFixed(arg as number, flags, width, precision, false);
        break;
      case 'F':
        result += fmtFixed(arg as number, flags, width, precision, true);
        break;
      case 'g':
        result += fmtG(arg as number, flags, width, precision, false);
        break;
      case 'G':
        result += fmtG(arg as number, flags, width, precision, true);
        break;
      case 's':
        result += fmtString(arg as string, flags, width, precision);
        break;
      case 'c':
        result += applyWidth('', '', arg as string, width, flags, false);
        break;
    }
  }
  result += fmt.slice(lastEnd);
  return result;
}
