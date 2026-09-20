type Flags = {
  minus: boolean;
  plus: boolean;
  space: boolean;
  zero: boolean;
  hash: boolean;
};

function decompose(value: number): { sign: 0 | 1; m: bigint; e: number } {
  const buf = new ArrayBuffer(8);
  const dv = new DataView(buf);
  dv.setFloat64(0, value);
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const sign = (hi >>> 31) as 0 | 1;
  const expBits = (hi >>> 20) & 0x7ff;
  const mantHi = hi & 0xfffff;
  let mant = (BigInt(mantHi) << 32n) | BigInt(lo);
  if (expBits === 0) {
    return { sign, m: mant, e: -1074 };
  }
  mant |= 1n << 52n;
  return { sign, m: mant, e: expBits - 1075 };
}

// Returns round(m * 2^e * 10^n) using round-half-to-even on the exact value.
function roundedDigits(m: bigint, e: number, n: number): bigint {
  if (m === 0n) return 0n;
  const a = e + n;
  let numerator = m;
  let denominator = 1n;
  if (a >= 0) numerator *= 2n ** BigInt(a);
  else denominator *= 2n ** BigInt(-a);
  if (n >= 0) numerator *= 5n ** BigInt(n);
  else denominator *= 5n ** BigInt(-n);
  const q = numerator / denominator;
  const r = numerator % denominator;
  const twiceR = r * 2n;
  if (twiceR < denominator) return q;
  if (twiceR > denominator) return q + 1n;
  return q % 2n === 0n ? q : q + 1n;
}

function eDigits(
  m: bigint,
  e: number,
  p: number,
  absValue: number
): { digits: string; exp: number } {
  if (m === 0n) {
    return { digits: '0'.repeat(p + 1), exp: 0 };
  }
  let X = Math.floor(Math.log10(absValue));
  for (let tries = 0; tries < 30; tries++) {
    const n = p - X;
    const rd = roundedDigits(m, e, n);
    const s = rd.toString();
    if (s.length === p + 1) {
      return { digits: s, exp: X };
    }
    X += s.length - (p + 1);
  }
  throw new Error('failed to compute exponent');
}

function padNumeric(
  sign: string,
  prefix: string,
  digits: string,
  width: number,
  minus: boolean,
  zero: boolean
): string {
  const core = sign + prefix + digits;
  if (core.length >= width) return core;
  const padLen = width - core.length;
  if (minus) return core + ' '.repeat(padLen);
  if (zero) return sign + prefix + '0'.repeat(padLen) + digits;
  return ' '.repeat(padLen) + core;
}

function padGeneric(str: string, width: number, minus: boolean): string {
  if (str.length >= width) return str;
  const padLen = width - str.length;
  return minus ? str + ' '.repeat(padLen) : ' '.repeat(padLen) + str;
}

function signStr(neg: boolean, flags: Flags): string {
  if (neg) return '-';
  if (flags.plus) return '+';
  if (flags.space) return ' ';
  return '';
}

function convertD(
  value: number | bigint,
  flags: Flags,
  width: number,
  precision: number | null
): string {
  const n = typeof value === 'bigint' ? value : BigInt(value);
  const neg = n < 0n;
  const mag = neg ? -n : n;
  let digits = mag.toString();
  if (precision !== null) {
    if (precision === 0 && mag === 0n) digits = '';
    else digits = digits.padStart(precision, '0');
  }
  const sign = signStr(neg, flags);
  const zero = flags.zero && !flags.minus && precision === null;
  return padNumeric(sign, '', digits, width, flags.minus, zero);
}

function convertXXO(
  value: number | bigint,
  conv: string,
  flags: Flags,
  width: number,
  precision: number | null
): string {
  const n = typeof value === 'bigint' ? value : BigInt(value);
  const base = conv === 'o' ? 8 : 16;
  let digits = n.toString(base);
  if (conv === 'X') digits = digits.toUpperCase();
  let prec = precision;
  if (conv === 'o' && flags.hash) {
    const neededLen = digits.length + (digits[0] === '0' ? 0 : 1);
    if (prec === null || prec < neededLen) prec = neededLen;
  }
  if (prec !== null) {
    if (prec === 0 && n === 0n) digits = '';
    else digits = digits.padStart(prec, '0');
  }
  let prefix = '';
  if (flags.hash && conv !== 'o' && n !== 0n) {
    prefix = conv === 'X' ? '0X' : '0x';
  }
  const zero = flags.zero && !flags.minus && precision === null;
  return padNumeric('', prefix, digits, width, flags.minus, zero);
}

function convertFloat(
  conv: string,
  flags: Flags,
  width: number,
  precision: number | null,
  value: number
): string {
  const upper = conv === conv.toUpperCase();
  const d = decompose(value);
  const neg = d.sign === 1;

  if (Number.isNaN(value)) {
    const s = upper ? 'NAN' : 'nan';
    return padGeneric(s, width, flags.minus);
  }

  if (!Number.isFinite(value)) {
    const sign = signStr(neg, flags);
    const s = sign + (upper ? 'INF' : 'inf');
    return padGeneric(s, width, flags.minus);
  }

  const sign = signStr(neg, flags);
  const zero = flags.zero && !flags.minus;
  const lowerConv = conv.toLowerCase();
  const absValue = Math.abs(value);

  if (lowerConv === 'f') {
    const p = precision === null ? 6 : precision;
    const digitsInt = roundedDigits(d.m, d.e, p);
    let s = digitsInt.toString();
    if (s.length < p + 1) s = s.padStart(p + 1, '0');
    const intPart = p === 0 ? s : s.slice(0, s.length - p);
    const fracPart = p === 0 ? '' : s.slice(s.length - p);
    const body = intPart + (p > 0 || flags.hash ? '.' + fracPart : '');
    return padNumeric(sign, '', body, width, flags.minus, zero);
  }

  if (lowerConv === 'e') {
    const p = precision === null ? 6 : precision;
    const { digits, exp } = eDigits(d.m, d.e, p, absValue);
    const expLetter = conv === 'E' ? 'E' : 'e';
    const expSign = exp < 0 ? '-' : '+';
    const expAbs = Math.abs(exp).toString().padStart(2, '0');
    const mantissa = digits[0] + (p > 0 || flags.hash ? '.' + digits.slice(1) : '');
    const body = mantissa + expLetter + expSign + expAbs;
    return padNumeric(sign, '', body, width, flags.minus, zero);
  }

  // g, G
  let P = precision === null ? 6 : precision;
  if (P === 0) P = 1;
  const first = eDigits(d.m, d.e, P - 1, absValue);
  const X = first.exp;
  let body: string;
  if (P > X && X >= -4) {
    const fp = P - 1 - X;
    const digitsInt = roundedDigits(d.m, d.e, fp);
    let s = digitsInt.toString();
    if (s.length < fp + 1) s = s.padStart(fp + 1, '0');
    const intPart = fp === 0 ? s : s.slice(0, s.length - fp);
    let fracPart = fp === 0 ? '' : s.slice(s.length - fp);
    if (!flags.hash) fracPart = fracPart.replace(/0+$/, '');
    body = intPart + (fracPart.length > 0 || flags.hash ? '.' + fracPart : '');
  } else {
    let frac = first.digits.slice(1);
    if (!flags.hash) frac = frac.replace(/0+$/, '');
    const expLetter = conv === 'G' ? 'E' : 'e';
    const expSign = X < 0 ? '-' : '+';
    const expAbs = Math.abs(X).toString().padStart(2, '0');
    body =
      first.digits[0] +
      (frac.length > 0 || flags.hash ? '.' + frac : '') +
      expLetter +
      expSign +
      expAbs;
  }
  return padNumeric(sign, '', body, width, flags.minus, zero);
}

function convertS(value: string, flags: Flags, width: number, precision: number | null): string {
  const s = precision !== null ? value.slice(0, precision) : value;
  return padGeneric(s, width, flags.minus);
}

function convertC(value: string, flags: Flags, width: number): string {
  return padGeneric(value, width, flags.minus);
}

function convertOne(
  conv: string,
  flags: Flags,
  width: number,
  precision: number | null,
  arg: number | bigint | string
): string {
  switch (conv) {
    case 'd':
    case 'i':
      return convertD(arg as number | bigint, flags, width, precision);
    case 'x':
    case 'X':
    case 'o':
      return convertXXO(arg as number | bigint, conv, flags, width, precision);
    case 'e':
    case 'E':
    case 'f':
    case 'F':
    case 'g':
    case 'G':
      return convertFloat(conv, flags, width, precision, arg as number);
    case 's':
      return convertS(arg as string, flags, width, precision);
    case 'c':
      return convertC(arg as string, flags, width);
    default:
      throw new Error('unknown conversion: ' + conv);
  }
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let argIndex = 0;
  let result = '';
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
    while (true) {
      const c = fmt[i];
      if (c === '-') flags.minus = true;
      else if (c === '+') flags.plus = true;
      else if (c === ' ') flags.space = true;
      else if (c === '0') flags.zero = true;
      else if (c === '#') flags.hash = true;
      else break;
      i++;
    }
    let widthStr = '';
    while (fmt[i] >= '0' && fmt[i] <= '9') {
      widthStr += fmt[i];
      i++;
    }
    const width = widthStr ? parseInt(widthStr, 10) : 0;
    let precision: number | null = null;
    if (fmt[i] === '.') {
      i++;
      let precStr = '';
      while (fmt[i] >= '0' && fmt[i] <= '9') {
        precStr += fmt[i];
        i++;
      }
      precision = precStr ? parseInt(precStr, 10) : 0;
    }
    const conv = fmt[i];
    i++;
    const arg = args[argIndex++];
    result += convertOne(conv, flags, width, precision, arg);
  }
  return result;
}
