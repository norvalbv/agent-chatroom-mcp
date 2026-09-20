type FloatBits = {
  sign: number;
  isNaN: boolean;
  isInf: boolean;
  isZero: boolean;
  mantissa: bigint;
  exp2: number;
};

function decompose(num: number): FloatBits {
  const buf = new ArrayBuffer(8);
  const dv = new DataView(buf);
  dv.setFloat64(0, num);
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const sign = (hi >>> 31) & 1;
  const rawExp = (hi >>> 20) & 0x7ff;
  const mantBits = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);

  if (rawExp === 0x7ff) {
    return { sign, isNaN: mantBits !== 0n, isInf: mantBits === 0n, isZero: false, mantissa: 0n, exp2: 0 };
  }
  if (rawExp === 0 && mantBits === 0n) {
    return { sign, isNaN: false, isInf: false, isZero: true, mantissa: 0n, exp2: 0 };
  }
  if (rawExp === 0) {
    return { sign, isNaN: false, isInf: false, isZero: false, mantissa: mantBits, exp2: -1074 };
  }
  return { sign, isNaN: false, isInf: false, isZero: false, mantissa: mantBits | (1n << 52n), exp2: rawExp - 1075 };
}

// Rounds mantissa * 2^exp2 * 10^k to the nearest integer, ties to even.
function roundDecimal(mantissa: bigint, exp2: number, k: number): bigint {
  let numerator = mantissa;
  let denominator = 1n;
  if (k >= 0) numerator *= 5n ** BigInt(k);
  else denominator *= 5n ** BigInt(-k);

  const extra2 = exp2 + k;
  if (extra2 >= 0) numerator *= 2n ** BigInt(extra2);
  else denominator *= 2n ** BigInt(-extra2);

  const q = numerator / denominator;
  const r = numerator % denominator;
  const twice = r * 2n;
  if (twice > denominator) return q + 1n;
  if (twice < denominator) return q;
  return q % 2n === 0n ? q : q + 1n;
}

// Rounds mantissa * 2^exp2 (nonzero) to p+1 significant digits, returning the
// digit string and the base-10 exponent, in exponential-notation style.
function toExpDigits(mantissa: bigint, exp2: number, p: number): { digits: string; exp: number } {
  let X = Math.floor(exp2 * Math.log10(2) + Math.log10(Number(mantissa)));
  for (;;) {
    const N = roundDecimal(mantissa, exp2, p - X);
    const s = N.toString();
    if (s.length < p + 1) {
      X -= 1;
      continue;
    }
    if (s.length > p + 1) {
      X += 1;
      continue;
    }
    return { digits: s, exp: X };
  }
}

function padNumeric(prefix: string, digits: string, width: number, zeroFlag: boolean, minusFlag: boolean): string {
  const total = prefix.length + digits.length;
  if (total >= width) return prefix + digits;
  const padLen = width - total;
  if (minusFlag) return prefix + digits + ' '.repeat(padLen);
  if (zeroFlag) return prefix + '0'.repeat(padLen) + digits;
  return ' '.repeat(padLen) + prefix + digits;
}

function padGeneral(s: string, width: number, minusFlag: boolean): string {
  if (s.length >= width) return s;
  const pad = ' '.repeat(width - s.length);
  return minusFlag ? s + pad : pad + s;
}

function floatSign(d: FloatBits, plusFlag: boolean, spaceFlag: boolean): string {
  if (d.isNaN) return '';
  if (d.sign) return '-';
  if (plusFlag) return '+';
  if (spaceFlag) return ' ';
  return '';
}

interface Spec {
  minusFlag: boolean;
  plusFlag: boolean;
  spaceFlag: boolean;
  zeroFlag: boolean;
  hashFlag: boolean;
  width: number;
  precision: number | undefined;
  hasPrecision: boolean;
}

function convert(conv: string, arg: number | bigint | string, s: Spec): string {
  const { minusFlag, plusFlag, spaceFlag, zeroFlag, hashFlag, width, precision, hasPrecision } = s;

  if (conv === 'd' || conv === 'i') {
    const value = typeof arg === 'bigint' ? arg : BigInt(arg as number);
    const neg = value < 0n;
    const mag = neg ? -value : value;
    let digits: string;
    if (hasPrecision) {
      digits = precision === 0 && mag === 0n ? '' : mag.toString().padStart(precision!, '0');
    } else {
      digits = mag.toString();
    }
    const sign = neg ? '-' : plusFlag ? '+' : spaceFlag ? ' ' : '';
    const useZero = zeroFlag && !minusFlag && !hasPrecision;
    return padNumeric(sign, digits, width, useZero, minusFlag);
  }

  if (conv === 'x' || conv === 'X' || conv === 'o') {
    const value = typeof arg === 'bigint' ? arg : BigInt(arg as number);
    const base = conv === 'o' ? 8 : 16;
    let digits: string;
    if (hasPrecision && precision === 0 && value === 0n) {
      digits = '';
    } else {
      digits = value.toString(base);
      if (conv === 'X') digits = digits.toUpperCase();
      if (hasPrecision) digits = digits.padStart(precision!, '0');
    }
    if (conv === 'o' && hashFlag) {
      if (digits.length === 0 || digits[0] !== '0') {
        digits = digits.padStart(digits.length + 1, '0');
      }
    }
    let prefix = '';
    if (hashFlag && conv !== 'o' && value !== 0n) {
      prefix = conv === 'x' ? '0x' : '0X';
    }
    const useZero = zeroFlag && !minusFlag && !hasPrecision;
    return padNumeric(prefix, digits, width, useZero, minusFlag);
  }

  if (conv === 'f' || conv === 'F') {
    const d = decompose(arg as number);
    const upper = conv === 'F';
    const sign = floatSign(d, plusFlag, spaceFlag);
    if (d.isNaN) return padNumeric(sign, upper ? 'NAN' : 'nan', width, false, minusFlag);
    if (d.isInf) return padNumeric(sign, upper ? 'INF' : 'inf', width, false, minusFlag);

    const p = hasPrecision ? precision! : 6;
    let intPart: string, fracPart: string;
    if (d.isZero) {
      intPart = '0';
      fracPart = '0'.repeat(p);
    } else {
      const N = roundDecimal(d.mantissa, d.exp2, p);
      let str = N.toString();
      if (str.length < p + 1) str = '0'.repeat(p + 1 - str.length) + str;
      intPart = p > 0 ? str.slice(0, str.length - p) : str;
      fracPart = p > 0 ? str.slice(str.length - p) : '';
    }
    const dot = p > 0 || hashFlag ? '.' : '';
    const body = intPart + dot + fracPart;
    const useZero = zeroFlag && !minusFlag;
    return padNumeric(sign, body, width, useZero, minusFlag);
  }

  if (conv === 'e' || conv === 'E') {
    const d = decompose(arg as number);
    const upper = conv === 'E';
    const sign = floatSign(d, plusFlag, spaceFlag);
    if (d.isNaN) return padNumeric(sign, upper ? 'NAN' : 'nan', width, false, minusFlag);
    if (d.isInf) return padNumeric(sign, upper ? 'INF' : 'inf', width, false, minusFlag);

    const p = hasPrecision ? precision! : 6;
    let digits: string, exp: number;
    if (d.isZero) {
      digits = '0'.repeat(p + 1);
      exp = 0;
    } else {
      const r = toExpDigits(d.mantissa, d.exp2, p);
      digits = r.digits;
      exp = r.exp;
    }
    const frac = digits.slice(1);
    const dot = p > 0 || hashFlag ? '.' : '';
    const expSign = exp < 0 ? '-' : '+';
    const expAbs = Math.abs(exp).toString().padStart(2, '0');
    const eChar = upper ? 'E' : 'e';
    const body = digits[0] + dot + frac + eChar + expSign + expAbs;
    const useZero = zeroFlag && !minusFlag;
    return padNumeric(sign, body, width, useZero, minusFlag);
  }

  if (conv === 'g' || conv === 'G') {
    const d = decompose(arg as number);
    const upper = conv === 'G';
    const sign = floatSign(d, plusFlag, spaceFlag);
    if (d.isNaN) return padNumeric(sign, upper ? 'NAN' : 'nan', width, false, minusFlag);
    if (d.isInf) return padNumeric(sign, upper ? 'INF' : 'inf', width, false, minusFlag);

    let P = hasPrecision ? precision! : 6;
    if (P === 0) P = 1;
    const p = P - 1;
    let digits: string, X: number;
    if (d.isZero) {
      digits = '0'.repeat(P);
      X = 0;
    } else {
      const r = toExpDigits(d.mantissa, d.exp2, p);
      digits = r.digits;
      X = r.exp;
    }

    let body: string;
    if (P > X && X >= -4) {
      let intPart: string, fracPart: string;
      if (X >= 0) {
        intPart = digits.slice(0, X + 1);
        fracPart = digits.slice(X + 1);
      } else {
        intPart = '0';
        fracPart = '0'.repeat(-X - 1) + digits;
      }
      if (!hashFlag) fracPart = fracPart.replace(/0+$/, '');
      const dot = fracPart.length > 0 || hashFlag ? '.' : '';
      body = intPart + dot + fracPart;
    } else {
      let frac = digits.slice(1);
      if (!hashFlag) frac = frac.replace(/0+$/, '');
      const dot = frac.length > 0 || hashFlag ? '.' : '';
      const expSign = X < 0 ? '-' : '+';
      const expAbs = Math.abs(X).toString().padStart(2, '0');
      const eChar = upper ? 'E' : 'e';
      body = digits[0] + dot + frac + eChar + expSign + expAbs;
    }
    const useZero = zeroFlag && !minusFlag;
    return padNumeric(sign, body, width, useZero, minusFlag);
  }

  if (conv === 's') {
    let str = arg as string;
    if (hasPrecision) str = str.slice(0, precision);
    return padGeneral(str, width, minusFlag);
  }

  // conv === 'c'
  return padGeneral(arg as string, width, minusFlag);
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
    const arg = args[argIndex++];
    const spec: Spec = {
      minusFlag: flagsStr.includes('-'),
      plusFlag: flagsStr.includes('+'),
      spaceFlag: flagsStr.includes(' '),
      zeroFlag: flagsStr.includes('0'),
      hashFlag: flagsStr.includes('#'),
      width: widthStr ? parseInt(widthStr, 10) : 0,
      hasPrecision: precStr !== undefined,
      precision: precStr !== undefined ? (precStr === '' ? 0 : parseInt(precStr, 10)) : undefined,
    };
    result += convert(conv, arg, spec);
  }
  result += fmt.slice(lastIndex);
  return result;
}
