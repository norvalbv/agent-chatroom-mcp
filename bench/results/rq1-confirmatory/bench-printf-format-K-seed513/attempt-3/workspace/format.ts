type Flags = {
  minus: boolean;
  plus: boolean;
  space: boolean;
  zero: boolean;
  hash: boolean;
  width: number;
  precision: number | null;
};

function decompose(x: number): { m: bigint; e: number } {
  const buf = new ArrayBuffer(8);
  const dv = new DataView(buf);
  dv.setFloat64(0, x);
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  let exp = (hi >>> 20) & 0x7ff;
  const mantHi = hi & 0xfffff;
  const mant = (BigInt(mantHi) << 32n) | BigInt(lo);
  let m: bigint;
  let e: number;
  if (exp === 0) {
    m = mant;
    e = -1074;
  } else {
    m = mant | (1n << 52n);
    e = exp - 1075;
  }
  return { m, e };
}

// Returns round(m * 2^e * 10^k) with ties-to-even, exact.
function roundScaled(m: bigint, e: number, k: number): bigint {
  let num = m;
  let den = 1n;
  if (k >= 0) num *= 5n ** BigInt(k);
  else den *= 5n ** BigInt(-k);
  const e2 = e + k;
  if (e2 >= 0) num <<= BigInt(e2);
  else den <<= BigInt(-e2);
  let q = num / den;
  const r = num - q * den;
  const twiceR = r * 2n;
  if (twiceR > den) q += 1n;
  else if (twiceR === den && q % 2n === 1n) q += 1n;
  return q;
}

function fDigits(absValue: number, p: number): { intPart: string; fracPart: string } {
  if (absValue === 0) {
    return { intPart: '0', fracPart: '0'.repeat(p) };
  }
  const { m, e } = decompose(absValue);
  const R = roundScaled(m, e, p);
  const s = R.toString().padStart(p + 1, '0');
  const intPart = s.slice(0, s.length - p);
  const fracPart = p > 0 ? s.slice(s.length - p) : '';
  return { intPart, fracPart };
}

function eDigits(absValue: number, P: number): { digits: string; X: number } {
  if (absValue === 0) {
    return { digits: '0'.repeat(P + 1), X: 0 };
  }
  const { m, e } = decompose(absValue);
  let X = Math.floor(Math.log10(absValue));
  const lower = 10n ** BigInt(P);
  const upper = 10n ** BigInt(P + 1);
  let R = roundScaled(m, e, P - X);
  while (R >= upper) {
    X++;
    R = roundScaled(m, e, P - X);
  }
  while (R < lower) {
    X--;
    R = roundScaled(m, e, P - X);
  }
  return { digits: R.toString(), X };
}

function pad(lead: string, digits: string, width: number, zeroFlag: boolean, left: boolean): string {
  const body = lead + digits;
  if (body.length >= width) return body;
  const padLen = width - body.length;
  if (left) return body + ' '.repeat(padLen);
  if (zeroFlag) return lead + '0'.repeat(padLen) + digits;
  return ' '.repeat(padLen) + body;
}

function signFor(negative: boolean, plus: boolean, space: boolean): string {
  if (negative) return '-';
  if (plus) return '+';
  if (space) return ' ';
  return '';
}

function digitStr(absValue: bigint, precision: number | null, base: number): string {
  if (absValue === 0n && precision === 0) return '';
  const natural = absValue.toString(base);
  if (precision === null) return natural;
  return natural.padStart(precision, '0');
}

function toIntegerAbs(value: number | bigint): { abs: bigint; negative: boolean } {
  if (typeof value === 'bigint') {
    return { abs: value < 0n ? -value : value, negative: value < 0n };
  }
  const negative = value < 0 || Object.is(value, -0);
  const abs = BigInt(Math.abs(value));
  return { abs, negative };
}

function toNonNegAbs(value: number | bigint): bigint {
  return typeof value === 'bigint' ? value : BigInt(value);
}

function formatFloat(value: number, conv: string, flags: Flags): string {
  const upper = conv === conv.toUpperCase();
  const base = conv.toLowerCase();
  const precision = flags.precision === null ? 6 : flags.precision;

  if (Number.isNaN(value)) {
    const text = upper ? 'NAN' : 'nan';
    return pad('', text, flags.width, false, flags.minus);
  }

  if (!Number.isFinite(value)) {
    const negative = value < 0;
    const sign = signFor(negative, flags.plus, flags.space);
    const text = upper ? 'INF' : 'inf';
    return pad(sign, text, flags.width, false, flags.minus);
  }

  const negative = value < 0 || Object.is(value, -0);
  const sign = signFor(negative, flags.plus, flags.space);
  const absValue = Math.abs(value);

  let rest: string;

  if (base === 'f') {
    const { intPart, fracPart } = fDigits(absValue, precision);
    const dot = precision > 0 || flags.hash;
    rest = intPart + (dot ? '.' : '') + (dot ? fracPart : '');
  } else if (base === 'e') {
    const { digits, X } = eDigits(absValue, precision);
    const d0 = digits[0];
    const frac = digits.slice(1);
    const dot = precision > 0 || flags.hash;
    const expLetter = upper ? 'E' : 'e';
    const expSign = X >= 0 ? '+' : '-';
    const expAbs = Math.abs(X).toString().padStart(2, '0');
    rest = d0 + (dot ? '.' : '') + (dot ? frac : '') + expLetter + expSign + expAbs;
  } else {
    // g
    const P = flags.precision === null ? 6 : flags.precision === 0 ? 1 : flags.precision;
    const { digits, X } = eDigits(absValue, P - 1);
    if (P > X && X >= -4) {
      const fPrecision = P - 1 - X;
      const { intPart, fracPart } = fDigits(absValue, fPrecision);
      let finalFrac = flags.hash ? fracPart : fracPart.replace(/0+$/, '');
      const dot = flags.hash || finalFrac.length > 0;
      rest = intPart + (dot ? '.' : '') + finalFrac;
    } else {
      const d0 = digits[0];
      const frac = digits.slice(1);
      let finalFrac = flags.hash ? frac : frac.replace(/0+$/, '');
      const dot = flags.hash || finalFrac.length > 0;
      const expLetter = upper ? 'E' : 'e';
      const expSign = X >= 0 ? '+' : '-';
      const expAbs = Math.abs(X).toString().padStart(2, '0');
      rest = d0 + (dot ? '.' : '') + finalFrac + expLetter + expSign + expAbs;
    }
  }

  const zeroEffective = flags.zero;
  return pad(sign, rest, flags.width, zeroEffective, flags.minus);
}

function convertOne(conv: string, arg: number | bigint | string, flags: Flags): string {
  switch (conv) {
    case 'd':
    case 'i': {
      const { abs, negative } = toIntegerAbs(arg as number | bigint);
      const sign = signFor(negative, flags.plus, flags.space);
      const digits = digitStr(abs, flags.precision, 10);
      const zeroEffective = flags.zero && flags.precision === null;
      return pad(sign, digits, flags.width, zeroEffective, flags.minus);
    }
    case 'x':
    case 'X': {
      const abs = toNonNegAbs(arg as number | bigint);
      let digits = digitStr(abs, flags.precision, 16);
      if (conv === 'X') digits = digits.toUpperCase();
      const prefix = flags.hash && abs !== 0n ? (conv === 'x' ? '0x' : '0X') : '';
      const zeroEffective = flags.zero && flags.precision === null;
      return pad(prefix, digits, flags.width, zeroEffective, flags.minus);
    }
    case 'o': {
      const abs = toNonNegAbs(arg as number | bigint);
      let digits = digitStr(abs, flags.precision, 8);
      if (flags.hash && (digits === '' || digits[0] !== '0')) digits = '0' + digits;
      const zeroEffective = flags.zero && flags.precision === null;
      return pad('', digits, flags.width, zeroEffective, flags.minus);
    }
    case 'e':
    case 'E':
    case 'f':
    case 'F':
    case 'g':
    case 'G':
      return formatFloat(arg as number, conv, flags);
    case 's': {
      let str = arg as string;
      if (flags.precision !== null) str = str.slice(0, flags.precision);
      return pad('', str, flags.width, false, flags.minus);
    }
    case 'c': {
      return pad('', arg as string, flags.width, false, flags.minus);
    }
    default:
      throw new Error(`unsupported conversion: ${conv}`);
  }
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
    let minus = false;
    let plus = false;
    let space = false;
    let zero = false;
    let hash = false;
    while (true) {
      const c = fmt[i];
      if (c === '-') {
        minus = true;
        i++;
      } else if (c === '+') {
        plus = true;
        i++;
      } else if (c === ' ') {
        space = true;
        i++;
      } else if (c === '0') {
        zero = true;
        i++;
      } else if (c === '#') {
        hash = true;
        i++;
      } else {
        break;
      }
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
    result += convertOne(conv, arg, { minus, plus, space, zero, hash, width, precision });
  }
  return result;
}
