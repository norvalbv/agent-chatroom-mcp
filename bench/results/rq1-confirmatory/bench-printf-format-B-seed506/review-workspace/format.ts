interface Flags {
  minus: boolean;
  plus: boolean;
  space: boolean;
  zero: boolean;
  hash: boolean;
}

function applyWidth(
  sign: string,
  prefix: string,
  digits: string,
  width: number | undefined,
  zeroFlag: boolean,
  minusFlag: boolean
): string {
  const core = sign + prefix + digits;
  if (width === undefined || core.length >= width) return core;
  const padLen = width - core.length;
  if (minusFlag) return core + ' '.repeat(padLen);
  if (zeroFlag) return sign + prefix + '0'.repeat(padLen) + digits;
  return ' '.repeat(padLen) + core;
}

function decomposeDouble(abs: number): { numerator: bigint; denominator: bigint } {
  if (abs === 0) return { numerator: 0n, denominator: 1n };
  const buf = new ArrayBuffer(8);
  const dv = new DataView(buf);
  dv.setFloat64(0, abs);
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const expBits = (hi >>> 20) & 0x7ff;
  const mantHigh = hi & 0xfffff;
  let mantissa = (BigInt(mantHigh) << 32n) | BigInt(lo);
  let exponent: number;
  if (expBits === 0) {
    exponent = 1 - 1023 - 52;
  } else {
    mantissa |= 1n << 52n;
    exponent = expBits - 1023 - 52;
  }
  if (exponent >= 0) {
    return { numerator: mantissa << BigInt(exponent), denominator: 1n };
  }
  return { numerator: mantissa, denominator: 1n << BigInt(-exponent) };
}

function roundHalfEven(num: bigint, den: bigint): bigint {
  const q = num / den;
  const r = num % den;
  const twice = r * 2n;
  if (twice < den) return q;
  if (twice > den) return q + 1n;
  return q % 2n === 0n ? q : q + 1n;
}

function scaledRound(numerator: bigint, denominator: bigint, scalePow10: number): bigint {
  let n2 = numerator;
  let d2 = denominator;
  if (scalePow10 >= 0) n2 = n2 * 10n ** BigInt(scalePow10);
  else d2 = d2 * 10n ** BigInt(-scalePow10);
  return roundHalfEven(n2, d2);
}

function getFixedParts(numerator: bigint, denominator: bigint, p: number): { intPart: string; fracPart: string } {
  const m = scaledRound(numerator, denominator, p);
  let s = m.toString();
  if (p === 0) return { intPart: s, fracPart: '' };
  if (s.length <= p) s = s.padStart(p + 1, '0');
  return { intPart: s.slice(0, s.length - p), fracPart: s.slice(s.length - p) };
}

function getExpParts(numerator: bigint, denominator: bigint, p: number, abs: number): { e: number; mStr: string } {
  if (numerator === 0n) return { e: 0, mStr: '0'.repeat(p + 1) };
  let e = Math.floor(Math.log10(abs));
  let m = scaledRound(numerator, denominator, p - e);
  const low = 10n ** BigInt(p);
  const high = 10n ** BigInt(p + 1);
  let guard = 0;
  while (m >= high && guard < 5) {
    e += 1;
    m = scaledRound(numerator, denominator, p - e);
    guard++;
  }
  guard = 0;
  while (m < low && guard < 5) {
    e -= 1;
    m = scaledRound(numerator, denominator, p - e);
    guard++;
  }
  return { e, mStr: m.toString() };
}

function stripTrailingZeros(s: string): string {
  if (!s.includes('.')) return s;
  s = s.replace(/0+$/, '');
  if (s.endsWith('.')) s = s.slice(0, -1);
  return s;
}

function formatFloat(conv: string, flags: Flags, width: number | undefined, precision: number | undefined, value: number): string {
  const isUpper = conv === 'E' || conv === 'F' || conv === 'G';
  const lower = conv.toLowerCase();

  if (Number.isNaN(value)) {
    const s = isUpper ? 'NAN' : 'nan';
    return applyWidth('', '', s, width, false, flags.minus);
  }

  const negative = value < 0 || Object.is(value, -0);
  const sign = negative ? '-' : flags.plus ? '+' : flags.space ? ' ' : '';

  if (!isFinite(value)) {
    const s = isUpper ? 'INF' : 'inf';
    return applyWidth(sign, '', s, width, false, flags.minus);
  }

  const abs = Math.abs(value);
  const { numerator, denominator } = decomposeDouble(abs);
  const zeroFlag = flags.zero && !flags.minus;
  let digits: string;

  if (lower === 'f') {
    const p = precision === undefined ? 6 : precision;
    const { intPart, fracPart } = getFixedParts(numerator, denominator, p);
    digits = intPart + (p > 0 ? '.' + fracPart : flags.hash ? '.' : '');
  } else if (lower === 'e') {
    const p = precision === undefined ? 6 : precision;
    const { e, mStr } = getExpParts(numerator, denominator, p, abs);
    const mantissa = mStr[0] + (p > 0 ? '.' + mStr.slice(1) : flags.hash ? '.' : '');
    const expSign = e < 0 ? '-' : '+';
    const expDigits = Math.abs(e).toString().padStart(2, '0');
    digits = mantissa + (isUpper ? 'E' : 'e') + expSign + expDigits;
  } else {
    let p = precision === undefined ? 6 : precision;
    if (p === 0) p = 1;
    const { e, mStr } = getExpParts(numerator, denominator, p - 1, abs);
    if (p > e && e >= -4) {
      const fp = p - 1 - e;
      const { intPart, fracPart } = getFixedParts(numerator, denominator, fp);
      let d = intPart + (fp > 0 ? '.' + fracPart : '');
      if (!flags.hash) {
        d = stripTrailingZeros(d);
      } else if (fp === 0) {
        d = d + '.';
      }
      digits = d;
    } else {
      let fracPart = mStr.slice(1);
      let mantissa: string;
      if (!flags.hash) {
        fracPart = fracPart.replace(/0+$/, '');
        mantissa = mStr[0] + (fracPart.length > 0 ? '.' + fracPart : '');
      } else {
        mantissa = mStr[0] + '.' + fracPart;
      }
      const expSign = e < 0 ? '-' : '+';
      const expDigits = Math.abs(e).toString().padStart(2, '0');
      digits = mantissa + (isUpper ? 'E' : 'e') + expSign + expDigits;
    }
  }

  return applyWidth(sign, '', digits, width, zeroFlag, flags.minus);
}

function toBigIntArg(arg: number | bigint | string): bigint {
  return typeof arg === 'bigint' ? arg : BigInt(arg as number);
}

function formatOne(conv: string, flags: Flags, width: number | undefined, precision: number | undefined, arg: number | bigint | string): string {
  switch (conv) {
    case 'd':
    case 'i': {
      const big = toBigIntArg(arg);
      const negative = big < 0n;
      const abs = negative ? -big : big;
      let digits = abs.toString(10);
      if (precision !== undefined) {
        digits = precision === 0 && abs === 0n ? '' : digits.padStart(precision, '0');
      }
      const sign = negative ? '-' : flags.plus ? '+' : flags.space ? ' ' : '';
      const zeroFlag = flags.zero && !flags.minus && precision === undefined;
      return applyWidth(sign, '', digits, width, zeroFlag, flags.minus);
    }
    case 'x':
    case 'X':
    case 'o': {
      const big = toBigIntArg(arg);
      let digits = conv === 'x' ? big.toString(16) : conv === 'X' ? big.toString(16).toUpperCase() : big.toString(8);
      if (precision !== undefined) {
        digits = precision === 0 && big === 0n ? '' : digits.padStart(precision, '0');
      }
      if (flags.hash && conv === 'o') {
        if (digits.length === 0 || digits[0] !== '0') digits = '0' + digits;
      }
      let prefix = '';
      if (flags.hash && (conv === 'x' || conv === 'X') && big !== 0n) {
        prefix = conv === 'x' ? '0x' : '0X';
      }
      const zeroFlag = flags.zero && !flags.minus && precision === undefined;
      return applyWidth('', prefix, digits, width, zeroFlag, flags.minus);
    }
    case 'e':
    case 'E':
    case 'f':
    case 'F':
    case 'g':
    case 'G':
      return formatFloat(conv, flags, width, precision, arg as number);
    case 's': {
      let str = arg as string;
      if (precision !== undefined) str = str.slice(0, precision);
      return applyWidth('', '', str, width, false, flags.minus);
    }
    case 'c': {
      const str = arg as string;
      return applyWidth('', '', str, width, false, flags.minus);
    }
    default:
      throw new Error(`Unsupported conversion: %${conv}`);
  }
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
    i++;
    if (fmt[i] === '%') {
      result += '%';
      i++;
      continue;
    }

    const flags: Flags = { minus: false, plus: false, space: false, zero: false, hash: false };
    while (i < n) {
      const c = fmt[i];
      if (c === '-') flags.minus = true;
      else if (c === '+') flags.plus = true;
      else if (c === ' ') flags.space = true;
      else if (c === '0') flags.zero = true;
      else if (c === '#') flags.hash = true;
      else break;
      i++;
    }

    let widthStr = '';
    while (i < n && fmt[i] >= '0' && fmt[i] <= '9') {
      widthStr += fmt[i];
      i++;
    }
    const width = widthStr === '' ? undefined : parseInt(widthStr, 10);

    let precision: number | undefined;
    if (fmt[i] === '.') {
      i++;
      let precStr = '';
      while (i < n && fmt[i] >= '0' && fmt[i] <= '9') {
        precStr += fmt[i];
        i++;
      }
      precision = precStr === '' ? 0 : parseInt(precStr, 10);
    }

    const conv = fmt[i];
    i++;

    const arg = args[argIndex++];
    result += formatOne(conv, flags, width, precision, arg);
  }

  return result;
}
