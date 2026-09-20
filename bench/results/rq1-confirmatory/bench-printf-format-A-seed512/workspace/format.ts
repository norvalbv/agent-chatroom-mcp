function exactDecimal(x: number): { intPart: bigint; frac: string } {
  if (x === 0) return { intPart: 0n, frac: '' };
  const buf = new ArrayBuffer(8);
  const dv = new DataView(buf);
  dv.setFloat64(0, x);
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const expBits = (hi >>> 20) & 0x7ff;
  const mantHi = BigInt(hi & 0xfffff);
  const mantLo = BigInt(lo);
  let mantissa = (mantHi << 32n) | mantLo;
  let exponent: number;
  if (expBits === 0) {
    exponent = -1074;
  } else {
    exponent = expBits - 1075;
    mantissa = mantissa | (1n << 52n);
  }
  if (exponent >= 0) {
    return { intPart: mantissa << BigInt(exponent), frac: '' };
  }
  const e = -exponent;
  const numerator = mantissa * 5n ** BigInt(e);
  const denom = 10n ** BigInt(e);
  const intPart = numerator / denom;
  const rem = numerator % denom;
  const frac = rem.toString().padStart(e, '0');
  return { intPart, frac };
}

function decideRoundUp(tail: string, lastDigitChar: string): boolean {
  const threshold = '5' + '0'.repeat(tail.length - 1);
  if (tail < threshold) return false;
  if (tail > threshold) return true;
  return parseInt(lastDigitChar, 10) % 2 === 1;
}

function roundFraction(intPart: bigint, frac: string, keep: number): { intPart: bigint; frac: string } {
  if (keep >= frac.length) {
    return { intPart, frac: frac.padEnd(keep, '0') };
  }
  const kept = frac.slice(0, keep);
  const tail = frac.slice(keep);
  const lastDigitChar = keep > 0 ? kept[kept.length - 1] : intPart.toString().slice(-1);
  const roundUp = decideRoundUp(tail, lastDigitChar);
  if (!roundUp) {
    return { intPart, frac: kept };
  }
  const combined = intPart.toString() + kept;
  const incremented = (BigInt(combined) + 1n).toString().padStart(combined.length, '0');
  const newLen = incremented.length;
  const fracLen = keep;
  const intLen = newLen - fracLen;
  const newFrac = fracLen > 0 ? incremented.slice(newLen - fracLen) : '';
  const newIntStr = incremented.slice(0, intLen);
  return { intPart: BigInt(newIntStr === '' ? '0' : newIntStr), frac: newFrac };
}

function roundSignificant(digits: string, keep: number): { digits: string; expInc: number } {
  if (keep >= digits.length) {
    return { digits: digits.padEnd(keep, '0'), expInc: 0 };
  }
  const kept = digits.slice(0, keep);
  const tail = digits.slice(keep);
  const lastDigitChar = kept[kept.length - 1];
  const roundUp = decideRoundUp(tail, lastDigitChar);
  if (!roundUp) {
    return { digits: kept, expInc: 0 };
  }
  const incBig = BigInt(kept) + 1n;
  let incStr = incBig.toString();
  if (incStr.length > keep) {
    return { digits: incStr.slice(0, keep), expInc: 1 };
  }
  incStr = incStr.padStart(keep, '0');
  return { digits: incStr, expInc: 0 };
}

function getSignificant(intPart: bigint, frac: string, keep: number): { digits: string; exp: number } {
  let digits: string;
  let exp: number;
  if (intPart !== 0n) {
    const s = intPart.toString();
    exp = s.length - 1;
    digits = s + frac;
  } else {
    let j = 0;
    while (j < frac.length && frac[j] === '0') j++;
    if (j === frac.length) {
      return { digits: '0'.repeat(keep), exp: 0 };
    }
    exp = -(j + 1);
    digits = frac.slice(j);
  }
  const rounded = roundSignificant(digits, keep);
  return { digits: rounded.digits, exp: exp + rounded.expInc };
}

function pad(str: string, width: number, leftAlign: boolean): string {
  if (str.length >= width) return str;
  const padding = ' '.repeat(width - str.length);
  return leftAlign ? str + padding : padding + str;
}

function padNumeric(prefix: string, digits: string, width: number, leftAlign: boolean, zeroFlag: boolean): string {
  const total = prefix.length + digits.length;
  if (zeroFlag && !leftAlign && total < width) {
    return prefix + '0'.repeat(width - total) + digits;
  }
  return pad(prefix + digits, width, leftAlign);
}

function formatIntDigits(magnitude: bigint, base: number, precision: number | null): string {
  let digits = magnitude.toString(base);
  if (magnitude === 0n && precision === 0) return '';
  if (precision !== null && digits.length < precision) {
    digits = '0'.repeat(precision - digits.length) + digits;
  }
  return digits;
}

function formatFloat(
  conv: string,
  flags: Set<string>,
  width: number,
  precision: number | null,
  x: number
): string {
  const leftAlign = flags.has('-');
  const zeroFlag = flags.has('0');
  const plusFlag = flags.has('+');
  const spaceFlag = flags.has(' ');
  const hashFlag = flags.has('#');
  const upper = conv === 'F' || conv === 'E' || conv === 'G';
  const isNegative = x < 0 || Object.is(x, -0);
  const sign = isNegative ? '-' : plusFlag ? '+' : spaceFlag ? ' ' : '';

  if (Number.isNaN(x)) {
    const word = upper ? 'NAN' : 'nan';
    return pad(word, width, leftAlign);
  }
  if (!Number.isFinite(x)) {
    const word = upper ? 'INF' : 'inf';
    return pad(sign + word, width, leftAlign);
  }

  const magnitude = Math.abs(x);
  const { intPart, frac } = exactDecimal(magnitude);
  const useZero = zeroFlag && !leftAlign;

  if (conv === 'f' || conv === 'F') {
    const p = precision === null ? 6 : precision;
    const { intPart: ri, frac: rf } = roundFraction(intPart, frac, p);
    let numStr = ri.toString();
    if (p > 0 || hashFlag) numStr += '.' + rf;
    return padNumeric(sign, numStr, width, leftAlign, useZero);
  }

  if (conv === 'e' || conv === 'E') {
    const p = precision === null ? 6 : precision;
    const { digits, exp } = getSignificant(intPart, frac, p + 1);
    let mantissa = digits[0];
    const rest = digits.slice(1);
    if (p > 0 || hashFlag) mantissa += '.' + rest;
    const eChar = conv === 'E' ? 'E' : 'e';
    const expSign = exp < 0 ? '-' : '+';
    const expAbs = Math.abs(exp).toString().padStart(2, '0');
    const numStr = mantissa + eChar + expSign + expAbs;
    return padNumeric(sign, numStr, width, leftAlign, useZero);
  }

  // g, G
  let p = precision === null ? 6 : precision;
  if (p === 0) p = 1;
  const sig = getSignificant(intPart, frac, p);
  const X = sig.exp;
  let numStr: string;
  if (p > X && X >= -4) {
    const fPrec = p - 1 - X;
    const { intPart: ri, frac: rf } = roundFraction(intPart, frac, fPrec);
    const intStr = ri.toString();
    let fracStr = rf;
    if (!hashFlag) {
      fracStr = fracStr.replace(/0+$/, '');
    }
    numStr = fracStr.length > 0 || hashFlag ? intStr + '.' + fracStr : intStr;
  } else {
    const digits = sig.digits;
    const exp = sig.exp;
    const mantissaDigit = digits[0];
    let rest = digits.slice(1);
    if (!hashFlag) {
      rest = rest.replace(/0+$/, '');
    }
    const eChar = conv === 'G' ? 'E' : 'e';
    const expSign = exp < 0 ? '-' : '+';
    const expAbs = Math.abs(exp).toString().padStart(2, '0');
    const mantStr = rest.length > 0 || hashFlag ? mantissaDigit + '.' + rest : mantissaDigit;
    numStr = mantStr + eChar + expSign + expAbs;
  }
  return padNumeric(sign, numStr, width, leftAlign, useZero);
}

function formatOne(
  conv: string,
  flags: Set<string>,
  width: number,
  precision: number | null,
  arg: number | bigint | string
): string {
  const leftAlign = flags.has('-');
  const zeroFlag = flags.has('0');
  const plusFlag = flags.has('+');
  const spaceFlag = flags.has(' ');
  const hashFlag = flags.has('#');

  switch (conv) {
    case 'd':
    case 'i': {
      const v = typeof arg === 'bigint' ? arg : BigInt(arg as number);
      const neg = v < 0n;
      const magnitude = neg ? -v : v;
      const digits = formatIntDigits(magnitude, 10, precision);
      const sign = neg ? '-' : plusFlag ? '+' : spaceFlag ? ' ' : '';
      const useZero = zeroFlag && !leftAlign && precision === null;
      return padNumeric(sign, digits, width, leftAlign, useZero);
    }
    case 'x':
    case 'X':
    case 'o': {
      const v = typeof arg === 'bigint' ? arg : BigInt(arg as number);
      let digits = formatIntDigits(v, conv === 'o' ? 8 : 16, precision);
      if (conv === 'X') digits = digits.toUpperCase();
      let prefix = '';
      if (hashFlag) {
        if (conv === 'o') {
          if (digits.length === 0 || digits[0] !== '0') digits = '0' + digits;
        } else if (v !== 0n) {
          prefix = conv === 'x' ? '0x' : '0X';
        }
      }
      const useZero = zeroFlag && !leftAlign && precision === null;
      return padNumeric(prefix, digits, width, leftAlign, useZero);
    }
    case 's': {
      let s = arg as string;
      if (precision !== null) s = s.slice(0, precision);
      return pad(s, width, leftAlign);
    }
    case 'c': {
      const s = arg as string;
      return pad(s, width, leftAlign);
    }
    case 'e':
    case 'E':
    case 'f':
    case 'F':
    case 'g':
    case 'G':
      return formatFloat(conv, flags, width, precision, arg as number);
    default:
      throw new Error(`Unsupported conversion: ${conv}`);
  }
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let argIndex = 0;
  const regex = /%([-+ 0#]*)(\d*)(?:\.(\d*))?([a-zA-Z%])/g;
  let result = '';
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(fmt)) !== null) {
    result += fmt.slice(lastIndex, match.index);
    lastIndex = regex.lastIndex;
    const [, flagsStr, widthStr, precStr, conv] = match;
    if (conv === '%') {
      result += '%';
      continue;
    }
    const flags = new Set(flagsStr.split(''));
    const width = widthStr ? parseInt(widthStr, 10) : 0;
    const precision = precStr !== undefined ? (precStr === '' ? 0 : parseInt(precStr, 10)) : null;
    const arg = args[argIndex++];
    result += formatOne(conv, flags, width, precision, arg);
  }
  result += fmt.slice(lastIndex);
  return result;
}
