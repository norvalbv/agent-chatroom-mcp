export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let out = '';
  let argIndex = 0;
  const nextArg = () => args[argIndex++];

  let i = 0;
  while (i < fmt.length) {
    const ch = fmt[i];
    if (ch !== '%') {
      out += ch;
      i++;
      continue;
    }

    i++; // skip '%'
    if (fmt[i] === '%') {
      out += '%';
      i++;
      continue;
    }

    // flags
    const flags = { minus: false, plus: false, space: false, zero: false, hash: false };
    while (i < fmt.length) {
      const c = fmt[i];
      if (c === '-') { flags.minus = true; i++; }
      else if (c === '+') { flags.plus = true; i++; }
      else if (c === ' ') { flags.space = true; i++; }
      else if (c === '0') { flags.zero = true; i++; }
      else if (c === '#') { flags.hash = true; i++; }
      else break;
    }

    // width
    let width = 0;
    let widthStart = i;
    while (i < fmt.length && fmt[i] >= '0' && fmt[i] <= '9') i++;
    if (i > widthStart) width = parseInt(fmt.slice(widthStart, i), 10);

    // precision
    let precision: number | undefined = undefined;
    if (fmt[i] === '.') {
      i++;
      let precStart = i;
      while (i < fmt.length && fmt[i] >= '0' && fmt[i] <= '9') i++;
      precision = i > precStart ? parseInt(fmt.slice(precStart, i), 10) : 0;
    }

    const conv = fmt[i];
    i++;

    out += formatOne(conv, flags, width, precision, nextArg());
  }

  return out;
}

type Flags = { minus: boolean; plus: boolean; space: boolean; zero: boolean; hash: boolean };

function toBig(v: number | bigint): bigint {
  return typeof v === 'bigint' ? v : BigInt(v);
}

function padSpacesOrLeft(core: string, width: number, minus: boolean): string {
  if (core.length >= width) return core;
  const pad = ' '.repeat(width - core.length);
  return minus ? core + pad : pad + core;
}

function padNumeric(signPrefix: string, digits: string, width: number, flags: Flags, zeroAllowed: boolean): string {
  const core = signPrefix + digits;
  if (core.length >= width) return core;
  if (flags.minus) return core + ' '.repeat(width - core.length);
  if (flags.zero && zeroAllowed) return signPrefix + '0'.repeat(width - core.length) + digits;
  return ' '.repeat(width - core.length) + core;
}

function formatOne(
  conv: string,
  flags: Flags,
  width: number,
  precision: number | undefined,
  arg: number | bigint | string
): string {
  switch (conv) {
    case 'd':
    case 'i':
      return formatIntDec(toBig(arg as number | bigint), flags, width, precision);
    case 'x':
    case 'X':
    case 'o':
      return formatIntBase(conv, toBig(arg as number | bigint), flags, width, precision);
    case 'e':
    case 'E':
    case 'f':
    case 'F':
    case 'g':
    case 'G':
      return formatFloat(conv, Number(arg), flags, width, precision);
    case 's':
      return formatString(String(arg), flags, width, precision);
    case 'c':
      return formatString(String(arg), flags, width, undefined);
    default:
      throw new Error(`unsupported conversion: ${conv}`);
  }
}

function formatString(s: string, flags: Flags, width: number, precision: number | undefined): string {
  let body = precision !== undefined ? s.slice(0, precision) : s;
  return padSpacesOrLeft(body, width, flags.minus);
}

function formatIntDec(value: bigint, flags: Flags, width: number, precision: number | undefined): string {
  const neg = value < 0n;
  const abs = neg ? -value : value;
  let digits: string;
  if (precision === 0 && abs === 0n) {
    digits = '';
  } else {
    digits = abs.toString(10);
    if (precision !== undefined && digits.length < precision) {
      digits = '0'.repeat(precision - digits.length) + digits;
    }
  }
  const sign = neg ? '-' : flags.plus ? '+' : flags.space ? ' ' : '';
  const zeroAllowed = precision === undefined;
  return padNumeric(sign, digits, width, flags, zeroAllowed);
}

function formatIntBase(conv: string, value: bigint, flags: Flags, width: number, precision: number | undefined): string {
  const abs = value < 0n ? -value : value;
  const base = conv === 'o' ? 8 : 16;
  let digits: string;
  if (precision === 0 && abs === 0n) {
    digits = '';
  } else {
    digits = abs.toString(base);
    if (conv === 'X') digits = digits.toUpperCase();
    if (precision !== undefined && digits.length < precision) {
      digits = '0'.repeat(precision - digits.length) + digits;
    }
  }

  let prefix = '';
  if (flags.hash) {
    if (conv === 'o') {
      if (digits.length === 0 || digits[0] !== '0') {
        digits = '0' + digits;
      }
    } else {
      if (abs !== 0n) {
        prefix = conv === 'X' ? '0X' : '0x';
      }
    }
  }

  const zeroAllowed = precision === undefined;
  return padNumeric(prefix, digits, width, flags, zeroAllowed);
}

// ---- exact binary -> decimal helpers ----

function decompose(absValue: number): { m: bigint; e: number } {
  if (absValue === 0) return { m: 0n, e: 0 };
  const buf = new ArrayBuffer(8);
  const dv = new DataView(buf);
  dv.setFloat64(0, absValue);
  const hi = BigInt(dv.getUint32(0) >>> 0);
  const lo = BigInt(dv.getUint32(4) >>> 0);
  const bits = (hi << 32n) | lo;
  const expBits = Number((bits >> 52n) & 0x7ffn);
  const fracBits = bits & 0xfffffffffffffn;
  if (expBits === 0) {
    return { m: fracBits, e: -1074 };
  }
  return { m: fracBits | (1n << 52n), e: expBits - 1075 };
}

function pow5(n: number): bigint {
  return 5n ** BigInt(n);
}
function pow2(n: number): bigint {
  return 1n << BigInt(n);
}

// round(m * 2^e * 10^k) to nearest integer, ties to even. m >= 0.
function roundedScaledInt(m: bigint, e: number, k: number): bigint {
  if (m === 0n) return 0n;
  let N: bigint, D: bigint;
  if (k >= 0) {
    const shift = e + k;
    if (shift >= 0) {
      return m * pow5(k) * pow2(shift);
    }
    N = m * pow5(k);
    D = pow2(-shift);
  } else {
    const j = -k;
    const shift = e - j;
    if (shift >= 0) {
      N = m * pow2(shift);
      D = pow5(j);
    } else {
      N = m;
      D = pow5(j) * pow2(-shift);
    }
  }
  let q = N / D;
  const r = N % D;
  const twice = r * 2n;
  if (twice > D || (twice === D && q % 2n === 1n)) {
    q += 1n;
  }
  return q;
}

function formatFixedDigits(m: bigint, e: number, precision: number): { intPart: string; fracPart: string } {
  const R = roundedScaledInt(m, e, precision);
  let s = R.toString();
  if (precision > 0) {
    while (s.length <= precision) s = '0' + s;
    return { intPart: s.slice(0, s.length - precision), fracPart: s.slice(s.length - precision) };
  }
  return { intPart: s, fracPart: '' };
}

function eStyleDigits(absValue: number, m: bigint, e: number, precision: number): { digits: string; exp: number } {
  if (absValue === 0) {
    return { digits: '0'.repeat(precision + 1), exp: 0 };
  }
  let X = Math.floor(Math.log10(absValue));
  if (!isFinite(X)) X = 0;
  let digits = '';
  for (let iter = 0; iter < 10; iter++) {
    const k = precision - X;
    const R = roundedScaledInt(m, e, k);
    digits = R.toString();
    if (digits.length === precision + 1) break;
    X += digits.length - (precision + 1);
  }
  return { digits, exp: X };
}

function stripTrailingZeros(s: string): string {
  let end = s.length;
  while (end > 0 && s[end - 1] === '0') end--;
  return s.slice(0, end);
}

function formatFloat(conv: string, v: number, flags: Flags, width: number, precision: number | undefined): string {
  const upper = conv === 'E' || conv === 'F' || conv === 'G';
  const isNaNVal = Number.isNaN(v);
  const signBit = !isNaNVal && (v < 0 || Object.is(v, -0));
  const sign = isNaNVal ? '' : signBit ? '-' : flags.plus ? '+' : flags.space ? ' ' : '';

  if (isNaNVal || !isFinite(v)) {
    const word = isNaNVal ? 'nan' : 'inf';
    const body = upper ? word.toUpperCase() : word;
    const core = sign + body;
    return padSpacesOrLeft(core, width, flags.minus);
  }

  const absValue = Math.abs(v);
  const { m, e } = decompose(absValue);
  let body: string;

  if (conv === 'f' || conv === 'F') {
    const p = precision === undefined ? 6 : precision;
    const { intPart, fracPart } = formatFixedDigits(m, e, p);
    const dot = p > 0 || flags.hash ? '.' : '';
    body = intPart + dot + fracPart;
  } else if (conv === 'e' || conv === 'E') {
    const p = precision === undefined ? 6 : precision;
    const { digits, exp } = eStyleDigits(absValue, m, e, p);
    const mantissa = digits[0];
    const frac = digits.slice(1);
    const dot = p > 0 || flags.hash ? '.' : '';
    const expSign = exp >= 0 ? '+' : '-';
    let expDigits = Math.abs(exp).toString();
    if (expDigits.length < 2) expDigits = '0' + expDigits;
    const eLetter = upper ? 'E' : 'e';
    body = mantissa + dot + frac + eLetter + expSign + expDigits;
  } else {
    // g, G
    const P = precision === undefined ? 6 : precision === 0 ? 1 : precision;
    const { digits, exp: X } = eStyleDigits(absValue, m, e, P - 1);
    if (P > X && X >= -4) {
      let intPart: string;
      let fracPart: string;
      if (X >= 0) {
        intPart = digits.slice(0, X + 1);
        fracPart = digits.slice(X + 1);
      } else {
        intPart = '0';
        fracPart = '0'.repeat(-X - 1) + digits;
      }
      if (!flags.hash) {
        fracPart = stripTrailingZeros(fracPart);
      }
      const dot = flags.hash || fracPart.length > 0 ? '.' : '';
      body = intPart + dot + fracPart;
    } else {
      const mantissa = digits[0];
      let frac = digits.slice(1);
      if (!flags.hash) {
        frac = stripTrailingZeros(frac);
      }
      const dot = flags.hash || frac.length > 0 ? '.' : '';
      const expSign = X >= 0 ? '+' : '-';
      let expDigits = Math.abs(X).toString();
      if (expDigits.length < 2) expDigits = '0' + expDigits;
      const eLetter = upper ? 'E' : 'e';
      body = mantissa + dot + frac + eLetter + expSign + expDigits;
    }
  }

  return padNumeric(sign, body, width, flags, true);
}
