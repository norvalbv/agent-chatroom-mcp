type Flags = {
  minus: boolean;
  plus: boolean;
  space: boolean;
  zero: boolean;
  hash: boolean;
};

function pow10(n: number): bigint {
  return 10n ** BigInt(n);
}

// Round the nonnegative fraction num/den to the nearest integer, ties to even.
function bigRound(num: bigint, den: bigint): bigint {
  let q = num / den;
  const r = num % den;
  const twice = r * 2n;
  if (twice > den) {
    q += 1n;
  } else if (twice === den) {
    if (q % 2n !== 0n) q += 1n;
  }
  return q;
}

// Decompose the magnitude of a finite double into an exact fraction num/den.
function doubleToFraction(value: number): { num: bigint; den: bigint } {
  const buf = new ArrayBuffer(8);
  const dv = new DataView(buf);
  dv.setFloat64(0, value);
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const expBits = (hi >>> 20) & 0x7ff;
  const mantHi = hi & 0xfffff;
  const mantissa = (BigInt(mantHi) << 32n) | BigInt(lo >>> 0);
  if (expBits === 0) {
    // Zero or denormal: value = mantissa * 2^-1074
    return { num: mantissa, den: 1n << 1074n };
  }
  const full = mantissa | (1n << 52n);
  const e = expBits - 1075; // value = full * 2^e
  if (e >= 0) {
    return { num: full << BigInt(e), den: 1n };
  }
  return { num: full, den: 1n << BigInt(-e) };
}

function geExp(num: bigint, den: bigint, e: number): boolean {
  if (e >= 0) return num >= den * pow10(e);
  return num * pow10(-e) >= den;
}

function decimalExponent(absValue: number, num: bigint, den: bigint): number {
  if (absValue === 0) return 0;
  let e = Math.floor(Math.log10(absValue));
  while (!geExp(num, den, e)) e--;
  while (geExp(num, den, e + 1)) e++;
  return e;
}

// Round num/den to p+1 significant digits, given its decimal exponent e0.
function roundDigits(
  num: bigint,
  den: bigint,
  e0: number,
  p: number
): { digits: string; exp: number } {
  const shift = p - e0;
  let rNum: bigint;
  let rDen: bigint;
  if (shift >= 0) {
    rNum = num * pow10(shift);
    rDen = den;
  } else {
    rNum = num;
    rDen = den * pow10(-shift);
  }
  const digitsInt = bigRound(rNum, rDen);
  let digitsStr = digitsInt.toString();
  let exp = e0;
  if (digitsStr.length > p + 1) {
    exp += digitsStr.length - (p + 1);
    digitsStr = digitsStr.slice(0, p + 1);
  } else if (digitsStr.length < p + 1) {
    digitsStr = digitsStr.padStart(p + 1, '0');
  }
  return { digits: digitsStr, exp };
}

// Round num/den to p digits after the decimal point.
function roundFixed(num: bigint, den: bigint, p: number): { intPart: string; fracPart: string } {
  const digitsInt = bigRound(num * pow10(p), den);
  const digitsStr = digitsInt.toString().padStart(p + 1, '0');
  const intPart = digitsStr.slice(0, digitsStr.length - p) || '0';
  const fracPart = p > 0 ? digitsStr.slice(digitsStr.length - p) : '';
  return { intPart, fracPart };
}

function stripTrailingZeros(s: string): string {
  let end = s.length;
  while (end > 0 && s[end - 1] === '0') end--;
  return s.slice(0, end);
}

function assembleFixed(intPart: string, fracPart: string, hash: boolean): string {
  if (fracPart.length === 0) return intPart + (hash ? '.' : '');
  return intPart + '.' + fracPart;
}

function assembleExp(
  first: string,
  rest: string,
  hash: boolean,
  exp: number,
  eChar: string
): string {
  const mant = rest.length === 0 ? first + (hash ? '.' : '') : first + '.' + rest;
  const expSign = exp >= 0 ? '+' : '-';
  const expDigits = Math.abs(exp).toString().padStart(2, '0');
  return mant + eChar + expSign + expDigits;
}

function pad(
  sign: string,
  prefix: string,
  digits: string,
  width: number,
  flagMinus: boolean,
  flagZero: boolean
): string {
  const body = sign + prefix + digits;
  if (body.length >= width) return body;
  const padLen = width - body.length;
  if (flagMinus) return body + ' '.repeat(padLen);
  if (flagZero) return sign + prefix + '0'.repeat(padLen) + digits;
  return ' '.repeat(padLen) + body;
}

function toBigInt(arg: number | bigint | string): bigint {
  if (typeof arg === 'bigint') return arg;
  return BigInt(arg as number);
}

function formatFloatBody(
  absValue: number,
  conv: 'e' | 'E' | 'f' | 'F' | 'g' | 'G',
  precision: number | undefined,
  hash: boolean
): string {
  const { num, den } = doubleToFraction(absValue);
  if (conv === 'f' || conv === 'F') {
    const p = precision === undefined ? 6 : precision;
    const { intPart, fracPart } = roundFixed(num, den, p);
    return assembleFixed(intPart, fracPart, hash);
  }
  if (conv === 'e' || conv === 'E') {
    const p = precision === undefined ? 6 : precision;
    const e0 = decimalExponent(absValue, num, den);
    const { digits, exp } = roundDigits(num, den, e0, p);
    return assembleExp(digits[0], digits.slice(1), hash, exp, conv === 'E' ? 'E' : 'e');
  }
  // g / G
  const P = precision === undefined ? 6 : precision === 0 ? 1 : precision;
  const e0 = decimalExponent(absValue, num, den);
  const { digits, exp: X } = roundDigits(num, den, e0, P - 1);
  const eChar = conv === 'G' ? 'E' : 'e';
  if (P > X && X >= -4) {
    const fp = P - 1 - X;
    const { intPart, fracPart } = roundFixed(num, den, fp);
    const frac = hash ? fracPart : stripTrailingZeros(fracPart);
    return assembleFixed(intPart, frac, hash);
  }
  const first = digits[0];
  let rest = digits.slice(1);
  if (!hash) rest = stripTrailingZeros(rest);
  return assembleExp(first, rest, hash, X, eChar);
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let out = '';
  let argIndex = 0;
  const re = /%([-+ 0#]*)(\d*)(?:\.(\d*))?([diouxXeEfFgGsc%])/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(fmt)) !== null) {
    out += fmt.slice(lastIndex, match.index);
    lastIndex = re.lastIndex;
    const [, flagsStr, widthStr, precisionStr, conv] = match;

    if (conv === '%') {
      out += '%';
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
    const precisionGiven = precisionStr !== undefined;
    const precision = precisionGiven ? (precisionStr === '' ? 0 : parseInt(precisionStr, 10)) : undefined;

    const arg = args[argIndex++];

    if (conv === 'd' || conv === 'i') {
      const n = toBigInt(arg);
      const negative = n < 0n;
      const magnitude = negative ? -n : n;
      const sign = negative ? '-' : flags.plus ? '+' : flags.space ? ' ' : '';
      let digits: string;
      if (precision !== undefined) {
        digits = magnitude === 0n && precision === 0 ? '' : magnitude.toString(10).padStart(precision, '0');
      } else {
        digits = magnitude.toString(10);
      }
      const useZero = flags.zero && !flags.minus && precision === undefined;
      out += pad(sign, '', digits, width, flags.minus, useZero);
      continue;
    }

    if (conv === 'x' || conv === 'X' || conv === 'o') {
      const n = toBigInt(arg);
      const base = conv === 'o' ? 8 : 16;
      let digits: string;
      if (precision !== undefined) {
        digits = n === 0n && precision === 0 ? '' : n.toString(base).padStart(precision, '0');
      } else {
        digits = n.toString(base);
      }
      if (conv === 'X') digits = digits.toUpperCase();
      let prefix = '';
      if (flags.hash) {
        if (conv === 'o') {
          if (digits.length === 0 || digits[0] !== '0') digits = '0' + digits;
        } else if (n !== 0n) {
          prefix = conv === 'X' ? '0X' : '0x';
        }
      }
      const useZero = flags.zero && !flags.minus && precision === undefined;
      out += pad('', prefix, digits, width, flags.minus, useZero);
      continue;
    }

    if (conv === 'e' || conv === 'E' || conv === 'f' || conv === 'F' || conv === 'g' || conv === 'G') {
      const value = arg as number;
      let sign: string;
      let body: string;
      let zeroIgnored: boolean;
      if (Number.isNaN(value)) {
        sign = '';
        body = conv === 'F' || conv === 'E' || conv === 'G' ? 'NAN' : 'nan';
        zeroIgnored = true;
      } else if (!Number.isFinite(value)) {
        const negative = value < 0;
        sign = negative ? '-' : flags.plus ? '+' : flags.space ? ' ' : '';
        body = conv === 'F' || conv === 'E' || conv === 'G' ? 'INF' : 'inf';
        zeroIgnored = true;
      } else {
        const negative = value < 0 || Object.is(value, -0);
        sign = negative ? '-' : flags.plus ? '+' : flags.space ? ' ' : '';
        const absValue = Math.abs(value);
        body = formatFloatBody(absValue, conv, precision, flags.hash);
        zeroIgnored = false;
      }
      const useZero = flags.zero && !flags.minus && !zeroIgnored;
      out += pad(sign, '', body, width, flags.minus, useZero);
      continue;
    }

    if (conv === 's') {
      let s = arg as string;
      if (precision !== undefined) s = s.slice(0, precision);
      out += pad('', '', s, width, flags.minus, false);
      continue;
    }

    if (conv === 'c') {
      const s = arg as string;
      out += pad('', '', s, width, flags.minus, false);
      continue;
    }
  }
  out += fmt.slice(lastIndex);
  return out;
}
