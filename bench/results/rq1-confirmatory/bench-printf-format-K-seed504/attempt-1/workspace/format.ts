type Flags = {
  minus: boolean;
  plus: boolean;
  space: boolean;
  zero: boolean;
  hash: boolean;
};

function assemble(
  sign: string,
  prefix: string,
  digits: string,
  width: number,
  zeroFill: boolean,
  leftAlign: boolean,
): string {
  const core = sign + prefix + digits;
  if (core.length >= width) return core;
  const padLen = width - core.length;
  if (leftAlign) return core + ' '.repeat(padLen);
  if (zeroFill) return sign + prefix + '0'.repeat(padLen) + digits;
  return ' '.repeat(padLen) + core;
}

function signOf(negative: boolean, flags: Flags): string {
  if (negative) return '-';
  if (flags.plus) return '+';
  if (flags.space) return ' ';
  return '';
}

function bitLength(x: bigint): number {
  return x === 0n ? 0 : x.toString(2).length;
}

function fractionOfDouble(value: number): { numerator: bigint; denominator: bigint } {
  // value must be finite and >= 0
  const buf = new ArrayBuffer(8);
  const dv = new DataView(buf);
  dv.setFloat64(0, value);
  const bits = dv.getBigUint64(0);
  const expBits = Number((bits >> 52n) & 0x7ffn);
  const mantissaBits = bits & 0xfffffffffffffn;
  let mantissa: bigint;
  let e: number;
  if (expBits === 0) {
    mantissa = mantissaBits;
    e = -1074;
  } else {
    mantissa = mantissaBits | (1n << 52n);
    e = expBits - 1075;
  }
  if (e >= 0) {
    return { numerator: mantissa << BigInt(e), denominator: 1n };
  }
  return { numerator: mantissa, denominator: 1n << BigInt(-e) };
}

function roundHalfEven(num: bigint, den: bigint): bigint {
  const q = num / den;
  const r = num % den;
  if (r === 0n) return q;
  const twice = r * 2n;
  if (twice > den || (twice === den && q % 2n === 1n)) return q + 1n;
  return q;
}

function roundToFixedDecimals(numerator: bigint, denominator: bigint, p: number): bigint {
  const num = numerator * 10n ** BigInt(p);
  return roundHalfEven(num, denominator);
}

function digitsAndExponent(
  numerator: bigint,
  denominator: bigint,
  sigDigits: number,
): { digits: string; exponent: number } {
  if (numerator === 0n) {
    return { digits: '0'.repeat(sigDigits), exponent: 0 };
  }
  let E = Math.floor((bitLength(numerator) - bitLength(denominator)) * Math.log10(2));

  const computeQuotient = (exp: number): bigint => {
    const shift = sigDigits - 1 - exp;
    let num = numerator;
    let den = denominator;
    if (shift >= 0) {
      num = num * 10n ** BigInt(shift);
    } else {
      den = den * 10n ** BigInt(-shift);
    }
    return roundHalfEven(num, den);
  };

  let quotient = computeQuotient(E);
  let qStr = quotient.toString();
  while (qStr.length > sigDigits) {
    E++;
    quotient = computeQuotient(E);
    qStr = quotient.toString();
  }
  while (qStr.length < sigDigits) {
    E--;
    quotient = computeQuotient(E);
    qStr = quotient.toString();
  }
  return { digits: qStr, exponent: E };
}

function fixedDecimalParts(numerator: bigint, denominator: bigint, p: number): { intPart: string; fracPart: string } {
  const n = roundToFixedDecimals(numerator, denominator, p);
  const full = n.toString().padStart(p + 1, '0');
  const intPart = full.slice(0, full.length - p) || '0';
  const fracPart = p > 0 ? full.slice(full.length - p) : '';
  return { intPart, fracPart };
}

function stripForG(intPart: string, fracPart: string, hash: boolean): string {
  if (!hash) {
    fracPart = fracPart.replace(/0+$/, '');
  }
  if (fracPart.length === 0) {
    return hash ? intPart + '.' : intPart;
  }
  return intPart + '.' + fracPart;
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
      if (c === '-') { flags.minus = true; i++; }
      else if (c === '+') { flags.plus = true; i++; }
      else if (c === ' ') { flags.space = true; i++; }
      else if (c === '0') { flags.zero = true; i++; }
      else if (c === '#') { flags.hash = true; i++; }
      else break;
    }

    let widthStr = '';
    while (i < n && fmt[i] >= '0' && fmt[i] <= '9') {
      widthStr += fmt[i];
      i++;
    }
    const width = widthStr ? parseInt(widthStr, 10) : 0;

    let precision: number | null = null;
    if (fmt[i] === '.') {
      i++;
      let precStr = '';
      while (i < n && fmt[i] >= '0' && fmt[i] <= '9') {
        precStr += fmt[i];
        i++;
      }
      precision = precStr ? parseInt(precStr, 10) : 0;
    }

    const conv = fmt[i];
    i++;
    const arg = args[argIndex++];

    result += convert(conv, flags, width, precision, arg);
  }

  return result;
}

function convert(
  conv: string,
  flags: Flags,
  width: number,
  precision: number | null,
  arg: number | bigint | string,
): string {
  switch (conv) {
    case 'd':
    case 'i': {
      const v = typeof arg === 'bigint' ? arg : BigInt(arg as number);
      const negative = v < 0n;
      const magnitude = negative ? -v : v;
      const sign = signOf(negative, flags);
      let digits: string;
      if (precision !== null) {
        if (precision === 0 && magnitude === 0n) digits = '';
        else digits = magnitude.toString(10).padStart(precision, '0');
      } else {
        digits = magnitude.toString(10);
      }
      const zeroFill = flags.zero && !flags.minus && precision === null;
      return assemble(sign, '', digits, width, zeroFill, flags.minus);
    }
    case 'x':
    case 'X':
    case 'o': {
      const v = typeof arg === 'bigint' ? arg : BigInt(arg as number);
      const base = conv === 'o' ? 8 : 16;
      let raw = v.toString(base);
      if (conv === 'X') raw = raw.toUpperCase();
      let digits: string;
      if (precision !== null) {
        if (precision === 0 && v === 0n) digits = '';
        else digits = raw.padStart(precision, '0');
      } else {
        digits = raw;
      }
      let prefix = '';
      if (flags.hash) {
        if (conv === 'o') {
          if (digits === '' || digits[0] !== '0') digits = '0' + digits;
        } else if (v !== 0n) {
          prefix = conv === 'X' ? '0X' : '0x';
        }
      }
      const zeroFill = flags.zero && !flags.minus && precision === null;
      return assemble('', prefix, digits, width, zeroFill, flags.minus);
    }
    case 'e':
    case 'E': {
      const value = arg as number;
      const upper = conv === 'E';
      if (Number.isNaN(value)) {
        return assemble('', '', upper ? 'NAN' : 'nan', width, false, flags.minus);
      }
      const negative = value < 0 || Object.is(value, -0);
      const sign = signOf(negative, flags);
      if (!Number.isFinite(value)) {
        return assemble(sign, '', upper ? 'INF' : 'inf', width, false, flags.minus);
      }
      const p = precision === null ? 6 : precision;
      const { numerator, denominator } = fractionOfDouble(Math.abs(value));
      const { digits, exponent } = digitsAndExponent(numerator, denominator, p + 1);
      const first = digits[0];
      const rest = digits.slice(1);
      const body = rest.length > 0 ? '.' + rest : flags.hash ? '.' : '';
      const expSign = exponent < 0 ? '-' : '+';
      const expDigits = Math.abs(exponent).toString().padStart(2, '0');
      const text = first + body + (upper ? 'E' : 'e') + expSign + expDigits;
      const zeroFill = flags.zero && !flags.minus;
      return assemble(sign, '', text, width, zeroFill, flags.minus);
    }
    case 'f':
    case 'F': {
      const value = arg as number;
      const upper = conv === 'F';
      if (Number.isNaN(value)) {
        return assemble('', '', upper ? 'NAN' : 'nan', width, false, flags.minus);
      }
      const negative = value < 0 || Object.is(value, -0);
      const sign = signOf(negative, flags);
      if (!Number.isFinite(value)) {
        return assemble(sign, '', upper ? 'INF' : 'inf', width, false, flags.minus);
      }
      const p = precision === null ? 6 : precision;
      const { numerator, denominator } = fractionOfDouble(Math.abs(value));
      const { intPart, fracPart } = fixedDecimalParts(numerator, denominator, p);
      const text = intPart + (fracPart.length > 0 ? '.' + fracPart : flags.hash ? '.' : '');
      const zeroFill = flags.zero && !flags.minus;
      return assemble(sign, '', text, width, zeroFill, flags.minus);
    }
    case 'g':
    case 'G': {
      const value = arg as number;
      const upper = conv === 'G';
      if (Number.isNaN(value)) {
        return assemble('', '', upper ? 'NAN' : 'nan', width, false, flags.minus);
      }
      const negative = value < 0 || Object.is(value, -0);
      const sign = signOf(negative, flags);
      if (!Number.isFinite(value)) {
        return assemble(sign, '', upper ? 'INF' : 'inf', width, false, flags.minus);
      }
      let P = precision === null ? 6 : precision;
      if (P === 0) P = 1;
      const { numerator, denominator } = fractionOfDouble(Math.abs(value));
      const { digits, exponent: X } = digitsAndExponent(numerator, denominator, P);
      let text: string;
      if (P > X && X >= -4) {
        const p = P - 1 - X;
        const { intPart, fracPart } = fixedDecimalParts(numerator, denominator, p);
        text = stripForG(intPart, fracPart, flags.hash);
      } else {
        const first = digits[0];
        const rest = digits.slice(1);
        const expSign = X < 0 ? '-' : '+';
        const expDigits = Math.abs(X).toString().padStart(2, '0');
        text = stripForG(first, rest, flags.hash) + (upper ? 'E' : 'e') + expSign + expDigits;
      }
      const zeroFill = flags.zero && !flags.minus;
      return assemble(sign, '', text, width, zeroFill, flags.minus);
    }
    case 's': {
      const s = arg as string;
      const text = precision !== null ? s.slice(0, precision) : s;
      return assemble('', '', text, width, false, flags.minus);
    }
    case 'c': {
      const s = arg as string;
      return assemble('', '', s, width, false, flags.minus);
    }
    default:
      throw new Error(`unsupported conversion: ${conv}`);
  }
}
