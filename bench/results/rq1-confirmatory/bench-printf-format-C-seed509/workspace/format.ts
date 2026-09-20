function pow10(n: number): bigint {
  return 10n ** BigInt(n);
}

function numDigits(n: bigint): number {
  return n.toString().length;
}

function roundHalfEven(num: bigint, den: bigint): bigint {
  const q = num / den;
  const r = num % den;
  const twice = r * 2n;
  if (twice > den) return q + 1n;
  if (twice < den) return q;
  return q % 2n === 0n ? q : q + 1n;
}

function scaleRound(num: bigint, den: bigint, shift: number): bigint {
  if (shift >= 0) {
    return roundHalfEven(num * pow10(shift), den);
  }
  return roundHalfEven(num, den * pow10(-shift));
}

function cmpToPow(num: bigint, den: bigint, k: number): number {
  if (k >= 0) {
    const rhs = den * pow10(k);
    return num > rhs ? 1 : num < rhs ? -1 : 0;
  }
  const lhs = num * pow10(-k);
  return lhs > den ? 1 : lhs < den ? -1 : 0;
}

function findExponent(num: bigint, den: bigint): number {
  let x = numDigits(num) - numDigits(den);
  while (cmpToPow(num, den, x + 1) >= 0) x++;
  while (cmpToPow(num, den, x) < 0) x--;
  return x;
}

function toRational(x: number): { num: bigint; den: bigint } {
  if (x === 0) return { num: 0n, den: 1n };
  const buf = new ArrayBuffer(8);
  const view = new DataView(buf);
  view.setFloat64(0, x);
  const hi = view.getUint32(0);
  const lo = view.getUint32(4);
  const expBits = (hi >>> 20) & 0x7ff;
  const mantHi = hi & 0xfffff;
  const mantissa = (BigInt(mantHi) << 32n) | BigInt(lo);
  let num: bigint;
  let exponent: number;
  if (expBits === 0) {
    num = mantissa;
    exponent = -1074;
  } else {
    num = mantissa | (1n << 52n);
    exponent = expBits - 1075;
  }
  if (exponent >= 0) {
    return { num: num << BigInt(exponent), den: 1n };
  }
  return { num, den: 1n << BigInt(-exponent) };
}

interface Flags {
  minus: boolean;
  plus: boolean;
  space: boolean;
  zero: boolean;
  hash: boolean;
}

function padNumeric(
  sign: string,
  prefix: string,
  digits: string,
  width: number,
  zeroFlag: boolean,
  minusFlag: boolean
): string {
  const core = sign + prefix + digits;
  if (core.length >= width) return core;
  const padLen = width - core.length;
  if (minusFlag) return core + ' '.repeat(padLen);
  if (zeroFlag) return sign + prefix + '0'.repeat(padLen) + digits;
  return ' '.repeat(padLen) + core;
}

function toBigIntArg(arg: number | bigint | string): bigint {
  return typeof arg === 'bigint' ? arg : BigInt(arg as number);
}

function formatDI(flags: Flags, width: number, precision: number | undefined, arg: number | bigint | string): string {
  const value = toBigIntArg(arg);
  const negative = value < 0n;
  const magnitude = negative ? -value : value;
  let digits: string;
  if (precision !== undefined && precision === 0 && magnitude === 0n) {
    digits = '';
  } else {
    digits = magnitude.toString();
    if (precision !== undefined) digits = digits.padStart(precision, '0');
  }
  const sign = negative ? '-' : flags.plus ? '+' : flags.space ? ' ' : '';
  const zeroFlag = flags.zero && !flags.minus && precision === undefined;
  return padNumeric(sign, '', digits, width, zeroFlag, flags.minus);
}

function formatXXO(conv: string, flags: Flags, width: number, precision: number | undefined, arg: number | bigint | string): string {
  const value = toBigIntArg(arg);
  const base = conv === 'o' ? 8 : 16;
  let digits = value.toString(base);
  if (conv === 'X') digits = digits.toUpperCase();
  if (precision !== undefined && precision === 0 && value === 0n) {
    digits = '';
  } else if (precision !== undefined) {
    digits = digits.padStart(precision, '0');
  }
  let prefix = '';
  if (flags.hash) {
    if (conv === 'x' || conv === 'X') {
      if (value !== 0n) prefix = conv === 'x' ? '0x' : '0X';
    } else if (conv === 'o') {
      if (digits.length === 0 || digits[0] !== '0') digits = '0' + digits;
    }
  }
  const zeroFlag = flags.zero && !flags.minus && precision === undefined;
  return padNumeric('', prefix, digits, width, zeroFlag, flags.minus);
}

function signFor(value: number, isNaNVal: boolean, flags: Flags): string {
  if (isNaNVal) return '';
  const negative = value < 0 || Object.is(value, -0);
  if (negative) return '-';
  if (flags.plus) return '+';
  if (flags.space) return ' ';
  return '';
}

function formatFfixed(num: bigint, den: bigint, precision: number): { intPart: string; fracPart: string } {
  const r = scaleRound(num, den, precision);
  let s = r.toString();
  if (s.length <= precision) s = '0'.repeat(precision + 1 - s.length) + s;
  const intPart = precision > 0 ? s.slice(0, s.length - precision) : s;
  const fracPart = precision > 0 ? s.slice(s.length - precision) : '';
  return { intPart, fracPart };
}

function formatEsig(num: bigint, den: bigint, precision: number): { digits: string; exponent: number } {
  if (num === 0n) {
    return { digits: '0'.repeat(precision + 1), exponent: 0 };
  }
  let x = findExponent(num, den);
  let scaled = scaleRound(num, den, precision - x);
  let sdigits = scaled.toString();
  if (sdigits.length === precision + 2) {
    x += 1;
    scaled = scaled / 10n;
    sdigits = scaled.toString();
  }
  sdigits = sdigits.padStart(precision + 1, '0');
  return { digits: sdigits, exponent: x };
}

function formatEFCommon(conv: string, flags: Flags, width: number, precision: number | undefined, arg: number | bigint | string): string {
  const value = Number(arg);
  const isUpper = conv === conv.toUpperCase();
  if (Number.isNaN(value)) {
    const word = isUpper ? 'NAN' : 'nan';
    return padNumeric('', '', word, width, false, flags.minus);
  }
  const sign = signFor(value, false, flags);
  if (!Number.isFinite(value)) {
    const word = isUpper ? 'INF' : 'inf';
    return padNumeric(sign, '', word, width, false, flags.minus);
  }
  const absValue = Math.abs(value);
  const { num, den } = toRational(absValue);
  const zeroFlag = flags.zero && !flags.minus;

  if (conv === 'f' || conv === 'F') {
    const p = precision === undefined ? 6 : precision;
    const { intPart, fracPart } = formatFfixed(num, den, p);
    const dot = p > 0 || flags.hash ? '.' : '';
    const digits = intPart + dot + fracPart;
    return padNumeric(sign, '', digits, width, zeroFlag, flags.minus);
  }

  // e, E
  const p = precision === undefined ? 6 : precision;
  const { digits: sdigits, exponent } = formatEsig(num, den, p);
  const d0 = sdigits[0];
  const rest = sdigits.slice(1);
  const dot = p > 0 || flags.hash ? '.' : '';
  const expLetter = conv === 'E' ? 'E' : 'e';
  const expSign = exponent < 0 ? '-' : '+';
  const expAbs = Math.abs(exponent).toString().padStart(2, '0');
  const digits = d0 + dot + rest + expLetter + expSign + expAbs;
  return padNumeric(sign, '', digits, width, zeroFlag, flags.minus);
}

function formatG(conv: string, flags: Flags, width: number, precision: number | undefined, arg: number | bigint | string): string {
  const value = Number(arg);
  const isUpper = conv === 'G';
  if (Number.isNaN(value)) {
    const word = isUpper ? 'NAN' : 'nan';
    return padNumeric('', '', word, width, false, flags.minus);
  }
  const sign = signFor(value, false, flags);
  if (!Number.isFinite(value)) {
    const word = isUpper ? 'INF' : 'inf';
    return padNumeric(sign, '', word, width, false, flags.minus);
  }
  let P = precision === undefined ? 6 : precision;
  if (P === 0) P = 1;
  const absValue = Math.abs(value);
  const { num, den } = toRational(absValue);
  const zeroFlag = flags.zero && !flags.minus;

  const { digits: sdigits, exponent: X } = formatEsig(num, den, P - 1);

  let mantissaDigits: string;
  let fracDigits: string;
  let useE: boolean;

  if (P > X && X >= -4) {
    useE = false;
    const fp = P - 1 - X;
    const { intPart, fracPart } = formatFfixed(num, den, fp);
    mantissaDigits = intPart;
    fracDigits = fracPart;
  } else {
    useE = true;
    mantissaDigits = sdigits[0];
    fracDigits = sdigits.slice(1);
  }

  if (!flags.hash) {
    fracDigits = fracDigits.replace(/0+$/, '');
  }
  const dot = fracDigits.length > 0 || flags.hash ? '.' : '';

  let digits = mantissaDigits + dot + fracDigits;
  if (useE) {
    const expLetter = isUpper ? 'E' : 'e';
    const expSign = X < 0 ? '-' : '+';
    const expAbs = Math.abs(X).toString().padStart(2, '0');
    digits += expLetter + expSign + expAbs;
  }
  return padNumeric(sign, '', digits, width, zeroFlag, flags.minus);
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
    const width = widthStr ? parseInt(widthStr, 10) : 0;
    const precision = precStr !== undefined ? (precStr === '' ? 0 : parseInt(precStr, 10)) : undefined;
    const arg = args[argIndex++];

    switch (conv) {
      case 'd':
      case 'i':
        result += formatDI(flags, width, precision, arg);
        break;
      case 'x':
      case 'X':
      case 'o':
        result += formatXXO(conv, flags, width, precision, arg);
        break;
      case 'e':
      case 'E':
      case 'f':
      case 'F':
        result += formatEFCommon(conv, flags, width, precision, arg);
        break;
      case 'g':
      case 'G':
        result += formatG(conv, flags, width, precision, arg);
        break;
      case 's': {
        let str = arg as string;
        if (precision !== undefined) str = str.slice(0, precision);
        result += flags.minus ? str.padEnd(width, ' ') : str.padStart(width, ' ');
        break;
      }
      case 'c': {
        const str = arg as string;
        result += flags.minus ? str.padEnd(width, ' ') : str.padStart(width, ' ');
        break;
      }
    }
  }
  result += fmt.slice(lastIndex);
  return result;
}
