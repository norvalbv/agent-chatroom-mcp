type Opts = {
  flagMinus: boolean;
  flagPlus: boolean;
  flagSpace: boolean;
  flagZero: boolean;
  flagHash: boolean;
  width: number;
  precisionGiven: boolean;
  precision: number | undefined;
};

function padGeneric(str: string, width: number, left: boolean): string {
  if (str.length >= width) return str;
  const fill = ' '.repeat(width - str.length);
  return left ? str + fill : fill + str;
}

function padNumeric(prefix: string, digits: string, width: number, flagMinus: boolean, flagZero: boolean): string {
  const body = prefix + digits;
  if (body.length >= width) return body;
  const fillLen = width - body.length;
  if (flagMinus) return body + ' '.repeat(fillLen);
  if (flagZero) return prefix + '0'.repeat(fillLen) + digits;
  return ' '.repeat(fillLen) + body;
}

function toBigInt(arg: number | bigint | string): bigint {
  return typeof arg === 'bigint' ? arg : BigInt(arg as number);
}

function convDI(arg: number | bigint | string, opts: Opts): string {
  const v = toBigInt(arg);
  const neg = v < 0n;
  const abs = neg ? -v : v;
  let digits = abs.toString(10);
  if (opts.precisionGiven) {
    const p = opts.precision as number;
    if (p === 0 && abs === 0n) digits = '';
    else digits = digits.padStart(p, '0');
  }
  const sign = neg ? '-' : opts.flagPlus ? '+' : opts.flagSpace ? ' ' : '';
  const flagZero = opts.flagZero && !opts.flagMinus && !opts.precisionGiven;
  return padNumeric(sign, digits, opts.width, opts.flagMinus, flagZero);
}

function convXXO(conv: string, arg: number | bigint | string, opts: Opts): string {
  const v = toBigInt(arg);
  const base = conv === 'o' ? 8 : 16;
  let digits = v.toString(base);
  if (conv === 'X') digits = digits.toUpperCase();
  if (opts.precisionGiven) {
    const p = opts.precision as number;
    if (p === 0 && v === 0n) digits = '';
    else digits = digits.padStart(p, '0');
  }
  let prefix = '';
  if (opts.flagHash) {
    if (conv === 'o') {
      if (digits.length === 0 || digits[0] !== '0') digits = '0' + digits;
    } else if (v !== 0n) {
      prefix = conv === 'X' ? '0X' : '0x';
    }
  }
  const flagZero = opts.flagZero && !opts.flagMinus && !opts.precisionGiven;
  return padNumeric(prefix, digits, opts.width, opts.flagMinus, flagZero);
}

function convS(arg: number | bigint | string, opts: Opts): string {
  let s = arg as string;
  if (opts.precisionGiven) s = s.slice(0, opts.precision as number);
  return padGeneric(s, opts.width, opts.flagMinus);
}

function convC(arg: number | bigint | string, opts: Opts): string {
  const s = arg as string;
  return padGeneric(s, opts.width, opts.flagMinus);
}

function decodeDouble(x: number): { neg: boolean; mantissa: bigint; exp: number } {
  const buf = new ArrayBuffer(8);
  const view = new DataView(buf);
  view.setFloat64(0, x);
  const hi = view.getUint32(0);
  const lo = view.getUint32(4);
  const neg = (hi >>> 31) === 1;
  const biasedExp = (hi >>> 20) & 0x7ff;
  const mantHigh = hi & 0xfffff;
  let mantissa = (BigInt(mantHigh) << 32n) | BigInt(lo);
  let exp: number;
  if (biasedExp === 0) {
    exp = -1074;
  } else {
    mantissa |= 1n << 52n;
    exp = biasedExp - 1075;
  }
  return { neg, mantissa, exp };
}

function exactDecimal(mantissa: bigint, exp: number): { intPart: string; fracPart: string } {
  if (mantissa === 0n) return { intPart: '0', fracPart: '' };
  if (exp >= 0) {
    return { intPart: (mantissa << BigInt(exp)).toString(), fracPart: '' };
  }
  const k = -exp;
  const numerator = mantissa * 5n ** BigInt(k);
  let numStr = numerator.toString();
  if (numStr.length <= k) numStr = numStr.padStart(k + 1, '0');
  let intPart = numStr.slice(0, numStr.length - k);
  const fracPart = numStr.slice(numStr.length - k);
  intPart = intPart.replace(/^0+(?=\d)/, '');
  return { intPart, fracPart };
}

function decideRoundUp(remainder: string, lastKeptDigit: string): boolean {
  if (remainder.length === 0) return false;
  const first = remainder[0];
  if (first > '5') return true;
  if (first < '5') return false;
  if (/[1-9]/.test(remainder.slice(1))) return true;
  return parseInt(lastKeptDigit, 10) % 2 === 1;
}

function roundFrac(intPart: string, fracPart: string, fracDigits: number): { intPart: string; fracPart: string } {
  if (fracDigits >= fracPart.length) {
    return { intPart, fracPart: fracPart.padEnd(fracDigits, '0') };
  }
  const kept = fracPart.slice(0, fracDigits);
  const remainder = fracPart.slice(fracDigits);
  let combined = intPart + kept;
  const lastDigit = combined.length ? combined[combined.length - 1] : '0';
  if (decideRoundUp(remainder, lastDigit)) {
    const incremented = (BigInt(combined) + 1n).toString();
    combined = incremented.length > combined.length ? incremented : incremented.padStart(combined.length, '0');
  }
  if (fracDigits === 0) return { intPart: combined, fracPart: '' };
  const total = combined.length;
  const newFrac = combined.slice(total - fracDigits);
  const newInt = combined.slice(0, total - fracDigits) || '0';
  return { intPart: newInt, fracPart: newFrac };
}

function roundSignificant(intPart: string, fracPart: string, s: number): { digits: string; exp: number } {
  const digits = intPart + fracPart;
  const pointPos = intPart.length;
  let i = 0;
  while (i < digits.length && digits[i] === '0') i++;
  if (i === digits.length) {
    return { digits: '0'.repeat(s), exp: 0 };
  }
  let exp = pointPos - 1 - i;
  const avail = digits.length - i;
  let kept: string;
  let remainder: string;
  if (avail <= s) {
    kept = digits.slice(i).padEnd(s, '0');
    remainder = '';
  } else {
    kept = digits.slice(i, i + s);
    remainder = digits.slice(i + s);
  }
  if (decideRoundUp(remainder, kept[kept.length - 1])) {
    const incremented = (BigInt(kept) + 1n).toString();
    if (incremented.length > kept.length) {
      exp += 1;
      kept = incremented.slice(0, s);
    } else {
      kept = incremented.padStart(kept.length, '0');
    }
  }
  return { digits: kept, exp };
}

function specialSign(neg: boolean, opts: Opts): string {
  return neg ? '-' : opts.flagPlus ? '+' : opts.flagSpace ? ' ' : '';
}

function convE(arg: number | bigint | string, opts: Opts, upper: boolean): string {
  const x = arg as number;
  const precision = opts.precisionGiven ? (opts.precision as number) : 6;
  const { neg, mantissa, exp } = decodeDouble(x);
  const isNaN = Number.isNaN(x);
  const isInf = !isNaN && !Number.isFinite(x);
  if (isNaN) return padGeneric(upper ? 'NAN' : 'nan', opts.width, opts.flagMinus);
  if (isInf) {
    const sign = specialSign(neg, opts);
    return padGeneric(sign + (upper ? 'INF' : 'inf'), opts.width, opts.flagMinus);
  }
  const sign = specialSign(neg, opts);
  const { intPart, fracPart } = exactDecimal(mantissa, exp);
  const { digits, exp: E } = roundSignificant(intPart, fracPart, precision + 1);
  const rest = digits.slice(1);
  const fracStr = precision > 0 ? '.' + rest : opts.flagHash ? '.' : '';
  const expSign = E < 0 ? '-' : '+';
  const expDigits = Math.abs(E).toString().padStart(2, '0');
  const body = digits[0] + fracStr + (upper ? 'E' : 'e') + expSign + expDigits;
  const flagZero = opts.flagZero && !opts.flagMinus;
  return padNumeric(sign, body, opts.width, opts.flagMinus, flagZero);
}

function convF(arg: number | bigint | string, opts: Opts, upper: boolean): string {
  const x = arg as number;
  const precision = opts.precisionGiven ? (opts.precision as number) : 6;
  const { neg, mantissa, exp } = decodeDouble(x);
  const isNaN = Number.isNaN(x);
  const isInf = !isNaN && !Number.isFinite(x);
  if (isNaN) return padGeneric(upper ? 'NAN' : 'nan', opts.width, opts.flagMinus);
  if (isInf) {
    const sign = specialSign(neg, opts);
    return padGeneric(sign + (upper ? 'INF' : 'inf'), opts.width, opts.flagMinus);
  }
  const sign = specialSign(neg, opts);
  const exact = exactDecimal(mantissa, exp);
  const { intPart, fracPart } = roundFrac(exact.intPart, exact.fracPart, precision);
  const fracStr = precision > 0 ? '.' + fracPart : opts.flagHash ? '.' : '';
  const body = intPart + fracStr;
  const flagZero = opts.flagZero && !opts.flagMinus;
  return padNumeric(sign, body, opts.width, opts.flagMinus, flagZero);
}

function convG(arg: number | bigint | string, opts: Opts, upper: boolean): string {
  const x = arg as number;
  let P = opts.precisionGiven ? (opts.precision as number) : 6;
  if (P === 0) P = 1;
  const { neg, mantissa, exp } = decodeDouble(x);
  const isNaN = Number.isNaN(x);
  const isInf = !isNaN && !Number.isFinite(x);
  if (isNaN) return padGeneric(upper ? 'NAN' : 'nan', opts.width, opts.flagMinus);
  if (isInf) {
    const sign = specialSign(neg, opts);
    return padGeneric(sign + (upper ? 'INF' : 'inf'), opts.width, opts.flagMinus);
  }
  const sign = specialSign(neg, opts);
  const exact = exactDecimal(mantissa, exp);
  const { digits, exp: X } = roundSignificant(exact.intPart, exact.fracPart, P);
  let body: string;
  if (P > X && X >= -4) {
    const pointPos = X + 1;
    let intPart: string;
    let fracPart: string;
    if (pointPos <= 0) {
      intPart = '0';
      fracPart = '0'.repeat(-pointPos) + digits;
    } else if (pointPos >= digits.length) {
      intPart = digits + '0'.repeat(pointPos - digits.length);
      fracPart = '';
    } else {
      intPart = digits.slice(0, pointPos);
      fracPart = digits.slice(pointPos);
    }
    if (!opts.flagHash) fracPart = fracPart.replace(/0+$/, '');
    body = fracPart.length > 0 ? intPart + '.' + fracPart : opts.flagHash ? intPart + '.' : intPart;
  } else {
    let rest = digits.slice(1);
    if (!opts.flagHash) rest = rest.replace(/0+$/, '');
    const expSign = X < 0 ? '-' : '+';
    const expDigits = Math.abs(X).toString().padStart(2, '0');
    const mantissaStr = rest.length > 0 ? digits[0] + '.' + rest : opts.flagHash ? digits[0] + '.' : digits[0];
    body = mantissaStr + (upper ? 'E' : 'e') + expSign + expDigits;
  }
  const flagZero = opts.flagZero && !opts.flagMinus;
  return padNumeric(sign, body, opts.width, opts.flagMinus, flagZero);
}

function convert(conv: string, arg: number | bigint | string, opts: Opts): string {
  switch (conv) {
    case 'd':
    case 'i':
      return convDI(arg, opts);
    case 'x':
    case 'X':
    case 'o':
      return convXXO(conv, arg, opts);
    case 'e':
      return convE(arg, opts, false);
    case 'E':
      return convE(arg, opts, true);
    case 'f':
      return convF(arg, opts, false);
    case 'F':
      return convF(arg, opts, true);
    case 'g':
      return convG(arg, opts, false);
    case 'G':
      return convG(arg, opts, true);
    case 's':
      return convS(arg, opts);
    case 'c':
      return convC(arg, opts);
    default:
      throw new Error(`unsupported conversion: ${conv}`);
  }
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let argIndex = 0;
  const re = /%([-+0# ]*)(\d*)(?:\.(\d*))?([dioxXeEfFgGsc%])/g;
  return fmt.replace(re, (_match, flagsStr: string, widthStr: string, precStr: string | undefined, conv: string) => {
    if (conv === '%') return '%';
    const arg = args[argIndex++];
    const opts: Opts = {
      flagMinus: flagsStr.includes('-'),
      flagPlus: flagsStr.includes('+'),
      flagSpace: flagsStr.includes(' '),
      flagZero: flagsStr.includes('0'),
      flagHash: flagsStr.includes('#'),
      width: widthStr ? parseInt(widthStr, 10) : 0,
      precisionGiven: precStr !== undefined,
      precision: precStr !== undefined ? (precStr === '' ? 0 : parseInt(precStr, 10)) : undefined,
    };
    return convert(conv, arg, opts);
  });
}
