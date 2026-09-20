export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let out = '';
  let argIndex = 0;
  let i = 0;
  const n = fmt.length;

  while (i < n) {
    const ch = fmt[i];
    if (ch !== '%') {
      out += ch;
      i++;
      continue;
    }

    // parse spec starting at i (fmt[i] === '%')
    let j = i + 1;

    // flags
    let flagMinus = false;
    let flagPlus = false;
    let flagSpace = false;
    let flagZero = false;
    let flagHash = false;
    while (j < n && '-+ #0'.includes(fmt[j])) {
      switch (fmt[j]) {
        case '-': flagMinus = true; break;
        case '+': flagPlus = true; break;
        case ' ': flagSpace = true; break;
        case '0': flagZero = true; break;
        case '#': flagHash = true; break;
      }
      j++;
    }

    // width
    let widthStr = '';
    while (j < n && fmt[j] >= '0' && fmt[j] <= '9') {
      widthStr += fmt[j];
      j++;
    }
    const width = widthStr === '' ? 0 : parseInt(widthStr, 10);

    // precision
    let precisionGiven = false;
    let precision = 0;
    if (fmt[j] === '.') {
      precisionGiven = true;
      j++;
      let precStr = '';
      while (j < n && fmt[j] >= '0' && fmt[j] <= '9') {
        precStr += fmt[j];
        j++;
      }
      precision = precStr === '' ? 0 : parseInt(precStr, 10);
    }

    const conv = fmt[j];
    j++;
    i = j;

    if (conv === '%') {
      out += '%';
      continue;
    }

    const arg = args[argIndex++];

    switch (conv) {
      case 'd':
      case 'i':
        out += formatInt(arg, 10, false, flagMinus, flagPlus, flagSpace, flagZero, flagHash, precisionGiven, precision, width);
        break;
      case 'x':
        out += formatHexOct(arg, 'x', flagMinus, flagZero, flagHash, precisionGiven, precision, width);
        break;
      case 'X':
        out += formatHexOct(arg, 'X', flagMinus, flagZero, flagHash, precisionGiven, precision, width);
        break;
      case 'o':
        out += formatHexOct(arg, 'o', flagMinus, flagZero, flagHash, precisionGiven, precision, width);
        break;
      case 's':
        out += formatStr(arg as string, flagMinus, precisionGiven, precision, width);
        break;
      case 'c':
        out += formatStr(arg as string, flagMinus, false, 0, width);
        break;
      case 'e':
      case 'E':
      case 'f':
      case 'F':
      case 'g':
      case 'G':
        out += formatFloat(arg as number, conv, flagMinus, flagPlus, flagSpace, flagZero, flagHash, precisionGiven, precision, width);
        break;
      default:
        throw new Error('unsupported conversion: ' + conv);
    }
  }

  return out;
}

// ---- generic padding ----

function pad(sign: string, prefix: string, digits: string, width: number, zeroFlag: boolean, leftAlign: boolean): string {
  const body = sign + prefix + digits;
  if (body.length >= width) return body;
  const padLen = width - body.length;
  if (leftAlign) return body + ' '.repeat(padLen);
  if (zeroFlag) return sign + prefix + '0'.repeat(padLen) + digits;
  return ' '.repeat(padLen) + body;
}

// ---- integer conversions ----

function toBigIntArg(arg: number | bigint | string): bigint {
  if (typeof arg === 'bigint') return arg;
  return BigInt(arg as number);
}

function formatInt(
  arg: number | bigint | string,
  base: number,
  unsigned: boolean,
  flagMinus: boolean,
  flagPlus: boolean,
  flagSpace: boolean,
  flagZero: boolean,
  flagHash: boolean,
  precisionGiven: boolean,
  precision: number,
  width: number,
): string {
  const value = toBigIntArg(arg);
  const negative = value < 0n;
  const absVal = negative ? -value : value;

  const sign = negative ? '-' : (flagPlus ? '+' : (flagSpace ? ' ' : ''));

  let digits: string;
  if (precisionGiven && precision === 0 && absVal === 0n) {
    digits = '';
  } else if (precisionGiven) {
    digits = absVal.toString(10).padStart(precision, '0');
  } else {
    digits = absVal.toString(10);
  }

  const zeroFlag = flagZero && !flagMinus && !precisionGiven;
  return pad(sign, '', digits, width, zeroFlag, flagMinus);
}

function formatHexOct(
  arg: number | bigint | string,
  conv: 'x' | 'X' | 'o',
  flagMinus: boolean,
  flagZero: boolean,
  flagHash: boolean,
  precisionGiven: boolean,
  precision: number,
  width: number,
): string {
  const absVal = toBigIntArg(arg);
  const base = conv === 'o' ? 8 : 16;

  let digits: string;
  if (precisionGiven && precision === 0 && absVal === 0n) {
    digits = '';
  } else if (precisionGiven) {
    digits = absVal.toString(base).padStart(precision, '0');
  } else {
    digits = absVal.toString(base);
  }

  if (conv === 'X') digits = digits.toUpperCase();

  let prefix = '';
  if (conv === 'o') {
    if (flagHash && (digits.length === 0 || digits[0] !== '0')) {
      digits = '0' + digits;
    }
  } else {
    if (flagHash && absVal !== 0n) {
      prefix = conv === 'x' ? '0x' : '0X';
    }
  }

  const zeroFlag = flagZero && !flagMinus && !precisionGiven;
  return pad('', prefix, digits, width, zeroFlag, flagMinus);
}

// ---- string / char conversions ----

function formatStr(arg: string, flagMinus: boolean, precisionGiven: boolean, precision: number, width: number): string {
  const digits = precisionGiven ? arg.slice(0, precision) : arg;
  return pad('', '', digits, width, false, flagMinus);
}

// ---- float decomposition ----

interface Decomposed {
  sign: number; // 0 or 1
  m: bigint;
  e: number;
  isZero: boolean;
  isInf: boolean;
  isNaN: boolean;
}

function decompose(x: number): Decomposed {
  const buf = new ArrayBuffer(8);
  const dv = new DataView(buf);
  dv.setFloat64(0, x);
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const sign = hi >>> 31;
  const rawExp = (hi >>> 20) & 0x7ff;
  const mantHigh = hi & 0xfffff;
  const mantissa = (BigInt(mantHigh) << 32n) | BigInt(lo >>> 0);

  if (rawExp === 0x7ff) {
    return { sign, m: 0n, e: 0, isZero: false, isInf: mantissa === 0n, isNaN: mantissa !== 0n };
  }
  if (rawExp === 0) {
    return { sign, m: mantissa, e: -1074, isZero: mantissa === 0n, isInf: false, isNaN: false };
  }
  return { sign, m: mantissa | (1n << 52n), e: rawExp - 1075, isZero: false, isInf: false, isNaN: false };
}

function roundDiv(N: bigint, D: bigint): bigint {
  const q = N / D;
  const r = N % D;
  const twiceR = r * 2n;
  if (twiceR < D) return q;
  if (twiceR > D) return q + 1n;
  return q % 2n === 0n ? q : q + 1n;
}

// returns round(m * 2^e * 10^k) with ties-to-even
function roundScaled(m: bigint, e: number, k: number): bigint {
  let N = m;
  let D = 1n;
  if (k >= 0) N *= 5n ** BigInt(k);
  else D *= 5n ** BigInt(-k);
  const pow2 = e + k;
  if (pow2 >= 0) N *= 2n ** BigInt(pow2);
  else D *= 2n ** BigInt(-pow2);
  return roundDiv(N, D);
}

function computeExponent(m: bigint, e: number, precision: number): { exp: number; digits: string } {
  let exp = Math.floor(Math.log10(Number(m)) + e * Math.log10(2));
  let s = '';
  for (let iter = 0; iter < 30; iter++) {
    const k = precision - exp;
    const digits = roundScaled(m, e, k);
    s = digits.toString();
    if (s.length === precision + 1) break;
    if (s.length > precision + 1) exp++;
    else exp--;
  }
  return { exp, digits: s };
}

function formatFBody(m: bigint, e: number, isZero: boolean, precision: number, hash: boolean): string {
  let intPart: string;
  let frac: string;
  if (isZero) {
    intPart = '0';
    frac = '0'.repeat(precision);
  } else {
    const digits = roundScaled(m, e, precision);
    let s = digits.toString();
    if (precision > 0) {
      if (s.length <= precision) s = s.padStart(precision + 1, '0');
      intPart = s.slice(0, s.length - precision);
      frac = s.slice(s.length - precision);
    } else {
      intPart = s;
      frac = '';
    }
  }
  let out = intPart;
  if (precision > 0) out += '.' + frac;
  else if (hash) out += '.';
  return out;
}

function formatEBody(m: bigint, e: number, isZero: boolean, precision: number, hash: boolean, upper: boolean): string {
  let exp: number;
  let digitsStr: string;
  if (isZero) {
    exp = 0;
    digitsStr = '0'.repeat(precision + 1);
  } else {
    const res = computeExponent(m, e, precision);
    exp = res.exp;
    digitsStr = res.digits;
  }
  let mantissaStr = digitsStr[0];
  if (precision > 0) mantissaStr += '.' + digitsStr.slice(1);
  else if (hash) mantissaStr += '.';

  const letter = upper ? 'E' : 'e';
  const expSign = exp >= 0 ? '+' : '-';
  const expAbs = Math.abs(exp).toString().padStart(2, '0');
  return mantissaStr + letter + expSign + expAbs;
}

function stripTrailingZerosPlain(s: string): string {
  if (!s.includes('.')) return s;
  s = s.replace(/0+$/, '');
  if (s.endsWith('.')) s = s.slice(0, -1);
  return s;
}

function stripTrailingZerosExp(s: string, upper: boolean): string {
  const idx = s.indexOf(upper ? 'E' : 'e');
  const mantissa = stripTrailingZerosPlain(s.slice(0, idx));
  return mantissa + s.slice(idx);
}

function formatGBody(m: bigint, e: number, isZero: boolean, precisionIn: number, hash: boolean, upper: boolean): string {
  const P = precisionIn === 0 ? 1 : precisionIn;
  let X: number;
  if (isZero) {
    X = 0;
  } else {
    X = computeExponent(m, e, P - 1).exp;
  }

  if (P > X && X >= -4) {
    const prec = P - 1 - X;
    let s = formatFBody(m, e, isZero, prec, hash);
    if (!hash) s = stripTrailingZerosPlain(s);
    return s;
  } else {
    const prec = P - 1;
    let s = formatEBody(m, e, isZero, prec, hash, upper);
    if (!hash) s = stripTrailingZerosExp(s, upper);
    return s;
  }
}

function formatFloat(
  arg: number,
  conv: 'e' | 'E' | 'f' | 'F' | 'g' | 'G',
  flagMinus: boolean,
  flagPlus: boolean,
  flagSpace: boolean,
  flagZero: boolean,
  flagHash: boolean,
  precisionGiven: boolean,
  precisionIn: number,
  width: number,
): string {
  const upper = conv === 'E' || conv === 'F' || conv === 'G';
  const precision = precisionGiven ? precisionIn : (conv === 'g' || conv === 'G' ? 6 : 6);

  const d = decompose(arg);

  if (d.isNaN) {
    const body = upper ? 'NAN' : 'nan';
    return pad('', '', body, width, false, flagMinus);
  }

  const sign = d.sign ? '-' : (flagPlus ? '+' : (flagSpace ? ' ' : ''));

  if (d.isInf) {
    const body = upper ? 'INF' : 'inf';
    return pad(sign, '', body, width, false, flagMinus);
  }

  let digits: string;
  let zeroFlagApplies = flagZero && !flagMinus;

  if (conv === 'f' || conv === 'F') {
    digits = formatFBody(d.m, d.e, d.isZero, precision, flagHash);
  } else if (conv === 'e' || conv === 'E') {
    digits = formatEBody(d.m, d.e, d.isZero, precision, flagHash, upper);
  } else {
    digits = formatGBody(d.m, d.e, d.isZero, precision, flagHash, upper);
  }

  return pad(sign, '', digits, width, zeroFlagApplies, flagMinus);
}
