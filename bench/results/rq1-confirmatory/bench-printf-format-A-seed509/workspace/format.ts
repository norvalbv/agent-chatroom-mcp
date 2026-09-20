type Flags = {
  minus: boolean;
  plus: boolean;
  space: boolean;
  zero: boolean;
  hash: boolean;
};

function signStr(negative: boolean, flags: Flags): string {
  if (negative) return '-';
  if (flags.plus) return '+';
  if (flags.space) return ' ';
  return '';
}

function pad(
  sign: string,
  prefix: string,
  digits: string,
  width: number,
  flags: Flags,
  zeroAllowed: boolean,
): string {
  const body = sign + prefix + digits;
  if (body.length >= width) return body;
  const padLen = width - body.length;
  if (flags.minus) return body + ' '.repeat(padLen);
  if (flags.zero && zeroAllowed) return sign + prefix + '0'.repeat(padLen) + digits;
  return ' '.repeat(padLen) + body;
}

// --- exact decimal representation of doubles ---

function decompose(x: number): { mantissa: bigint; exp2: number } {
  const buf = new ArrayBuffer(8);
  new Float64Array(buf)[0] = x;
  const bits = new BigUint64Array(buf)[0];
  const exp = Number((bits >> 52n) & 0x7ffn);
  const mantissaBits = bits & 0xfffffffffffffn;
  if (exp === 0) {
    return { mantissa: mantissaBits, exp2: -1074 };
  }
  return { mantissa: mantissaBits | (1n << 52n), exp2: exp - 1075 };
}

function toExactDigits(mantissa: bigint, exp2: number): { intDigits: string; fracDigits: string } {
  if (mantissa === 0n) return { intDigits: '0', fracDigits: '' };
  if (exp2 >= 0) {
    return { intDigits: (mantissa << BigInt(exp2)).toString(), fracDigits: '' };
  }
  const k = -exp2;
  const n = mantissa * 5n ** BigInt(k);
  let s = n.toString();
  if (s.length <= k) s = s.padStart(k + 1, '0');
  const intPart = s.slice(0, s.length - k).replace(/^0+(?=\d)/, '');
  const fracPart = s.slice(s.length - k);
  return { intDigits: intPart === '' ? '0' : intPart, fracDigits: fracPart };
}

function shouldRoundUp(remainder: string, lastKept: string): boolean {
  if (remainder === '') return false;
  const first = remainder[0];
  if (first > '5') return true;
  if (first < '5') return false;
  if (/[1-9]/.test(remainder.slice(1))) return true;
  return parseInt(lastKept || '0', 10) % 2 === 1;
}

function roundFixed(
  intDigits: string,
  fracDigits: string,
  n: number,
): { intPart: string; fracPart: string } {
  const full = intDigits + fracDigits;
  const cutIndex = intDigits.length + n;
  if (cutIndex >= full.length) {
    return { intPart: intDigits, fracPart: fracDigits.padEnd(n, '0') };
  }
  const kept = full.slice(0, cutIndex);
  const remainder = full.slice(cutIndex);
  const roundUp = shouldRoundUp(remainder, kept[kept.length - 1]);
  const big = BigInt(kept === '' ? '0' : kept) + (roundUp ? 1n : 0n);
  let newStr = big.toString();
  if (newStr.length < cutIndex) newStr = newStr.padStart(cutIndex, '0');
  const extra = newStr.length - cutIndex;
  const totalIntLen = intDigits.length + extra;
  const intPart = newStr.slice(0, totalIntLen) || '0';
  const fracPart = n > 0 ? newStr.slice(totalIntLen) : '';
  return { intPart, fracPart };
}

function roundSignificant(
  sigDigits: string,
  decExp: number,
  p: number,
): { digits: string; decExp: number } {
  if (p >= sigDigits.length) {
    return { digits: sigDigits.padEnd(p, '0'), decExp };
  }
  const kept = sigDigits.slice(0, p);
  const remainder = sigDigits.slice(p);
  const roundUp = shouldRoundUp(remainder, kept[kept.length - 1]);
  const big = BigInt(kept === '' ? '0' : kept) + (roundUp ? 1n : 0n);
  let newStr = big.toString();
  let newDecExp = decExp;
  if (newStr.length > p) {
    newDecExp += 1;
    newStr = newStr.slice(0, p);
  } else if (newStr.length < p) {
    newStr = newStr.padStart(p, '0');
  }
  return { digits: newStr, decExp: newDecExp };
}

function getSignificantDigits(abs: number): { digits: string; decExp: number } {
  const { mantissa, exp2 } = decompose(abs);
  if (mantissa === 0n) return { digits: '0', decExp: 1 };
  const { intDigits, fracDigits } = toExactDigits(mantissa, exp2);
  const full = intDigits + fracDigits;
  let leadingZeros = 0;
  while (leadingZeros < full.length && full[leadingZeros] === '0') leadingZeros++;
  const sig = full.slice(leadingZeros) || '0';
  const decExp = intDigits.length - leadingZeros;
  return { digits: sig, decExp };
}

// --- integer conversions ---

function fmtDI(flags: Flags, width: number, precision: number | null, value: number | bigint): string {
  let big = typeof value === 'bigint' ? value : BigInt(value);
  const negative = big < 0n;
  if (negative) big = -big;
  let digits = big.toString();
  if (precision !== null) {
    if (precision === 0 && big === 0n) digits = '';
    else if (digits.length < precision) digits = digits.padStart(precision, '0');
  }
  const sign = signStr(negative, flags);
  return pad(sign, '', digits, width, flags, precision === null);
}

function fmtHexOct(
  conv: string,
  flags: Flags,
  width: number,
  precision: number | null,
  value: number | bigint,
): string {
  const big = typeof value === 'bigint' ? value : BigInt(value);
  const base = conv === 'o' ? 8 : 16;
  let digits = big.toString(base);
  if (conv === 'X') digits = digits.toUpperCase();
  if (precision !== null) {
    if (precision === 0 && big === 0n) digits = '';
    else if (digits.length < precision) digits = digits.padStart(precision, '0');
  }
  if (conv === 'o' && flags.hash) {
    if (digits === '' || digits[0] !== '0') digits = '0' + digits;
  }
  let prefix = '';
  if ((conv === 'x' || conv === 'X') && flags.hash && big !== 0n) {
    prefix = conv === 'x' ? '0x' : '0X';
  }
  return pad('', prefix, digits, width, flags, precision === null);
}

// --- floating point conversions ---

function fmtFixedBody(abs: number, precision: number, hash: boolean): string {
  const { mantissa, exp2 } = decompose(abs);
  const { intDigits, fracDigits } = toExactDigits(mantissa, exp2);
  const { intPart, fracPart } = roundFixed(intDigits, fracDigits, precision);
  let s = intPart;
  if (precision > 0 || hash) s += '.' + fracPart;
  return s;
}

function fmtExpBody(abs: number, precision: number, hash: boolean, upper: boolean): string {
  const sig = getSignificantDigits(abs);
  const p = precision + 1;
  const { digits, decExp } = roundSignificant(sig.digits, sig.decExp, p);
  const x = decExp - 1;
  const d0 = digits[0];
  const rest = digits.slice(1);
  let s = d0;
  if (precision > 0 || hash) s += '.' + rest;
  const eChar = upper ? 'E' : 'e';
  const expSign = x < 0 ? '-' : '+';
  const expAbs = Math.abs(x).toString().padStart(2, '0');
  s += eChar + expSign + expAbs;
  return s;
}

function fmtGBody(abs: number, precision: number, hash: boolean, upper: boolean): string {
  const p = precision === 0 ? 1 : precision;
  const sig = getSignificantDigits(abs);
  const { digits, decExp } = roundSignificant(sig.digits, sig.decExp, p);
  const x = decExp - 1;
  if (p > x && x >= -4) {
    const fracPrecision = p - 1 - x;
    let intPart: string;
    let fracPart: string;
    if (decExp <= 0) {
      intPart = '0';
      fracPart = '0'.repeat(-decExp) + digits;
    } else if (decExp >= digits.length) {
      intPart = digits + '0'.repeat(decExp - digits.length);
      fracPart = '';
    } else {
      intPart = digits.slice(0, decExp);
      fracPart = digits.slice(decExp);
    }
    if (fracPart.length < fracPrecision) fracPart = fracPart.padEnd(fracPrecision, '0');
    if (!hash) fracPart = fracPart.replace(/0+$/, '');
    let s = intPart;
    if (fracPart.length > 0 || hash) s += '.' + fracPart;
    return s;
  }
  const d0 = digits[0];
  let rest = digits.slice(1);
  if (!hash) rest = rest.replace(/0+$/, '');
  const eChar = upper ? 'E' : 'e';
  const expSign = x < 0 ? '-' : '+';
  const expAbs = Math.abs(x).toString().padStart(2, '0');
  let s = d0;
  if (rest.length > 0 || hash) s += '.' + rest;
  s += eChar + expSign + expAbs;
  return s;
}

function isNegativeValue(x: number): boolean {
  if (Number.isNaN(x)) return false;
  return x < 0 || Object.is(x, -0);
}

function fmtFloat(conv: string, flags: Flags, width: number, precision: number | null, value: number): string {
  const upper = conv === conv.toUpperCase();
  if (Number.isNaN(value)) {
    const s = upper ? 'NAN' : 'nan';
    return pad('', '', s, width, flags, false);
  }
  const negative = isNegativeValue(value);
  const sign = signStr(negative, flags);
  if (!Number.isFinite(value)) {
    const s = upper ? 'INF' : 'inf';
    return pad(sign, '', s, width, flags, false);
  }
  const abs = Math.abs(value);
  const kind = conv.toLowerCase();
  const p = precision === null ? 6 : precision;
  let body: string;
  if (kind === 'f') body = fmtFixedBody(abs, p, flags.hash);
  else if (kind === 'e') body = fmtExpBody(abs, p, flags.hash, upper);
  else body = fmtGBody(abs, p, flags.hash, upper);
  return pad(sign, '', body, width, flags, true);
}

// --- string / char ---

function fmtStr(flags: Flags, width: number, precision: number | null, value: string): string {
  let s = value;
  if (precision !== null && s.length > precision) s = s.slice(0, precision);
  return pad('', '', s, width, flags, false);
}

function fmtChar(flags: Flags, width: number, value: string): string {
  return pad('', '', value, width, flags, false);
}

function formatOne(
  conv: string,
  flags: Flags,
  width: number,
  precision: number | null,
  value: number | bigint | string,
): string {
  switch (conv) {
    case 'd':
    case 'i':
      return fmtDI(flags, width, precision, value as number | bigint);
    case 'x':
    case 'X':
    case 'o':
      return fmtHexOct(conv, flags, width, precision, value as number | bigint);
    case 'e':
    case 'E':
    case 'f':
    case 'F':
    case 'g':
    case 'G':
      return fmtFloat(conv, flags, width, precision, value as number);
    case 's':
      return fmtStr(flags, width, precision, value as string);
    case 'c':
      return fmtChar(flags, width, value as string);
    default:
      throw new Error('unsupported conversion: ' + conv);
  }
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let result = '';
  let argIndex = 0;
  let i = 0;
  const n = fmt.length;
  while (i < n) {
    const c = fmt[i];
    if (c !== '%') {
      result += c;
      i++;
      continue;
    }
    let j = i + 1;
    const flags: Flags = { minus: false, plus: false, space: false, zero: false, hash: false };
    while (j < n && '-+ 0#'.includes(fmt[j])) {
      switch (fmt[j]) {
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
      j++;
    }
    let widthStr = '';
    while (j < n && fmt[j] >= '0' && fmt[j] <= '9') {
      widthStr += fmt[j];
      j++;
    }
    const width = widthStr === '' ? 0 : parseInt(widthStr, 10);
    let precision: number | null = null;
    if (fmt[j] === '.') {
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
      result += '%';
      continue;
    }
    const arg = args[argIndex++];
    result += formatOne(conv, flags, width, precision, arg);
  }
  return result;
}
