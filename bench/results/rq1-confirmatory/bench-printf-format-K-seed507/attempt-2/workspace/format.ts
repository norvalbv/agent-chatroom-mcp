export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let argIndex = 0;
  const nextArg = () => args[argIndex++];

  const specRegex = /%([-+ 0#]*)(\d*)(\.(\d*))?([a-zA-Z%])/g;
  let result = '';
  let lastEnd = 0;
  let m: RegExpExecArray | null;

  while ((m = specRegex.exec(fmt)) !== null) {
    result += fmt.slice(lastEnd, m.index);
    lastEnd = specRegex.lastIndex;

    const [, flagsStr, widthStr, precGroup, precDigits, conv] = m;

    if (conv === '%') {
      result += '%';
      continue;
    }

    const minusFlag = flagsStr.includes('-');
    const plusFlag = flagsStr.includes('+');
    const spaceFlag = flagsStr.includes(' ');
    const zeroFlag = flagsStr.includes('0');
    const hashFlag = flagsStr.includes('#');
    const width = widthStr === '' ? 0 : parseInt(widthStr, 10);
    const precisionGiven = precGroup !== undefined;
    const precision = precisionGiven ? (precDigits === '' ? 0 : parseInt(precDigits, 10)) : undefined;

    result += formatOne(conv, flagsStr, minusFlag, plusFlag, spaceFlag, zeroFlag, hashFlag, width, precisionGiven, precision, nextArg);
  }
  result += fmt.slice(lastEnd);
  return result;
}

function padNumeric(sign: string, prefix: string, digits: string, width: number, zeroFlag: boolean, minusFlag: boolean): string {
  const core = sign + prefix + digits;
  if (core.length >= width) return core;
  const padLen = width - core.length;
  if (minusFlag) return core + ' '.repeat(padLen);
  if (zeroFlag) return sign + prefix + '0'.repeat(padLen) + digits;
  return ' '.repeat(padLen) + core;
}

function padText(text: string, width: number, minusFlag: boolean): string {
  if (text.length >= width) return text;
  const padLen = width - text.length;
  return minusFlag ? text + ' '.repeat(padLen) : ' '.repeat(padLen) + text;
}

function computeSign(isNegative: boolean, plusFlag: boolean, spaceFlag: boolean): string {
  if (isNegative) return '-';
  if (plusFlag) return '+';
  if (spaceFlag) return ' ';
  return '';
}

function divRoundHalfEven(a: bigint, b: bigint): bigint {
  const q = a / b;
  const r = a % b;
  const twice = r * 2n;
  if (twice < b) return q;
  if (twice > b) return q + 1n;
  return q % 2n === 0n ? q : q + 1n;
}

function decompose(x: number): { num: bigint; den: bigint } {
  if (x === 0) return { num: 0n, den: 1n };
  const buf = new ArrayBuffer(8);
  const dv = new DataView(buf);
  dv.setFloat64(0, x);
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const expBits = (hi >>> 20) & 0x7ff;
  const mantHigh = hi & 0xfffff;
  const mantissa = (BigInt(mantHigh) << 32n) | BigInt(lo);
  let e: number;
  let mBig: bigint;
  if (expBits === 0) {
    e = -1074;
    mBig = mantissa;
  } else {
    e = expBits - 1075;
    mBig = mantissa | (1n << 52n);
  }
  if (e >= 0) {
    return { num: mBig << BigInt(e), den: 1n };
  }
  return { num: mBig, den: 1n << BigInt(-e) };
}

function roundedScaled(num: bigint, den: bigint, scaleExp: number, sigDigits: number): bigint {
  const k = sigDigits - 1 - scaleExp;
  let scaledNum: bigint;
  let scaledDen: bigint;
  if (k >= 0) {
    scaledNum = num * 10n ** BigInt(k);
    scaledDen = den;
  } else {
    scaledNum = num;
    scaledDen = den * 10n ** BigInt(-k);
  }
  return divRoundHalfEven(scaledNum, scaledDen);
}

function computeSigDigits(num: bigint, den: bigint, sigDigits: number): { digits: string; exp: number } {
  if (num === 0n) {
    return { digits: '0'.repeat(sigDigits), exp: 0 };
  }
  const approx = Number(num) / Number(den);
  let exp = Math.floor(Math.log10(approx));
  const lower = 10n ** BigInt(sigDigits - 1);
  const upper = 10n ** BigInt(sigDigits);
  let digits = roundedScaled(num, den, exp, sigDigits);
  let guard = 0;
  while (digits >= upper && guard < 10) {
    exp++;
    digits = roundedScaled(num, den, exp, sigDigits);
    guard++;
  }
  guard = 0;
  while (digits < lower && guard < 10) {
    exp--;
    digits = roundedScaled(num, den, exp, sigDigits);
    guard++;
  }
  return { digits: digits.toString(), exp };
}

function joinIntFrac(intPart: string, frac: string, hashFlag: boolean): string {
  let f = frac;
  if (!hashFlag) {
    f = f.replace(/0+$/, '');
  }
  if (f.length === 0) {
    return hashFlag ? intPart + '.' : intPart;
  }
  return intPart + '.' + f;
}

function joinIntFracFixed(intPart: string, frac: string, hashFlag: boolean): string {
  if (frac.length === 0) {
    return hashFlag ? intPart + '.' : intPart;
  }
  return intPart + '.' + frac;
}

function toBigIntValue(arg: number | bigint): bigint {
  return typeof arg === 'bigint' ? arg : BigInt(arg);
}

function digitsWithPrecision(magnitude: bigint, base: 10 | 16 | 8, precisionGiven: boolean, precision: number | undefined, upper: boolean): string {
  let s: string;
  if (base === 10) s = magnitude.toString(10);
  else if (base === 16) s = magnitude.toString(16);
  else s = magnitude.toString(8);
  if (upper) s = s.toUpperCase();
  if (precisionGiven) {
    if (precision === 0 && magnitude === 0n) {
      s = '';
    } else if (s.length < (precision as number)) {
      s = '0'.repeat((precision as number) - s.length) + s;
    }
  }
  return s;
}

function formatOne(
  conv: string,
  flagsStr: string,
  minusFlag: boolean,
  plusFlag: boolean,
  spaceFlag: boolean,
  zeroFlag: boolean,
  hashFlag: boolean,
  width: number,
  precisionGiven: boolean,
  precision: number | undefined,
  nextArg: () => number | bigint | string
): string {
  switch (conv) {
    case 'd':
    case 'i': {
      const arg = nextArg() as number | bigint;
      const value = toBigIntValue(arg);
      const isNegative = value < 0n;
      const magnitude = isNegative ? -value : value;
      const digitStr = digitsWithPrecision(magnitude, 10, precisionGiven, precision, false);
      const sign = computeSign(isNegative, plusFlag, spaceFlag);
      const zeroEffective = zeroFlag && !precisionGiven && !minusFlag;
      return padNumeric(sign, '', digitStr, width, zeroEffective, minusFlag);
    }
    case 'x':
    case 'X': {
      const arg = nextArg() as number | bigint;
      const magnitude = toBigIntValue(arg);
      const digitStr = digitsWithPrecision(magnitude, 16, precisionGiven, precision, conv === 'X');
      const prefix = hashFlag && magnitude !== 0n ? (conv === 'X' ? '0X' : '0x') : '';
      const zeroEffective = zeroFlag && !precisionGiven && !minusFlag;
      return padNumeric('', prefix, digitStr, width, zeroEffective, minusFlag);
    }
    case 'o': {
      const arg = nextArg() as number | bigint;
      const magnitude = toBigIntValue(arg);
      let digitStr = digitsWithPrecision(magnitude, 8, precisionGiven, precision, false);
      if (hashFlag && (digitStr.length === 0 || digitStr[0] !== '0')) {
        digitStr = '0' + digitStr;
      }
      const zeroEffective = zeroFlag && !precisionGiven && !minusFlag;
      return padNumeric('', '', digitStr, width, zeroEffective, minusFlag);
    }
    case 'e':
    case 'E': {
      const value = nextArg() as number;
      return formatExponential(value, conv === 'E', plusFlag, spaceFlag, zeroFlag, hashFlag, width, minusFlag, precisionGiven ? (precision as number) : 6);
    }
    case 'f':
    case 'F': {
      const value = nextArg() as number;
      return formatFixed(value, conv === 'F', plusFlag, spaceFlag, zeroFlag, hashFlag, width, minusFlag, precisionGiven ? (precision as number) : 6);
    }
    case 'g':
    case 'G': {
      const value = nextArg() as number;
      let p = precisionGiven ? (precision as number) : 6;
      if (p === 0) p = 1;
      return formatGeneral(value, conv === 'G', plusFlag, spaceFlag, zeroFlag, hashFlag, width, minusFlag, p);
    }
    case 's': {
      const arg = nextArg() as string;
      let text = arg;
      if (precisionGiven) text = text.slice(0, precision);
      return padText(text, width, minusFlag);
    }
    case 'c': {
      const arg = nextArg() as string;
      return padText(arg, width, minusFlag);
    }
    default:
      return '';
  }
}

function specialValueText(value: number, upper: boolean): string | null {
  if (Number.isNaN(value)) return upper ? 'NAN' : 'nan';
  if (value === Infinity || value === -Infinity) return upper ? 'INF' : 'inf';
  return null;
}

function formatExponential(
  value: number,
  upper: boolean,
  plusFlag: boolean,
  spaceFlag: boolean,
  zeroFlag: boolean,
  hashFlag: boolean,
  width: number,
  minusFlag: boolean,
  precision: number
): string {
  const special = specialValueText(value, upper);
  if (special !== null) {
    if (Number.isNaN(value)) {
      return padNumeric('', '', special, width, false, minusFlag);
    }
    const isNegative = value < 0;
    const sign = computeSign(isNegative, plusFlag, spaceFlag);
    return padNumeric(sign, '', special, width, false, minusFlag);
  }

  const isNegative = value < 0 || Object.is(value, -0);
  const magnitude = Math.abs(value);
  const { num, den } = decompose(magnitude);
  const sigDigits = precision + 1;
  const { digits, exp } = computeSigDigits(num, den, sigDigits);
  const first = digits[0];
  const rest = digits.slice(1);
  const mantissa = joinIntFracFixed(first, rest, hashFlag);
  const expSign = exp < 0 ? '-' : '+';
  const expAbs = Math.abs(exp).toString().padStart(2, '0');
  const text = mantissa + (upper ? 'E' : 'e') + expSign + expAbs;
  const sign = computeSign(isNegative, plusFlag, spaceFlag);
  const zeroEffective = zeroFlag && !minusFlag;
  return padNumeric(sign, '', text, width, zeroEffective, minusFlag);
}

function formatFixed(
  value: number,
  upper: boolean,
  plusFlag: boolean,
  spaceFlag: boolean,
  zeroFlag: boolean,
  hashFlag: boolean,
  width: number,
  minusFlag: boolean,
  precision: number
): string {
  const special = specialValueText(value, upper);
  if (special !== null) {
    if (Number.isNaN(value)) {
      return padNumeric('', '', special, width, false, minusFlag);
    }
    const isNegative = value < 0;
    const sign = computeSign(isNegative, plusFlag, spaceFlag);
    return padNumeric(sign, '', special, width, false, minusFlag);
  }

  const isNegative = value < 0 || Object.is(value, -0);
  const magnitude = Math.abs(value);
  const { num, den } = decompose(magnitude);
  const scaled = num * 10n ** BigInt(precision);
  const digitsInt = divRoundHalfEven(scaled, den);
  let digitStr = digitsInt.toString();
  if (digitStr.length < precision + 1) {
    digitStr = '0'.repeat(precision + 1 - digitStr.length) + digitStr;
  }
  const intPart = digitStr.slice(0, digitStr.length - precision) || '0';
  const fracPart = precision > 0 ? digitStr.slice(digitStr.length - precision) : '';
  let text: string;
  if (precision === 0) {
    text = hashFlag ? intPart + '.' : intPart;
  } else {
    text = intPart + '.' + fracPart;
  }
  const sign = computeSign(isNegative, plusFlag, spaceFlag);
  const zeroEffective = zeroFlag && !minusFlag;
  return padNumeric(sign, '', text, width, zeroEffective, minusFlag);
}

function formatGeneral(
  value: number,
  upper: boolean,
  plusFlag: boolean,
  spaceFlag: boolean,
  zeroFlag: boolean,
  hashFlag: boolean,
  width: number,
  minusFlag: boolean,
  p: number
): string {
  const special = specialValueText(value, upper);
  if (special !== null) {
    if (Number.isNaN(value)) {
      return padNumeric('', '', special, width, false, minusFlag);
    }
    const isNegative = value < 0;
    const sign = computeSign(isNegative, plusFlag, spaceFlag);
    return padNumeric(sign, '', special, width, false, minusFlag);
  }

  const isNegative = value < 0 || Object.is(value, -0);
  const magnitude = Math.abs(value);
  const { num, den } = decompose(magnitude);
  const { digits, exp: X } = computeSigDigits(num, den, p);

  let text: string;
  if (p > X && X >= -4) {
    let intPart: string;
    let fracPart: string;
    if (X >= 0) {
      if (X + 1 >= digits.length) {
        intPart = digits + '0'.repeat(X + 1 - digits.length);
        fracPart = '';
      } else {
        intPart = digits.slice(0, X + 1);
        fracPart = digits.slice(X + 1);
      }
    } else {
      intPart = '0';
      fracPart = '0'.repeat(-X - 1) + digits;
    }
    text = joinIntFrac(intPart, fracPart, hashFlag);
  } else {
    const first = digits[0];
    const rest = digits.slice(1);
    const mantissa = joinIntFrac(first, rest, hashFlag);
    const expSign = X < 0 ? '-' : '+';
    const expAbs = Math.abs(X).toString().padStart(2, '0');
    text = mantissa + (upper ? 'E' : 'e') + expSign + expAbs;
  }

  const sign = computeSign(isNegative, plusFlag, spaceFlag);
  const zeroEffective = zeroFlag && !minusFlag;
  return padNumeric(sign, '', text, width, zeroEffective, minusFlag);
}
