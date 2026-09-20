type Flags = {
  minus: boolean;
  plus: boolean;
  space: boolean;
  zero: boolean;
  hash: boolean;
};

function toFraction(absX: number): { numerator: bigint; E: number } {
  if (absX === 0) return { numerator: 0n, E: 0 };
  const buf = new ArrayBuffer(8);
  const dv = new DataView(buf);
  dv.setFloat64(0, absX);
  const bits = dv.getBigUint64(0);
  const expBits = (bits >> 52n) & 0x7ffn;
  const mantissaBits = bits & 0xfffffffffffffn;
  let M: bigint;
  let E2: number;
  if (expBits === 0n) {
    M = mantissaBits;
    E2 = -1074;
  } else {
    M = mantissaBits | (1n << 52n);
    E2 = Number(expBits) - 1075;
  }
  if (E2 >= 0) {
    return { numerator: M << BigInt(E2), E: 0 };
  }
  return { numerator: M * 5n ** BigInt(-E2), E: E2 };
}

function roundDivPow10(num: bigint, k: number): bigint {
  const div = 10n ** BigInt(k);
  const q = num / div;
  const r = num % div;
  const twice = r * 2n;
  if (twice > div) return q + 1n;
  if (twice < div) return q;
  return q % 2n === 0n ? q : q + 1n;
}

function formatFixedDigits(
  numerator: bigint,
  E: number,
  precision: number,
): { intPart: string; fracPart: string } {
  const shift = E + precision;
  let scaled: bigint;
  if (shift >= 0) {
    scaled = numerator * 10n ** BigInt(shift);
  } else {
    scaled = roundDivPow10(numerator, -shift);
  }
  const s = scaled.toString();
  if (precision === 0) return { intPart: s, fracPart: '' };
  const padded = s.padStart(precision + 1, '0');
  return {
    intPart: padded.slice(0, padded.length - precision),
    fracPart: padded.slice(padded.length - precision),
  };
}

function formatExpDigits(
  numerator: bigint,
  E: number,
  precision: number,
): { digit0: string; frac: string; exp: number } {
  if (numerator === 0n) {
    return { digit0: '0', frac: '0'.repeat(precision), exp: 0 };
  }
  const ndStr = numerator.toString();
  const nd = ndStr.length;
  const guessExp = nd - 1 + E;
  const targetDigits = precision + 1;
  let sigStr: string;
  if (nd > targetDigits) {
    sigStr = roundDivPow10(numerator, nd - targetDigits).toString();
  } else if (nd < targetDigits) {
    sigStr = ndStr + '0'.repeat(targetDigits - nd);
  } else {
    sigStr = ndStr;
  }
  let exp = guessExp;
  if (sigStr.length === targetDigits + 1) {
    sigStr = sigStr.slice(0, targetDigits);
    exp += 1;
  }
  return { digit0: sigStr[0], frac: sigStr.slice(1), exp };
}

function formatE(
  absX: number,
  precision: number,
  upper: boolean,
  forcePoint: boolean,
): string {
  const { numerator, E } = toFraction(absX);
  const { digit0, frac, exp } = formatExpDigits(numerator, E, precision);
  let s = digit0;
  if (precision > 0 || forcePoint) s += '.' + frac;
  const expSign = exp < 0 ? '-' : '+';
  const expAbs = Math.abs(exp).toString().padStart(2, '0');
  s += (upper ? 'E' : 'e') + expSign + expAbs;
  return s;
}

function formatF(absX: number, precision: number, forcePoint: boolean): string {
  const { numerator, E } = toFraction(absX);
  const { intPart, fracPart } = formatFixedDigits(numerator, E, precision);
  let s = intPart;
  if (precision > 0 || forcePoint) s += '.' + fracPart;
  return s;
}

function trimTrailingZeros(s: string, usedE: boolean): string {
  if (usedE) {
    const idx = s.search(/[eE]/);
    const mantissa = s.slice(0, idx);
    const rest = s.slice(idx);
    return trimPlain(mantissa) + rest;
  }
  return trimPlain(s);
}

function trimPlain(s: string): string {
  if (!s.includes('.')) return s;
  s = s.replace(/0+$/, '');
  s = s.replace(/\.$/, '');
  return s;
}

function formatG(
  absX: number,
  P: number,
  upper: boolean,
  hashFlag: boolean,
): string {
  let X: number;
  if (absX === 0) {
    X = 0;
  } else {
    const { numerator, E } = toFraction(absX);
    X = formatExpDigits(numerator, E, P - 1).exp;
  }
  let body: string;
  let usedE: boolean;
  if (P > X && X >= -4) {
    usedE = false;
    body = formatF(absX, P - 1 - X, true);
  } else {
    usedE = true;
    body = formatE(absX, P - 1, upper, true);
  }
  if (!hashFlag) {
    body = trimTrailingZeros(body, usedE);
  }
  return body;
}

function padNumeric(
  signPrefix: string,
  digits: string,
  width: number,
  leftAlign: boolean,
  zeroPad: boolean,
): string {
  const core = signPrefix + digits;
  if (core.length >= width) return core;
  if (leftAlign) return core + ' '.repeat(width - core.length);
  if (zeroPad) return signPrefix + '0'.repeat(width - core.length) + digits;
  return ' '.repeat(width - core.length) + core;
}

function pad(str: string, width: number, leftAlign: boolean): string {
  if (str.length >= width) return str;
  return leftAlign
    ? str + ' '.repeat(width - str.length)
    : ' '.repeat(width - str.length) + str;
}

function bigAbs(value: number | bigint): { big: bigint; neg: boolean } {
  if (typeof value === 'bigint') {
    return { big: value < 0n ? -value : value, neg: value < 0n };
  }
  return {
    big: BigInt(Math.trunc(Math.abs(value))),
    neg: value < 0 || Object.is(value, -0),
  };
}

function convertD(
  value: number | bigint,
  flags: Flags,
  width: number,
  precision: number | undefined,
): string {
  const { big, neg } = bigAbs(value);
  let digits = big.toString(10);
  if (precision !== undefined) {
    digits = digits.padStart(precision, '0');
    if (precision === 0 && big === 0n) digits = '';
  }
  const sign = neg ? '-' : flags.plus ? '+' : flags.space ? ' ' : '';
  const zeroPad = flags.zero && !flags.minus && precision === undefined;
  return padNumeric(sign, digits, width, flags.minus, zeroPad);
}

function convertHex(
  value: number | bigint,
  upper: boolean,
  flags: Flags,
  width: number,
  precision: number | undefined,
): string {
  const { big } = bigAbs(value);
  let digits = big.toString(16);
  if (precision !== undefined) {
    digits = digits.padStart(precision, '0');
    if (precision === 0 && big === 0n) digits = '';
  }
  if (upper) digits = digits.toUpperCase();
  const prefix = flags.hash && big !== 0n ? (upper ? '0X' : '0x') : '';
  const zeroPad = flags.zero && !flags.minus && precision === undefined;
  return padNumeric(prefix, digits, width, flags.minus, zeroPad);
}

function convertOctal(
  value: number | bigint,
  flags: Flags,
  width: number,
  precision: number | undefined,
): string {
  const { big } = bigAbs(value);
  let digits = big.toString(8);
  if (precision !== undefined) {
    digits = digits.padStart(precision, '0');
    if (precision === 0 && big === 0n) digits = '';
  }
  if (flags.hash) {
    if (digits.length === 0 || digits[0] !== '0') digits = '0' + digits;
  }
  const zeroPad = flags.zero && !flags.minus && precision === undefined;
  return padNumeric('', digits, width, flags.minus, zeroPad);
}

function convertFloat(
  conv: string,
  value: number,
  flags: Flags,
  width: number,
  precision: number | undefined,
): string {
  const upper = conv === conv.toUpperCase();
  const isNaNv = Number.isNaN(value);
  const isInf = !Number.isFinite(value) && !isNaNv;
  const negSign = value < 0 || Object.is(value, -0);

  let body: string;
  let zeroPad: boolean;

  if (isNaNv) {
    body = upper ? 'NAN' : 'nan';
    zeroPad = false;
  } else if (isInf) {
    body = upper ? 'INF' : 'inf';
    zeroPad = false;
  } else {
    const abs = Math.abs(value);
    if (conv === 'e' || conv === 'E') {
      const p = precision === undefined ? 6 : precision;
      body = formatE(abs, p, upper, flags.hash);
    } else if (conv === 'f' || conv === 'F') {
      const p = precision === undefined ? 6 : precision;
      body = formatF(abs, p, flags.hash);
    } else {
      let P = precision === undefined ? 6 : precision;
      if (P === 0) P = 1;
      body = formatG(abs, P, upper, flags.hash);
    }
    zeroPad = flags.zero && !flags.minus;
  }

  const sign = isNaNv
    ? ''
    : negSign
      ? '-'
      : flags.plus
        ? '+'
        : flags.space
          ? ' '
          : '';
  return padNumeric(sign, body, width, flags.minus, zeroPad);
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let result = '';
  let argIndex = 0;
  let i = 0;
  while (i < fmt.length) {
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
    while (i < fmt.length && '-+0 #'.includes(fmt[i])) {
      switch (fmt[i]) {
        case '-':
          flags.minus = true;
          break;
        case '+':
          flags.plus = true;
          break;
        case ' ':
          flags.space = true;
          break;
        case '0':
          flags.zero = true;
          break;
        case '#':
          flags.hash = true;
          break;
      }
      i++;
    }
    let widthStr = '';
    while (i < fmt.length && /[0-9]/.test(fmt[i])) {
      widthStr += fmt[i];
      i++;
    }
    const width = widthStr ? parseInt(widthStr, 10) : 0;
    let precision: number | undefined;
    if (fmt[i] === '.') {
      i++;
      let precStr = '';
      while (i < fmt.length && /[0-9]/.test(fmt[i])) {
        precStr += fmt[i];
        i++;
      }
      precision = precStr ? parseInt(precStr, 10) : 0;
    }
    const conv = fmt[i];
    i++;
    const arg = args[argIndex++];

    switch (conv) {
      case 'd':
      case 'i':
        result += convertD(arg as number | bigint, flags, width, precision);
        break;
      case 'x':
        result += convertHex(arg as number | bigint, false, flags, width, precision);
        break;
      case 'X':
        result += convertHex(arg as number | bigint, true, flags, width, precision);
        break;
      case 'o':
        result += convertOctal(arg as number | bigint, flags, width, precision);
        break;
      case 'e':
      case 'E':
      case 'f':
      case 'F':
      case 'g':
      case 'G':
        result += convertFloat(conv, arg as number, flags, width, precision);
        break;
      case 's': {
        let str = arg as string;
        if (precision !== undefined) str = str.slice(0, precision);
        result += pad(str, width, flags.minus);
        break;
      }
      case 'c': {
        const str = arg as string;
        result += pad(str, width, flags.minus);
        break;
      }
      default:
        break;
    }
  }
  return result;
}
