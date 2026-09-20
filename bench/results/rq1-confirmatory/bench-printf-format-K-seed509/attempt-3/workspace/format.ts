export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let out = '';
  let argi = 0;
  let i = 0;
  while (i < fmt.length) {
    const c = fmt[i];
    if (c !== '%') {
      out += c;
      i++;
      continue;
    }
    let j = i + 1;
    let flagsStr = '';
    while (j < fmt.length && '-+0 #'.includes(fmt[j])) {
      flagsStr += fmt[j];
      j++;
    }
    let widthStr = '';
    while (j < fmt.length && fmt[j] >= '0' && fmt[j] <= '9') {
      widthStr += fmt[j];
      j++;
    }
    let precStr: string | null = null;
    if (fmt[j] === '.') {
      j++;
      precStr = '';
      while (j < fmt.length && fmt[j] >= '0' && fmt[j] <= '9') {
        precStr += fmt[j];
        j++;
      }
    }
    const conv = fmt[j];
    j++;
    if (conv === '%') {
      out += '%';
      i = j;
      continue;
    }
    const flags = new Set(flagsStr.split(''));
    const width = widthStr ? parseInt(widthStr, 10) : 0;
    const precision = precStr !== null ? (precStr === '' ? 0 : parseInt(precStr, 10)) : null;
    const arg = args[argi++];
    out += formatOne(conv, flags, width, precision, arg);
    i = j;
  }
  return out;
}

function formatOne(
  conv: string,
  flags: Set<string>,
  width: number,
  precision: number | null,
  arg: number | bigint | string
): string {
  switch (conv) {
    case 'd':
    case 'i':
      return fmtDI(flags, width, precision, arg as number | bigint);
    case 'x':
    case 'X':
    case 'o':
      return fmtXXO(conv, flags, width, precision, arg as number | bigint);
    case 'e':
    case 'E':
      return fmtE(arg as number, conv === 'E', flags, width, precision);
    case 'f':
    case 'F':
      return fmtF(arg as number, conv === 'F', flags, width, precision);
    case 'g':
    case 'G':
      return fmtG(arg as number, conv === 'G', flags, width, precision);
    case 's':
      return fmtS(flags, width, precision, arg as string);
    case 'c':
      return fmtC(flags, width, arg as string);
    default:
      throw new Error(`unsupported conversion: ${conv}`);
  }
}

function padNumeric(
  sign: string,
  prefix: string,
  digits: string,
  width: number,
  flags: Set<string>,
  zeroAllowed: boolean
): string {
  const leftAlign = flags.has('-');
  const zero = flags.has('0') && !leftAlign && zeroAllowed;
  const body = sign + prefix + digits;
  if (body.length >= width) return body;
  const padLen = width - body.length;
  if (leftAlign) return body + ' '.repeat(padLen);
  if (zero) return sign + prefix + '0'.repeat(padLen) + digits;
  return ' '.repeat(padLen) + body;
}

function toBigInt(arg: number | bigint): bigint {
  return typeof arg === 'bigint' ? arg : BigInt(arg);
}

function fmtDI(flags: Set<string>, width: number, precision: number | null, arg: number | bigint): string {
  const n = toBigInt(arg);
  const neg = n < 0n;
  const abs = neg ? -n : n;
  let digits = abs.toString();
  if (precision !== null) {
    if (precision === 0 && abs === 0n) digits = '';
    else if (digits.length < precision) digits = '0'.repeat(precision - digits.length) + digits;
  }
  const sign = neg ? '-' : flags.has('+') ? '+' : flags.has(' ') ? ' ' : '';
  const zeroAllowed = precision === null;
  return padNumeric(sign, '', digits, width, flags, zeroAllowed);
}

function fmtXXO(
  conv: string,
  flags: Set<string>,
  width: number,
  precision: number | null,
  arg: number | bigint
): string {
  const n = toBigInt(arg);
  let digits = conv === 'o' ? n.toString(8) : n.toString(16);
  if (conv === 'X') digits = digits.toUpperCase();

  if (precision === 0 && n === 0n) digits = '';
  else if (precision !== null && digits.length < precision) {
    digits = '0'.repeat(precision - digits.length) + digits;
  }

  if (conv === 'o' && flags.has('#')) {
    if (digits.length === 0 || digits[0] !== '0') digits = '0' + digits;
  }

  let prefix = '';
  if (conv !== 'o' && flags.has('#') && n !== 0n) prefix = conv === 'x' ? '0x' : '0X';

  const zeroAllowed = precision === null;
  return padNumeric('', prefix, digits, width, flags, zeroAllowed);
}

function isNegativeNum(v: number): boolean {
  return v < 0 || Object.is(v, -0);
}

function computeSign(neg: boolean, flags: Set<string>): string {
  if (neg) return '-';
  if (flags.has('+')) return '+';
  if (flags.has(' ')) return ' ';
  return '';
}

function decompose(v: number): { num: bigint; den: bigint } {
  const buf = new ArrayBuffer(8);
  const view = new DataView(buf);
  view.setFloat64(0, v);
  const hi = view.getUint32(0);
  const lo = view.getUint32(4);
  const expBits = (hi >>> 20) & 0x7ff;
  let mantissa = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo >>> 0);
  let exp2: number;
  if (expBits === 0) {
    exp2 = -1074;
  } else {
    mantissa = mantissa | (1n << 52n);
    exp2 = expBits - 1075;
  }
  if (exp2 >= 0) return { num: mantissa << BigInt(exp2), den: 1n };
  return { num: mantissa, den: 1n << BigInt(-exp2) };
}

function scaledRound(num: bigint, den: bigint, n: number): bigint {
  let numerator = num;
  let denominator = den;
  if (n >= 0) numerator *= 10n ** BigInt(n);
  else denominator *= 10n ** BigInt(-n);
  const q = numerator / denominator;
  const r = numerator % denominator;
  const twiceR = r * 2n;
  if (twiceR < denominator) return q;
  if (twiceR > denominator) return q + 1n;
  return q % 2n === 0n ? q : q + 1n;
}

function cmpToPow10(num: bigint, den: bigint, k: number): number {
  let lhs = num;
  let rhs = den;
  if (k >= 0) rhs = rhs * 10n ** BigInt(k);
  else lhs = lhs * 10n ** BigInt(-k);
  if (lhs < rhs) return -1;
  if (lhs > rhs) return 1;
  return 0;
}

function sigDigits(av: number, num: bigint, den: bigint, sig: number): { digits: string; exp: number } {
  let exp = Math.floor(Math.log10(av));
  while (cmpToPow10(num, den, exp) < 0) exp--;
  while (cmpToPow10(num, den, exp + 1) >= 0) exp++;
  const n = sig - 1 - exp;
  const scaled = scaledRound(num, den, n);
  let s = scaled.toString();
  if (s.length > sig) {
    exp += s.length - sig;
    s = s.slice(0, sig);
  } else if (s.length < sig) {
    s = '0'.repeat(sig - s.length) + s;
  }
  return { digits: s, exp };
}

function specialText(v: number, upper: boolean): string | null {
  if (Number.isNaN(v)) return upper ? 'NAN' : 'nan';
  if (!Number.isFinite(v)) return upper ? 'INF' : 'inf';
  return null;
}

function fmtF(v: number, upper: boolean, flags: Set<string>, width: number, precision: number | null): string {
  const sp = specialText(v, upper);
  if (sp !== null) {
    if (Number.isNaN(v)) return padNumeric('', '', sp, width, flags, false);
    const sign = computeSign(v < 0, flags);
    return padNumeric(sign, '', sp, width, flags, false);
  }
  const prec = precision === null ? 6 : precision;
  const neg = isNegativeNum(v);
  const sign = computeSign(neg, flags);
  const av = Math.abs(v);
  let intPart: string;
  let fracPart: string;
  if (av === 0) {
    intPart = '0';
    fracPart = '0'.repeat(prec);
  } else {
    const { num, den } = decompose(av);
    const scaled = scaledRound(num, den, prec);
    let s = scaled.toString();
    if (prec === 0) {
      intPart = s;
      fracPart = '';
    } else {
      if (s.length <= prec) s = '0'.repeat(prec - s.length + 1) + s;
      intPart = s.slice(0, s.length - prec);
      fracPart = s.slice(s.length - prec);
    }
  }
  let numStr = intPart;
  if (fracPart.length > 0 || flags.has('#')) numStr += '.' + fracPart;
  return padNumeric(sign, '', numStr, width, flags, true);
}

function fmtE(v: number, upper: boolean, flags: Set<string>, width: number, precision: number | null): string {
  const sp = specialText(v, upper);
  if (sp !== null) {
    if (Number.isNaN(v)) return padNumeric('', '', sp, width, flags, false);
    const sign = computeSign(v < 0, flags);
    return padNumeric(sign, '', sp, width, flags, false);
  }
  const prec = precision === null ? 6 : precision;
  const neg = isNegativeNum(v);
  const sign = computeSign(neg, flags);
  const av = Math.abs(v);
  let digits: string;
  let exp: number;
  if (av === 0) {
    digits = '0'.repeat(prec + 1);
    exp = 0;
  } else {
    const { num, den } = decompose(av);
    const r = sigDigits(av, num, den, prec + 1);
    digits = r.digits;
    exp = r.exp;
  }
  const mantissa = digits[0];
  const frac = digits.slice(1);
  let mantStr = mantissa;
  if (frac.length > 0 || flags.has('#')) mantStr += '.' + frac;
  const expSign = exp < 0 ? '-' : '+';
  let expAbs = Math.abs(exp).toString();
  if (expAbs.length < 2) expAbs = '0' + expAbs;
  const eChar = upper ? 'E' : 'e';
  const numStr = mantStr + eChar + expSign + expAbs;
  return padNumeric(sign, '', numStr, width, flags, true);
}

function trimTrailingZeros(intPart: string, fracPart: string, hasHash: boolean): string {
  if (!hasHash) fracPart = fracPart.replace(/0+$/, '');
  if (fracPart.length > 0 || hasHash) return intPart + '.' + fracPart;
  return intPart;
}

function fmtG(v: number, upper: boolean, flags: Set<string>, width: number, precision: number | null): string {
  const sp = specialText(v, upper);
  if (sp !== null) {
    if (Number.isNaN(v)) return padNumeric('', '', sp, width, flags, false);
    const sign = computeSign(v < 0, flags);
    return padNumeric(sign, '', sp, width, flags, false);
  }
  const P0 = precision === null ? 6 : precision === 0 ? 1 : precision;
  const neg = isNegativeNum(v);
  const sign = computeSign(neg, flags);
  const av = Math.abs(v);
  let digits: string;
  let X: number;
  if (av === 0) {
    digits = '0'.repeat(P0);
    X = 0;
  } else {
    const { num, den } = decompose(av);
    const r = sigDigits(av, num, den, P0);
    digits = r.digits;
    X = r.exp;
  }
  const hasHash = flags.has('#');
  let body: string;
  if (P0 > X && X >= -4) {
    let intPart: string;
    let fracPart: string;
    if (X >= 0) {
      intPart = digits.slice(0, X + 1);
      fracPart = digits.slice(X + 1);
    } else {
      intPart = '0';
      fracPart = '0'.repeat(-X - 1) + digits;
    }
    body = trimTrailingZeros(intPart, fracPart, hasHash);
  } else {
    const mantissa = digits[0];
    const frac = digits.slice(1);
    const mantStr = trimTrailingZeros(mantissa, frac, hasHash);
    const expSign = X < 0 ? '-' : '+';
    let expAbs = Math.abs(X).toString();
    if (expAbs.length < 2) expAbs = '0' + expAbs;
    const eChar = upper ? 'E' : 'e';
    body = mantStr + eChar + expSign + expAbs;
  }
  return padNumeric(sign, '', body, width, flags, true);
}

function fmtS(flags: Set<string>, width: number, precision: number | null, arg: string): string {
  let s = String(arg);
  if (precision !== null) s = s.slice(0, precision);
  return padNumeric('', '', s, width, flags, false);
}

function fmtC(flags: Set<string>, width: number, arg: string): string {
  const s = String(arg);
  return padNumeric('', '', s, width, flags, false);
}
