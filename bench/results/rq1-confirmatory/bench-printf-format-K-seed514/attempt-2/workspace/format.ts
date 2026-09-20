// ---- exact binary -> decimal helpers (BigInt based, round-half-to-even) ----

function decompose(x: number): { num: bigint; den: bigint } {
  const ax = Math.abs(x);
  const buf = new ArrayBuffer(8);
  const view = new DataView(buf);
  view.setFloat64(0, ax);
  const hi = view.getUint32(0);
  const lo = view.getUint32(4);
  const biasedExp = (hi >>> 20) & 0x7ff;
  const mantHi = hi & 0xfffff;
  const mantissa = (BigInt(mantHi) << 32n) | BigInt(lo);
  let m: bigint;
  let e: number;
  if (biasedExp === 0) {
    m = mantissa;
    e = -1074;
  } else {
    m = mantissa | (1n << 52n);
    e = biasedExp - 1075;
  }
  let num: bigint;
  let den: bigint;
  if (e >= 0) {
    num = m << BigInt(e);
    den = 1n;
  } else {
    num = m;
    den = 1n << BigInt(-e);
  }
  return { num, den };
}

// round(num/den * 10^k), ties to even, num/den >= 0
function exactRoundPow10(num: bigint, den: bigint, k: number): bigint {
  let scaledNum: bigint;
  let scaledDen: bigint;
  if (k >= 0) {
    scaledNum = num * 10n ** BigInt(k);
    scaledDen = den;
  } else {
    scaledNum = num;
    scaledDen = den * 10n ** BigInt(-k);
  }
  let q = scaledNum / scaledDen;
  const r = scaledNum % scaledDen;
  const twice = r * 2n;
  if (twice > scaledDen || (twice === scaledDen && q % 2n === 1n)) {
    q += 1n;
  }
  return q;
}

function fixedDigits(num: bigint, den: bigint, precision: number): { intPart: string; fracPart: string } {
  const scaled = exactRoundPow10(num, den, precision);
  let s = scaled.toString();
  if (s.length <= precision) {
    s = '0'.repeat(precision - s.length + 1) + s;
  }
  if (precision === 0) {
    return { intPart: s, fracPart: '' };
  }
  return { intPart: s.slice(0, s.length - precision), fracPart: s.slice(s.length - precision) };
}

// P significant digits (P >= 1) of num/den (num may be 0), and decimal exponent X
function sigDigits(x: number, num: bigint, den: bigint, P: number): { digits: string; X: number } {
  if (num === 0n) {
    return { digits: '0'.repeat(P), X: 0 };
  }
  let X = Math.floor(Math.log10(Math.abs(x)));
  if (!isFinite(X)) X = 0;
  const lowBound = 10n ** BigInt(P - 1);
  const highBound = 10n ** BigInt(P);
  let d = exactRoundPow10(num, den, P - 1 - X);
  while (d >= highBound) {
    X++;
    d = exactRoundPow10(num, den, P - 1 - X);
  }
  while (d < lowBound) {
    X--;
    d = exactRoundPow10(num, den, P - 1 - X);
  }
  return { digits: d.toString(), X };
}

// ---- padding ----

function padWidth(s: string, width: number, minus: boolean): string {
  if (s.length >= width) return s;
  const fill = ' '.repeat(width - s.length);
  return minus ? s + fill : fill + s;
}

function assembleNumeric(
  sign: string,
  prefix: string,
  digits: string,
  width: number,
  zeroFlag: boolean,
  minusFlag: boolean
): string {
  const bodyLen = sign.length + prefix.length + digits.length;
  if (zeroFlag && !minusFlag && bodyLen < width) {
    digits = '0'.repeat(width - bodyLen) + digits;
  }
  return sign + prefix + digits;
}

// ---- integer conversions ----

function toBigInt(v: number | bigint | string): bigint {
  if (typeof v === 'bigint') return v;
  if (typeof v === 'number') return BigInt(v);
  throw new Error('expected number or bigint argument');
}

function convertDI(
  value: number | bigint,
  precision: number | null,
  plus: boolean,
  space: boolean
): { sign: string; prefix: string; digits: string } {
  const v = toBigInt(value);
  const neg = v < 0n;
  const mag = neg ? -v : v;
  let digits = mag.toString(10);
  if (precision !== null) {
    if (precision === 0 && mag === 0n) {
      digits = '';
    } else if (digits.length < precision) {
      digits = '0'.repeat(precision - digits.length) + digits;
    }
  }
  const sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
  return { sign, prefix: '', digits };
}

function convertXO(
  value: number | bigint,
  base: 16 | 8,
  upper: boolean,
  precision: number | null,
  hash: boolean
): { sign: string; prefix: string; digits: string } {
  const v = toBigInt(value);
  let digits = v.toString(base);
  if (upper) digits = digits.toUpperCase();
  if (precision !== null) {
    if (precision === 0 && v === 0n) {
      digits = '';
    } else if (digits.length < precision) {
      digits = '0'.repeat(precision - digits.length) + digits;
    }
  }
  let prefix = '';
  if (hash) {
    if (base === 16) {
      if (v !== 0n) prefix = upper ? '0X' : '0x';
    } else {
      if (digits === '' || digits[0] !== '0') digits = '0' + digits;
    }
  }
  return { sign: '', prefix, digits };
}

// ---- float conversions ----

function floatSign(x: number, plus: boolean, space: boolean): string {
  const negative = x < 0 || Object.is(x, -0);
  return negative ? '-' : plus ? '+' : space ? ' ' : '';
}

function stripTrailingZeros(frac: string): string {
  let end = frac.length;
  while (end > 0 && frac[end - 1] === '0') end--;
  return frac.slice(0, end);
}

function convertF(
  x: number,
  precision: number,
  hash: boolean,
  plus: boolean,
  space: boolean,
  upper: boolean
): { sign: string; digits: string } {
  if (Number.isNaN(x)) {
    return { sign: '', digits: upper ? 'NAN' : 'nan' };
  }
  if (!isFinite(x)) {
    return { sign: floatSign(x, plus, space), digits: upper ? 'INF' : 'inf' };
  }
  const sign = floatSign(x, plus, space);
  const { num, den } = decompose(x);
  const { intPart, fracPart } = fixedDigits(num, den, precision);
  const digits = intPart + (precision > 0 || hash ? '.' + fracPart : '');
  return { sign, digits };
}

function convertE(
  x: number,
  precision: number,
  hash: boolean,
  plus: boolean,
  space: boolean,
  upper: boolean
): { sign: string; digits: string } {
  if (Number.isNaN(x)) {
    return { sign: '', digits: upper ? 'NAN' : 'nan' };
  }
  if (!isFinite(x)) {
    return { sign: floatSign(x, plus, space), digits: upper ? 'INF' : 'inf' };
  }
  const sign = floatSign(x, plus, space);
  const { num, den } = decompose(x);
  const P = precision + 1;
  const { digits: d, X } = sigDigits(x, num, den, P);
  const first = d[0];
  const rest = d.slice(1);
  const mantissa = precision > 0 || hash ? first + '.' + rest : first;
  const eChar = upper ? 'E' : 'e';
  const expSign = X < 0 ? '-' : '+';
  const expDigits = Math.abs(X).toString().padStart(2, '0');
  return { sign, digits: mantissa + eChar + expSign + expDigits };
}

function convertG(
  x: number,
  precision: number | null,
  hash: boolean,
  plus: boolean,
  space: boolean,
  upper: boolean
): { sign: string; digits: string } {
  if (Number.isNaN(x)) {
    return { sign: '', digits: upper ? 'NAN' : 'nan' };
  }
  if (!isFinite(x)) {
    return { sign: floatSign(x, plus, space), digits: upper ? 'INF' : 'inf' };
  }
  const sign = floatSign(x, plus, space);
  let P = precision === null ? 6 : precision === 0 ? 1 : precision;
  const { num, den } = decompose(x);
  const { digits: d, X } = sigDigits(x, num, den, P);

  if (P > X && X >= -4) {
    const fPrecision = P - 1 - X;
    const { intPart, fracPart } = fixedDigits(num, den, fPrecision);
    let digits: string;
    if (hash) {
      digits = intPart + '.' + fracPart;
    } else {
      const stripped = stripTrailingZeros(fracPart);
      digits = stripped ? intPart + '.' + stripped : intPart;
    }
    return { sign, digits };
  } else {
    const first = d[0];
    const rest = d.slice(1);
    const eChar = upper ? 'E' : 'e';
    const expSign = X < 0 ? '-' : '+';
    const expDigits = Math.abs(X).toString().padStart(2, '0');
    let mantissa: string;
    if (hash) {
      mantissa = first + '.' + rest;
    } else {
      const stripped = stripTrailingZeros(rest);
      mantissa = stripped ? first + '.' + stripped : first;
    }
    return { sign, digits: mantissa + eChar + expSign + expDigits };
  }
}

// ---- main entry point ----

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
    let j = i + 1;
    let flags = '';
    while (j < n && '-+ 0#'.includes(fmt[j])) {
      flags += fmt[j];
      j++;
    }
    let widthStr = '';
    while (j < n && fmt[j] >= '0' && fmt[j] <= '9') {
      widthStr += fmt[j];
      j++;
    }
    let precStr: string | null = null;
    if (fmt[j] === '.') {
      j++;
      precStr = '';
      while (j < n && fmt[j] >= '0' && fmt[j] <= '9') {
        precStr += fmt[j];
        j++;
      }
    }
    const conv = fmt[j];
    j++;

    if (conv === '%') {
      result += '%';
      i = j;
      continue;
    }

    const arg = args[argIndex++];
    const width = widthStr ? parseInt(widthStr, 10) : 0;
    const precision = precStr === null ? null : precStr === '' ? 0 : parseInt(precStr, 10);
    const hasMinus = flags.includes('-');
    const hasPlus = flags.includes('+');
    const hasSpace = flags.includes(' ');
    const hasZero = flags.includes('0');
    const hasHash = flags.includes('#');

    let out: string;

    switch (conv) {
      case 'd':
      case 'i': {
        const { sign, prefix, digits } = convertDI(arg as number | bigint, precision, hasPlus, hasSpace);
        const zeroFlag = hasZero && !hasMinus && precision === null;
        out = assembleNumeric(sign, prefix, digits, width, zeroFlag, hasMinus);
        break;
      }
      case 'x':
      case 'X':
      case 'o': {
        const base = conv === 'o' ? 8 : 16;
        const upper = conv === 'X';
        const { sign, prefix, digits } = convertXO(arg as number | bigint, base, upper, precision, hasHash);
        const zeroFlag = hasZero && !hasMinus && precision === null;
        out = assembleNumeric(sign, prefix, digits, width, zeroFlag, hasMinus);
        break;
      }
      case 'f':
      case 'F': {
        const p = precision === null ? 6 : precision;
        const { sign, digits } = convertF(arg as number, p, hasHash, hasPlus, hasSpace, conv === 'F');
        const zeroFlag = hasZero && !hasMinus;
        out = assembleNumeric(sign, '', digits, width, zeroFlag, hasMinus);
        break;
      }
      case 'e':
      case 'E': {
        const p = precision === null ? 6 : precision;
        const { sign, digits } = convertE(arg as number, p, hasHash, hasPlus, hasSpace, conv === 'E');
        const zeroFlag = hasZero && !hasMinus;
        out = assembleNumeric(sign, '', digits, width, zeroFlag, hasMinus);
        break;
      }
      case 'g':
      case 'G': {
        const { sign, digits } = convertG(arg as number, precision, hasHash, hasPlus, hasSpace, conv === 'G');
        const zeroFlag = hasZero && !hasMinus;
        out = assembleNumeric(sign, '', digits, width, zeroFlag, hasMinus);
        break;
      }
      case 's': {
        let s = arg as string;
        if (precision !== null) s = s.slice(0, precision);
        out = padWidth(s, width, hasMinus);
        break;
      }
      case 'c': {
        const s = arg as string;
        out = padWidth(s, width, hasMinus);
        break;
      }
      default:
        throw new Error(`unsupported conversion: %${conv}`);
    }

    if (conv === 'f' || conv === 'F' || conv === 'e' || conv === 'E' || conv === 'g' || conv === 'G' ||
        conv === 'd' || conv === 'i' || conv === 'x' || conv === 'X' || conv === 'o') {
      out = padWidth(out, width, hasMinus);
    }

    result += out;
    i = j;
  }
  return result;
}
