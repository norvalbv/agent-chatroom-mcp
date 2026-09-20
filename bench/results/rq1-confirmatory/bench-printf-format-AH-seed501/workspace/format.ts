type Flags = {
  minus: boolean;
  plus: boolean;
  space: boolean;
  zero: boolean;
  hash: boolean;
};

function padWidth(prefix: string, digits: string, width: number, minus: boolean, zero: boolean): string {
  const body = prefix + digits;
  if (body.length >= width) return body;
  if (minus) return body.padEnd(width, ' ');
  if (zero) return prefix + digits.padStart(width - prefix.length, '0');
  return body.padStart(width, ' ');
}

function padStr(text: string, width: number, minus: boolean): string {
  if (text.length >= width) return text;
  return minus ? text.padEnd(width, ' ') : text.padStart(width, ' ');
}

function signFor(isNegative: boolean, flags: Flags): string {
  if (isNegative) return '-';
  if (flags.plus) return '+';
  if (flags.space) return ' ';
  return '';
}

function signBitSet(value: number): boolean {
  if (value === 0) return 1 / value < 0;
  return value < 0;
}

// --- exact double -> decimal machinery ---

function decompose(x: number): { mantissa: bigint; binExp: number } {
  const buf = new ArrayBuffer(8);
  const view = new DataView(buf);
  view.setFloat64(0, x);
  const hi = BigInt(view.getUint32(0));
  const lo = BigInt(view.getUint32(4));
  const bits = (hi << 32n) | lo;
  const expField = Number((bits >> 52n) & 0x7ffn);
  const mantField = bits & 0xfffffffffffffn;
  let mantissa: bigint;
  let binExp: number;
  if (expField === 0) {
    mantissa = mantField;
    binExp = -1074;
  } else {
    mantissa = mantField | (1n << 52n);
    binExp = expField - 1075;
  }
  return { mantissa, binExp };
}

function toExactDecimal(x: number): { N: bigint; e10: number } {
  if (x === 0) return { N: 0n, e10: 0 };
  const { mantissa, binExp } = decompose(x);
  if (binExp >= 0) {
    return { N: mantissa << BigInt(binExp), e10: 0 };
  }
  const k = -binExp;
  const N = mantissa * 5n ** BigInt(k);
  return { N, e10: -k };
}

function roundDigitString(s: string, targetLen: number): { str: string; adjust: number } {
  if (s.length <= targetLen) {
    return { str: s.padEnd(targetLen, '0'), adjust: 0 };
  }
  const kept = s.slice(0, targetLen);
  const firstDropped = s[targetLen];
  const restAllZero = /^0*$/.test(s.slice(targetLen + 1));
  let roundUp = false;
  if (firstDropped > '5') roundUp = true;
  else if (firstDropped === '5') {
    if (!restAllZero) roundUp = true;
    else roundUp = (kept.charCodeAt(kept.length - 1) - 48) % 2 === 1;
  }
  if (!roundUp) {
    return { str: kept, adjust: 0 };
  }
  const incremented = (BigInt(kept) + 1n).toString();
  if (incremented.length > targetLen) {
    return { str: incremented.slice(0, targetLen), adjust: incremented.length - targetLen };
  }
  return { str: incremented, adjust: 0 };
}

function roundToSignificant(N: bigint, e10: number, sigCount: number): { digits: string; exp: number } {
  if (N === 0n) {
    return { digits: '0'.repeat(sigCount), exp: 0 };
  }
  const s = N.toString();
  const L = s.length;
  let exp = L - 1 + e10;
  const { str, adjust } = roundDigitString(s, sigCount);
  exp += adjust;
  return { digits: str, exp };
}

function exactDigits(N: bigint, e10: number): { integerPart: string; fractionalPart: string } {
  if (N === 0n) return { integerPart: '0', fractionalPart: '' };
  if (e10 >= 0) {
    return { integerPart: (N * 10n ** BigInt(e10)).toString(), fractionalPart: '' };
  }
  const k = -e10;
  const sN = N.toString();
  if (sN.length <= k) {
    return { integerPart: '0', fractionalPart: '0'.repeat(k - sN.length) + sN };
  }
  return { integerPart: sN.slice(0, sN.length - k), fractionalPart: sN.slice(sN.length - k) };
}

function roundFixed(N: bigint, e10: number, fracDigits: number): { integerPart: string; fractionalPart: string } {
  const { integerPart, fractionalPart } = exactDigits(N, e10);
  if (fractionalPart.length <= fracDigits) {
    return { integerPart, fractionalPart: fractionalPart.padEnd(fracDigits, '0') };
  }
  const firstDropped = fractionalPart[fracDigits];
  const restAllZero = /^0*$/.test(fractionalPart.slice(fracDigits + 1));
  const kept = integerPart + fractionalPart.slice(0, fracDigits);
  let roundUp = false;
  if (firstDropped > '5') roundUp = true;
  else if (firstDropped === '5') {
    if (!restAllZero) roundUp = true;
    else roundUp = (kept.charCodeAt(kept.length - 1) - 48) % 2 === 1;
  }
  const combined = roundUp ? (BigInt(kept) + 1n).toString().padStart(kept.length, '0') : kept;
  const splitPoint = combined.length - fracDigits;
  let intPart = combined.slice(0, splitPoint);
  const fracPart = combined.slice(splitPoint);
  intPart = intPart.replace(/^0+(?=\d)/, '');
  if (intPart === '') intPart = '0';
  return { integerPart: intPart, fractionalPart: fracPart };
}

// --- conversions ---

function convertD(flags: Flags, width: number, precision: number | undefined, arg: number | bigint | string): string {
  const isBig = typeof arg === 'bigint';
  const neg = isBig ? (arg as bigint) < 0n : (arg as number) < 0;
  const mag: bigint = isBig ? (neg ? -(arg as bigint) : (arg as bigint)) : BigInt(Math.abs(arg as number));
  let digits = mag.toString();
  if (precision !== undefined) {
    digits = mag === 0n && precision === 0 ? '' : digits.padStart(precision, '0');
  }
  const sign = signFor(neg, flags);
  const zeroFlagActive = flags.zero && precision === undefined;
  return padWidth(sign, digits, width, flags.minus, zeroFlagActive);
}

function convertBase(conv: 'x' | 'X' | 'o', flags: Flags, width: number, precision: number | undefined, arg: number | bigint | string): string {
  const mag: bigint = typeof arg === 'bigint' ? (arg as bigint) : BigInt(arg as number);
  const base = conv === 'o' ? 8 : 16;
  let digits = mag.toString(base);
  if (conv === 'X') digits = digits.toUpperCase();
  if (precision !== undefined) {
    digits = mag === 0n && precision === 0 ? '' : digits.padStart(precision, '0');
  }
  if (conv === 'o' && flags.hash) {
    if (digits === '' || digits[0] !== '0') digits = '0' + digits;
  }
  let prefix = '';
  if ((conv === 'x' || conv === 'X') && flags.hash && mag !== 0n) {
    prefix = conv === 'x' ? '0x' : '0X';
  }
  const zeroFlagActive = flags.zero && precision === undefined;
  return padWidth(prefix, digits, width, flags.minus, zeroFlagActive);
}

function convertE(flags: Flags, width: number, precision: number | undefined, arg: number | bigint | string, upper: boolean): string {
  const value = arg as number;
  const p = precision === undefined ? 6 : precision;
  if (Number.isNaN(value)) {
    return padWidth('', upper ? 'NAN' : 'nan', width, flags.minus, false);
  }
  const neg = signBitSet(value);
  const sign = neg ? '-' : flags.plus ? '+' : flags.space ? ' ' : '';
  if (!Number.isFinite(value)) {
    return padWidth(sign, upper ? 'INF' : 'inf', width, flags.minus, false);
  }
  const mag = Math.abs(value);
  const { N, e10 } = toExactDecimal(mag);
  const { digits, exp } = roundToSignificant(N, e10, p + 1);
  const first = digits[0];
  const frac = digits.slice(1);
  let mantissa = first;
  if (p > 0) mantissa += '.' + frac;
  else if (flags.hash) mantissa += '.';
  const expSign = exp < 0 ? '-' : '+';
  const expDigits = Math.abs(exp).toString().padStart(2, '0');
  const body = mantissa + (upper ? 'E' : 'e') + expSign + expDigits;
  return padWidth(sign, body, width, flags.minus, flags.zero);
}

function convertF(flags: Flags, width: number, precision: number | undefined, arg: number | bigint | string, upper: boolean): string {
  const value = arg as number;
  const p = precision === undefined ? 6 : precision;
  if (Number.isNaN(value)) {
    return padWidth('', upper ? 'NAN' : 'nan', width, flags.minus, false);
  }
  const neg = signBitSet(value);
  const sign = neg ? '-' : flags.plus ? '+' : flags.space ? ' ' : '';
  if (!Number.isFinite(value)) {
    return padWidth(sign, upper ? 'INF' : 'inf', width, flags.minus, false);
  }
  const mag = Math.abs(value);
  const { N, e10 } = toExactDecimal(mag);
  const { integerPart, fractionalPart } = roundFixed(N, e10, p);
  let mantissa = integerPart;
  if (p > 0) mantissa += '.' + fractionalPart;
  else if (flags.hash) mantissa += '.';
  return padWidth(sign, mantissa, width, flags.minus, flags.zero);
}

function convertG(flags: Flags, width: number, precision: number | undefined, arg: number | bigint | string, upper: boolean): string {
  const value = arg as number;
  const P = precision === undefined ? 6 : precision === 0 ? 1 : precision;
  if (Number.isNaN(value)) {
    return padWidth('', upper ? 'NAN' : 'nan', width, flags.minus, false);
  }
  const neg = signBitSet(value);
  const sign = neg ? '-' : flags.plus ? '+' : flags.space ? ' ' : '';
  if (!Number.isFinite(value)) {
    return padWidth(sign, upper ? 'INF' : 'inf', width, flags.minus, false);
  }
  const mag = Math.abs(value);
  const { N, e10 } = toExactDecimal(mag);
  const { digits, exp: X } = roundToSignificant(N, e10, P);
  let body: string;
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
    if (!flags.hash) fracPart = fracPart.replace(/0+$/, '');
    body = fracPart.length > 0 ? intPart + '.' + fracPart : flags.hash ? intPart + '.' : intPart;
  } else {
    const first = digits[0];
    let frac = digits.slice(1);
    if (!flags.hash) frac = frac.replace(/0+$/, '');
    const mantissa = frac.length > 0 ? first + '.' + frac : flags.hash ? first + '.' : first;
    const expSign = X < 0 ? '-' : '+';
    const expDigits = Math.abs(X).toString().padStart(2, '0');
    body = mantissa + (upper ? 'E' : 'e') + expSign + expDigits;
  }
  return padWidth(sign, body, width, flags.minus, flags.zero);
}

function convertS(flags: Flags, width: number, precision: number | undefined, arg: number | bigint | string): string {
  let text = arg as string;
  if (precision !== undefined) text = text.slice(0, precision);
  return padStr(text, width, flags.minus);
}

function convertC(flags: Flags, width: number, arg: number | bigint | string): string {
  return padStr(arg as string, width, flags.minus);
}

function convert(conv: string, flags: Flags, width: number, precision: number | undefined, arg: number | bigint | string): string {
  switch (conv) {
    case 'd':
    case 'i':
      return convertD(flags, width, precision, arg);
    case 'x':
      return convertBase('x', flags, width, precision, arg);
    case 'X':
      return convertBase('X', flags, width, precision, arg);
    case 'o':
      return convertBase('o', flags, width, precision, arg);
    case 'e':
      return convertE(flags, width, precision, arg, false);
    case 'E':
      return convertE(flags, width, precision, arg, true);
    case 'f':
      return convertF(flags, width, precision, arg, false);
    case 'F':
      return convertF(flags, width, precision, arg, true);
    case 'g':
      return convertG(flags, width, precision, arg, false);
    case 'G':
      return convertG(flags, width, precision, arg, true);
    case 's':
      return convertS(flags, width, precision, arg);
    case 'c':
      return convertC(flags, width, arg);
    default:
      throw new Error(`unsupported conversion: ${conv}`);
  }
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  const re = /%([-+0 #]*)(\d*)(?:\.(\d*))?([diouxXeEfFgGsc%])/g;
  let result = '';
  let lastIndex = 0;
  let argIndex = 0;
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
    result += convert(conv, flags, width, precision, arg);
  }
  result += fmt.slice(lastIndex);
  return result;
}
