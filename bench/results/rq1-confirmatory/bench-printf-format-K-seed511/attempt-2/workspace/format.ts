type Flags = {
  minus: boolean;
  plus: boolean;
  space: boolean;
  zero: boolean;
  hash: boolean;
};

interface Spec {
  literal?: string;
  flags?: Flags;
  width?: number;
  precision?: number; // -1 means not given
  conv?: string;
}

function parseFormat(fmt: string): Spec[] {
  const specs: Spec[] = [];
  let i = 0;
  let lit = '';
  while (i < fmt.length) {
    const ch = fmt[i];
    if (ch !== '%') {
      lit += ch;
      i++;
      continue;
    }
    // ch === '%'
    if (lit) {
      specs.push({ literal: lit });
      lit = '';
    }
    i++; // skip %
    if (fmt[i] === '%') {
      specs.push({ literal: '%' });
      i++;
      continue;
    }
    const flags: Flags = { minus: false, plus: false, space: false, zero: false, hash: false };
    while (i < fmt.length && '-+ 0#'.includes(fmt[i])) {
      switch (fmt[i]) {
        case '-': flags.minus = true; break;
        case '+': flags.plus = true; break;
        case ' ': flags.space = true; break;
        case '0': flags.zero = true; break;
        case '#': flags.hash = true; break;
      }
      i++;
    }
    let width = 0;
    let widthStr = '';
    while (i < fmt.length && /[0-9]/.test(fmt[i])) {
      widthStr += fmt[i];
      i++;
    }
    if (widthStr) width = parseInt(widthStr, 10);
    let precision = -1;
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
    specs.push({ flags, width: widthStr ? width : 0, precision, conv });
  }
  if (lit) specs.push({ literal: lit });
  return specs;
}

function padResult(prefix: string, body: string, width: number, leftJustify: boolean, zeroPad: boolean): string {
  const total = prefix.length + body.length;
  if (total >= width) return prefix + body;
  const padLen = width - total;
  if (leftJustify) return prefix + body + ' '.repeat(padLen);
  if (zeroPad) return prefix + '0'.repeat(padLen) + body;
  return ' '.repeat(padLen) + prefix + body;
}

function toBigIntMagnitude(arg: number | bigint): bigint {
  if (typeof arg === 'bigint') return arg < 0n ? -arg : arg;
  return arg < 0 ? BigInt(-arg) : BigInt(arg);
}

function isNegativeArg(arg: number | bigint): boolean {
  if (typeof arg === 'bigint') return arg < 0n;
  return arg < 0;
}

function formatIntBody(magnitude: bigint, precision: number, radix: number, upper: boolean): string {
  let digits: string;
  if (precision === 0 && magnitude === 0n) {
    digits = '';
  } else {
    digits = magnitude.toString(radix);
    if (upper) digits = digits.toUpperCase();
  }
  if (precision > digits.length) {
    digits = '0'.repeat(precision - digits.length) + digits;
  }
  return digits;
}

function formatDI(magnitude: bigint, negative: boolean, flags: Flags, width: number, precision: number): string {
  const digits = precision >= 0 ? formatIntBody(magnitude, precision, 10, false) : formatIntBody(magnitude, 0, 10, false);
  let sign = '';
  if (negative) sign = '-';
  else if (flags.plus) sign = '+';
  else if (flags.space) sign = ' ';
  const zeroPad = flags.zero && !flags.minus && precision < 0;
  return padResult(sign, digits, width, flags.minus, zeroPad);
}

function formatXO(magnitude: bigint, flags: Flags, width: number, precision: number, radix: number, upper: boolean, isOctal: boolean): string {
  let digits = precision >= 0 ? formatIntBody(magnitude, precision, radix, upper) : formatIntBody(magnitude, 0, radix, upper);
  let prefix = '';
  if (flags.hash) {
    if (isOctal) {
      if (digits.length === 0 || digits[0] !== '0') {
        digits = '0' + digits;
      }
    } else {
      if (magnitude !== 0n) {
        prefix = upper ? '0X' : '0x';
      }
    }
  }
  const zeroPad = flags.zero && !flags.minus && precision < 0;
  return padResult(prefix, digits, width, flags.minus, zeroPad);
}

// Decompose a finite non-zero double's absolute value into mantissa * 2^exp (exact).
function decomposeDouble(x: number): { mantissa: bigint; exp: number } {
  const buf = new ArrayBuffer(8);
  const dv = new DataView(buf);
  dv.setFloat64(0, x);
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const exponentBits = (hi >>> 20) & 0x7ff;
  const mantHigh = hi & 0xfffff;
  const mantissaFrac = (BigInt(mantHigh) << 32n) | BigInt(lo >>> 0);
  let mantissa: bigint;
  let exp: number;
  if (exponentBits === 0) {
    mantissa = mantissaFrac;
    exp = -1074;
  } else {
    mantissa = mantissaFrac | (1n << 52n);
    exp = exponentBits - 1075;
  }
  return { mantissa, exp };
}

// round(mantissa * 2^exp * 10^shift) to nearest integer, ties to even. mantissa >= 0.
function scaledRound(mantissa: bigint, exp: number, shift: number): bigint {
  if (mantissa === 0n) return 0n;
  let numerator = mantissa;
  let denominator = 1n;
  if (shift >= 0) {
    numerator *= 10n ** BigInt(shift);
  } else {
    denominator *= 10n ** BigInt(-shift);
  }
  if (exp >= 0) {
    numerator *= 2n ** BigInt(exp);
  } else {
    denominator *= 2n ** BigInt(-exp);
  }
  if (denominator === 1n) return numerator;
  let q = numerator / denominator;
  const r = numerator % denominator;
  const twiceR = r * 2n;
  if (twiceR > denominator) q += 1n;
  else if (twiceR === denominator && q % 2n === 1n) q += 1n;
  return q;
}

function decimalExponent(mantissa: bigint, exp: number): number {
  const mNum = Number(mantissa);
  let E = Math.floor(Math.log10(mNum) + exp * Math.log10(2));
  const cmp = (Ecmp: number): number => {
    let lhs = mantissa;
    let rhs = 10n ** BigInt(Math.max(Ecmp, 0));
    if (exp >= 0) lhs *= 2n ** BigInt(exp);
    else rhs *= 2n ** BigInt(-exp);
    if (Ecmp < 0) lhs *= 10n ** BigInt(-Ecmp);
    if (lhs > rhs) return 1;
    if (lhs < rhs) return -1;
    return 0;
  };
  while (cmp(E) < 0) E--;
  while (cmp(E + 1) >= 0) E++;
  return E;
}

// Returns significant digits (precision+1 digits) and exponent, after rounding, for the e-style representation.
function eStyleDigits(mantissa: bigint, exp: number, precision: number): { digits: string; E: number } {
  if (mantissa === 0n) {
    return { digits: '0'.repeat(precision + 1), E: 0 };
  }
  let E = decimalExponent(mantissa, exp);
  const shift = precision - E;
  let rounded = scaledRound(mantissa, exp, shift);
  let s = rounded.toString();
  if (s.length < precision + 1) {
    s = '0'.repeat(precision + 1 - s.length) + s;
  }
  if (s.length === precision + 2) {
    s = s.slice(0, precision + 1);
    E += 1;
  }
  return { digits: s, E };
}

function fStyleParts(mantissa: bigint, exp: number, precision: number): { intPart: string; fracPart: string } {
  const rounded = scaledRound(mantissa, exp, precision);
  let s = rounded.toString();
  if (s.length < precision + 1) {
    s = '0'.repeat(precision + 1 - s.length) + s;
  }
  const intPart = s.slice(0, s.length - precision) || '0';
  const fracPart = precision > 0 ? s.slice(s.length - precision) : '';
  return { intPart, fracPart };
}

function floatSign(negative: boolean, flags: Flags): string {
  if (negative) return '-';
  if (flags.plus) return '+';
  if (flags.space) return ' ';
  return '';
}

function isNegativeNumber(x: number): boolean {
  return x < 0 || Object.is(x, -0);
}

function formatFloat(x: number, flags: Flags, width: number, precision: number, conv: string): string {
  const upper = conv === conv.toUpperCase() && conv !== conv.toLowerCase();
  const kind = conv.toLowerCase();

  if (Number.isNaN(x)) {
    const body = upper ? 'NAN' : 'nan';
    return padResult('', body, width, flags.minus, false);
  }
  if (!Number.isFinite(x)) {
    const negative = x < 0;
    const sign = floatSign(negative, flags);
    const body = upper ? 'INF' : 'inf';
    return padResult(sign, body, width, flags.minus, false);
  }

  const negative = isNegativeNumber(x);
  const absX = Math.abs(x);
  const { mantissa, exp } = absX === 0 ? { mantissa: 0n, exp: 0 } : decomposeDouble(absX);
  const sign = floatSign(negative, flags);
  const zeroPad = flags.zero && !flags.minus;

  if (kind === 'f') {
    const prec = precision >= 0 ? precision : 6;
    const { intPart, fracPart } = fStyleParts(mantissa, exp, prec);
    let body = intPart;
    if (prec > 0 || flags.hash) body += '.' + fracPart;
    return padResult(sign, body, width, flags.minus, zeroPad);
  }

  if (kind === 'e') {
    const prec = precision >= 0 ? precision : 6;
    const { digits, E } = eStyleDigits(mantissa, exp, prec);
    const digit0 = digits[0];
    const frac = digits.slice(1);
    let body = digit0;
    if (prec > 0 || flags.hash) body += '.' + frac;
    const eChar = upper ? 'E' : 'e';
    const expSign = E < 0 ? '-' : '+';
    let expDigits = Math.abs(E).toString();
    if (expDigits.length < 2) expDigits = '0'.repeat(2 - expDigits.length) + expDigits;
    body += eChar + expSign + expDigits;
    return padResult(sign, body, width, flags.minus, zeroPad);
  }

  // g / G
  const Pin = precision >= 0 ? precision : 6;
  const P = Pin === 0 ? 1 : Pin;
  const { digits, E } = eStyleDigits(mantissa, exp, P - 1);
  let body: string;
  if (P > E && E >= -4) {
    const fPrec = P - 1 - E;
    const { intPart, fracPart } = fStyleParts(mantissa, exp, Math.max(fPrec, 0));
    let frac = fracPart;
    let ip = intPart;
    if (!flags.hash) {
      frac = frac.replace(/0+$/, '');
      body = frac.length > 0 ? ip + '.' + frac : ip;
    } else {
      body = fPrec > 0 ? ip + '.' + frac : ip + (frac.length > 0 ? '.' + frac : '.');
    }
  } else {
    const digit0 = digits[0];
    let frac = digits.slice(1);
    if (!flags.hash) {
      frac = frac.replace(/0+$/, '');
    }
    let mantissaStr = frac.length > 0 ? digit0 + '.' + frac : (flags.hash ? digit0 + '.' : digit0);
    const eChar = upper ? 'E' : 'e';
    const expSign = E < 0 ? '-' : '+';
    let expDigits = Math.abs(E).toString();
    if (expDigits.length < 2) expDigits = '0'.repeat(2 - expDigits.length) + expDigits;
    body = mantissaStr + eChar + expSign + expDigits;
  }
  return padResult(sign, body, width, flags.minus, zeroPad);
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  const specs = parseFormat(fmt);
  let argIdx = 0;
  let out = '';
  for (const spec of specs) {
    if (spec.literal !== undefined) {
      out += spec.literal;
      continue;
    }
    const flags = spec.flags!;
    const width = spec.width!;
    const precision = spec.precision!;
    const conv = spec.conv!;
    const arg = args[argIdx++];

    switch (conv) {
      case 'd':
      case 'i': {
        const magnitude = toBigIntMagnitude(arg as number | bigint);
        const negative = isNegativeArg(arg as number | bigint);
        out += formatDI(magnitude, negative, flags, width, precision);
        break;
      }
      case 'x':
      case 'X':
      case 'o': {
        const magnitude = toBigIntMagnitude(arg as number | bigint);
        const radix = conv === 'o' ? 8 : 16;
        out += formatXO(magnitude, flags, width, precision, radix, conv === 'X', conv === 'o');
        break;
      }
      case 'e':
      case 'E':
      case 'f':
      case 'F':
      case 'g':
      case 'G': {
        out += formatFloat(arg as number, flags, width, precision, conv);
        break;
      }
      case 's': {
        let s = arg as string;
        if (precision >= 0) s = s.slice(0, precision);
        out += padResult('', s, width, flags.minus, false);
        break;
      }
      case 'c': {
        const s = arg as string;
        out += padResult('', s, width, flags.minus, false);
        break;
      }
    }
  }
  return out;
}
