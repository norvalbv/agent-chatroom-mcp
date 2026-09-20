type Flags = {
  minus: boolean;
  plus: boolean;
  space: boolean;
  zero: boolean;
  hash: boolean;
};

function decomposeFloat(x: number): { mantissa: bigint; exp: number } {
  if (x === 0) return { mantissa: 0n, exp: 0 };
  const buf = new ArrayBuffer(8);
  const dv = new DataView(buf);
  dv.setFloat64(0, x);
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const biasedExp = (hi >>> 20) & 0x7ff;
  const mantHigh = hi & 0xfffff;
  let mantissa = (BigInt(mantHigh) << 32n) | BigInt(lo >>> 0);
  let exp: number;
  if (biasedExp === 0) {
    exp = -1022 - 52;
  } else {
    mantissa = mantissa | (1n << 52n);
    exp = biasedExp - 1023 - 52;
  }
  return { mantissa, exp };
}

function toExactDecimal(mantissa: bigint, exp: number): { num: bigint; scale: number } {
  if (mantissa === 0n) return { num: 0n, scale: 0 };
  if (exp >= 0) {
    return { num: mantissa << BigInt(exp), scale: 0 };
  }
  const k = -exp;
  return { num: mantissa * 5n ** BigInt(k), scale: k };
}

function roundToDigits(num: bigint, dropDigits: number): bigint {
  if (dropDigits <= 0) return num * 10n ** BigInt(-dropDigits);
  const divisor = 10n ** BigInt(dropDigits);
  const q = num / divisor;
  const r = num % divisor;
  const twice = r * 2n;
  if (twice > divisor) return q + 1n;
  if (twice < divisor) return q;
  return q % 2n === 0n ? q : q + 1n;
}

function padNumeric(sign: string, body: string, width: number, zero: boolean, minus: boolean): string {
  const total = sign.length + body.length;
  if (total >= width) return sign + body;
  const padLen = width - total;
  if (minus) return sign + body + ' '.repeat(padLen);
  if (zero) return sign + '0'.repeat(padLen) + body;
  return ' '.repeat(padLen) + sign + body;
}

function padText(body: string, width: number, minus: boolean): string {
  if (body.length >= width) return body;
  const padLen = width - body.length;
  return minus ? body + ' '.repeat(padLen) : ' '.repeat(padLen) + body;
}

function signFor(negative: boolean, flags: Flags): string {
  if (negative) return '-';
  if (flags.plus) return '+';
  if (flags.space) return ' ';
  return '';
}

function formatIntLike(conv: string, flags: Flags, width: number, precision: number | null, arg: number | bigint): string {
  const big = typeof arg === 'bigint' ? arg : BigInt(arg as number);

  if (conv === 'd' || conv === 'i') {
    const negative = big < 0n;
    const magnitude = negative ? -big : big;
    let digits = magnitude === 0n && precision === 0 ? '' : magnitude.toString();
    if (precision !== null && digits.length < precision) {
      digits = digits.padStart(precision, '0');
    }
    const sign = signFor(negative, flags);
    const zero = flags.zero && precision === null;
    return padNumeric(sign, digits, width, zero, flags.minus);
  }

  // x, X, o
  const magnitude = big;
  const base = conv === 'o' ? 8 : 16;
  let digits = magnitude.toString(base);
  if (conv === 'X') digits = digits.toUpperCase();
  if (magnitude === 0n && precision === 0) digits = '';
  if (precision !== null && digits.length < precision) {
    digits = digits.padStart(precision, '0');
  }
  let prefix = '';
  if (flags.hash) {
    if ((conv === 'x' || conv === 'X') && magnitude !== 0n) {
      prefix = conv === 'x' ? '0x' : '0X';
    } else if (conv === 'o') {
      if (digits.length === 0 || digits[0] !== '0') {
        digits = '0' + digits;
      }
    }
  }
  const zero = flags.zero && precision === null;
  return padNumeric(prefix, digits, width, zero, flags.minus);
}

type FloatDigits = { leadDigit: string; fracDigits: string; exp: number };

function computeEStyle(num: bigint, scale: number, p: number): FloatDigits {
  if (num === 0n) {
    return { leadDigit: '0', fracDigits: '0'.repeat(p), exp: 0 };
  }
  const numDigits = num.toString().length;
  let e0 = numDigits - 1 - scale;
  const dropDigits = numDigits - (p + 1);
  let r = roundToDigits(num, dropDigits);
  let rstr = r.toString();
  if (rstr.length === p + 2) {
    r = r / 10n;
    e0 += 1;
    rstr = r.toString();
  }
  rstr = rstr.padStart(p + 1, '0');
  return { leadDigit: rstr[0], fracDigits: rstr.slice(1), exp: e0 };
}

function computeFStyle(num: bigint, scale: number, p: number): { intPart: string; fracDigits: string } {
  if (num === 0n) {
    return { intPart: '0', fracDigits: '0'.repeat(p) };
  }
  const dropDigits = scale - p;
  const r = roundToDigits(num, dropDigits);
  const rstr = r.toString().padStart(p + 1, '0');
  const cut = rstr.length - p;
  const intPart = rstr.slice(0, cut) || '0';
  const fracDigits = p > 0 ? rstr.slice(cut) : '';
  return { intPart, fracDigits };
}

function expString(e0: number, upper: boolean): string {
  const sign = e0 < 0 ? '-' : '+';
  const digits = Math.abs(e0).toString().padStart(2, '0');
  return (upper ? 'E' : 'e') + sign + digits;
}

function formatFloat(conv: string, flags: Flags, width: number, precision: number | null, arg: number): string {
  const upper = conv === 'E' || conv === 'F';

  if (Number.isNaN(arg)) {
    const body = upper ? 'NAN' : 'nan';
    return padNumeric('', body, width, false, flags.minus);
  }
  if (!Number.isFinite(arg)) {
    const negative = arg < 0;
    const sign = signFor(negative, flags);
    const body = upper ? 'INF' : 'inf';
    return padNumeric(sign, body, width, false, flags.minus);
  }

  const negative = arg < 0 || Object.is(arg, -0);
  const sign = signFor(negative, flags);
  const { mantissa, exp } = decomposeFloat(arg);
  const { num, scale } = toExactDecimal(mantissa, exp);

  if (conv === 'e' || conv === 'E') {
    const p = precision === null ? 6 : precision;
    const { leadDigit, fracDigits, exp: e0 } = computeEStyle(num, scale, p);
    let mant = leadDigit;
    if (p > 0) mant += '.' + fracDigits;
    else if (flags.hash) mant += '.';
    const body = mant + expString(e0, conv === 'E');
    const zero = flags.zero;
    return padNumeric(sign, body, width, zero, flags.minus);
  }

  if (conv === 'f' || conv === 'F') {
    const p = precision === null ? 6 : precision;
    const { intPart, fracDigits } = computeFStyle(num, scale, p);
    let body = intPart;
    if (p > 0) body += '.' + fracDigits;
    else if (flags.hash) body += '.';
    const zero = flags.zero;
    return padNumeric(sign, body, width, zero, flags.minus);
  }

  // g, G
  const upperG = conv === 'G';
  let precIn = precision === null ? 6 : precision;
  const P = precIn === 0 ? 1 : precIn;
  const eDigits = computeEStyle(num, scale, P - 1);
  const X = eDigits.exp;
  let bodyDigitsFrac: string;
  let assembled: string;
  if (P > X && X >= -4) {
    const fPrec = P - 1 - X;
    const { intPart, fracDigits } = computeFStyle(num, scale, fPrec);
    bodyDigitsFrac = fracDigits;
    let frac = fracDigits;
    if (!flags.hash) {
      frac = frac.replace(/0+$/, '');
    }
    assembled = intPart + (frac.length > 0 ? '.' + frac : flags.hash ? '.' : '');
  } else {
    let frac = eDigits.fracDigits;
    if (!flags.hash) {
      frac = frac.replace(/0+$/, '');
    }
    const mant = eDigits.leadDigit + (frac.length > 0 ? '.' + frac : flags.hash ? '.' : '');
    assembled = mant + expString(X, upperG);
  }
  const zero = flags.zero;
  return padNumeric(sign, assembled, width, zero, flags.minus);
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let argi = 0;
  let out = '';
  let i = 0;
  const n = fmt.length;
  while (i < n) {
    const ch = fmt[i];
    if (ch !== '%') {
      out += ch;
      i++;
      continue;
    }
    i++;
    if (fmt[i] === '%') {
      out += '%';
      i++;
      continue;
    }
    const flags: Flags = { minus: false, plus: false, space: false, zero: false, hash: false };
    while (true) {
      const c = fmt[i];
      if (c === '-') { flags.minus = true; i++; }
      else if (c === '+') { flags.plus = true; i++; }
      else if (c === ' ') { flags.space = true; i++; }
      else if (c === '0') { flags.zero = true; i++; }
      else if (c === '#') { flags.hash = true; i++; }
      else break;
    }
    let widthStr = '';
    while (fmt[i] >= '0' && fmt[i] <= '9') { widthStr += fmt[i]; i++; }
    const width = widthStr ? parseInt(widthStr, 10) : 0;
    let precision: number | null = null;
    if (fmt[i] === '.') {
      i++;
      let precStr = '';
      while (fmt[i] >= '0' && fmt[i] <= '9') { precStr += fmt[i]; i++; }
      precision = precStr ? parseInt(precStr, 10) : 0;
    }
    const conv = fmt[i];
    i++;
    const arg = args[argi++];

    if (conv === 'd' || conv === 'i' || conv === 'x' || conv === 'X' || conv === 'o') {
      out += formatIntLike(conv, flags, width, precision, arg as number | bigint);
    } else if (conv === 'e' || conv === 'E' || conv === 'f' || conv === 'F' || conv === 'g' || conv === 'G') {
      out += formatFloat(conv, flags, width, precision, arg as number);
    } else if (conv === 's') {
      let s = arg as string;
      if (precision !== null) s = s.slice(0, precision);
      out += padText(s, width, flags.minus);
    } else if (conv === 'c') {
      out += padText(arg as string, width, flags.minus);
    }
  }
  return out;
}
