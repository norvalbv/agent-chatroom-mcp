type Flags = {
  minus: boolean;
  plus: boolean;
  space: boolean;
  zero: boolean;
  hash: boolean;
};

function parseFlags(s: string): Flags {
  return {
    minus: s.includes('-'),
    plus: s.includes('+'),
    space: s.includes(' '),
    zero: s.includes('0'),
    hash: s.includes('#'),
  };
}

function toBigInt(v: number | bigint): bigint {
  return typeof v === 'bigint' ? v : BigInt(v);
}

// Round a/10^shiftRight to nearest integer, ties to even. shiftRight may be <= 0.
function rescale(n: bigint, shiftRight: number): bigint {
  if (shiftRight <= 0) return n * 10n ** BigInt(-shiftRight);
  const divisor = 10n ** BigInt(shiftRight);
  const q = n / divisor;
  const r = n % divisor;
  const twice = r * 2n;
  if (twice < divisor) return q;
  if (twice > divisor) return q + 1n;
  return q % 2n === 0n ? q : q + 1n;
}

interface Decomposed {
  negative: boolean;
  special: 'inf' | 'nan' | null;
  n: bigint; // exact magnitude = n * 10^e
  e: number;
}

function decompose(x: number): Decomposed {
  if (Number.isNaN(x)) return { negative: false, special: 'nan', n: 0n, e: 0 };
  if (!Number.isFinite(x)) return { negative: x < 0, special: 'inf', n: 0n, e: 0 };

  const buf = new ArrayBuffer(8);
  const dv = new DataView(buf);
  dv.setFloat64(0, x);
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);

  const negative = (hi >>> 31) === 1;
  const expBits = (hi >>> 20) & 0x7ff;
  const mantHi = hi & 0xfffff;
  const mantissa = (BigInt(mantHi) << 32n) | BigInt(lo >>> 0);

  let m: bigint;
  let exp: number;
  if (expBits === 0) {
    m = mantissa;
    exp = -1074;
  } else {
    m = mantissa | (1n << 52n);
    exp = expBits - 1075;
  }

  let n: bigint;
  let e: number;
  if (exp >= 0) {
    n = m << BigInt(exp);
    e = 0;
  } else {
    n = m * 5n ** BigInt(-exp);
    e = exp;
  }

  return { negative, special: null, n, e };
}

function formatF(n: bigint, e: number, precision: number): { intPart: string; fracPart: string } {
  const shift = -(e + precision);
  const r = rescale(n, shift);
  let s = r.toString();
  if (precision === 0) return { intPart: s, fracPart: '' };
  if (s.length <= precision) s = '0'.repeat(precision - s.length + 1) + s;
  return { intPart: s.slice(0, s.length - precision), fracPart: s.slice(s.length - precision) };
}

function formatSig(n: bigint, e: number, p: number): { digits: string; x: number } {
  if (n === 0n) return { digits: '0'.repeat(p), x: 0 };
  const ns = n.toString();
  const l = ns.length;
  let x0 = l - 1 + e;
  const shift = x0 - e - (p - 1);
  let r = rescale(n, shift);
  let rs = r.toString();
  while (rs.length > p) {
    r = r / 10n;
    x0 += 1;
    rs = r.toString();
  }
  if (rs.length < p) rs = rs.padStart(p, '0');
  return { digits: rs, x: x0 };
}

function trimTrailingZeros(frac: string, hash: boolean): string {
  if (hash) return frac;
  let end = frac.length;
  while (end > 0 && frac[end - 1] === '0') end--;
  return frac.slice(0, end);
}

function padNumber(
  sign: string,
  prefix: string,
  digits: string,
  width: number | undefined,
  flags: Flags,
  canZeroPad: boolean
): string {
  const body = sign + prefix + digits;
  if (width === undefined || width <= body.length) return body;
  const padLen = width - body.length;
  if (flags.minus) return body + ' '.repeat(padLen);
  if (flags.zero && canZeroPad) return sign + prefix + '0'.repeat(padLen) + digits;
  return ' '.repeat(padLen) + body;
}

function formatInt(value: bigint, conv: string, flags: Flags, width: number | undefined, precision: number | undefined): string {
  if (conv === 'd' || conv === 'i') {
    const negative = value < 0n;
    const mag = negative ? -value : value;
    let digits = mag.toString(10);
    if (precision !== undefined) {
      if (precision === 0 && mag === 0n) digits = '';
      else if (digits.length < precision) digits = '0'.repeat(precision - digits.length) + digits;
    }
    const sign = negative ? '-' : flags.plus ? '+' : flags.space ? ' ' : '';
    const canZero = flags.zero && !flags.minus && precision === undefined;
    return padNumber(sign, '', digits, width, flags, canZero);
  }

  // x, X, o
  let digits = value.toString(conv === 'o' ? 8 : 16);
  if (conv === 'X') digits = digits.toUpperCase();
  if (precision !== undefined) {
    if (precision === 0 && value === 0n) digits = '';
    else if (digits.length < precision) digits = '0'.repeat(precision - digits.length) + digits;
  }
  let prefix = '';
  if (flags.hash) {
    if (conv === 'x' && value !== 0n) prefix = '0x';
    else if (conv === 'X' && value !== 0n) prefix = '0X';
    else if (conv === 'o') {
      if (digits.length === 0 || digits[0] !== '0') digits = '0' + digits;
    }
  }
  const canZero = flags.zero && !flags.minus && precision === undefined;
  return padNumber('', prefix, digits, width, flags, canZero);
}

function signChar(negative: boolean, flags: Flags, noSign: boolean): string {
  if (noSign) return '';
  if (negative) return '-';
  if (flags.plus) return '+';
  if (flags.space) return ' ';
  return '';
}

function assembleFloat(sign: string, body: string, width: number | undefined, flags: Flags, allowZeroPad: boolean): string {
  const total = sign.length + body.length;
  if (width === undefined || width <= total) return sign + body;
  const padLen = width - total;
  if (flags.minus) return sign + body + ' '.repeat(padLen);
  if (flags.zero && allowZeroPad) return sign + '0'.repeat(padLen) + body;
  return ' '.repeat(padLen) + sign + body;
}

function formatFloatConv(
  value: number,
  conv: string,
  flags: Flags,
  width: number | undefined,
  precision: number | undefined
): string {
  const upper = conv === 'F' || conv === 'E' || conv === 'G';
  const base = conv.toLowerCase();
  const d = decompose(value);

  if (d.special === 'nan') {
    const body = upper ? 'NAN' : 'nan';
    return assembleFloat('', body, width, flags, false);
  }
  if (d.special === 'inf') {
    const body = upper ? 'INF' : 'inf';
    const sign = signChar(d.negative, flags, false);
    return assembleFloat(sign, body, width, flags, false);
  }

  const sign = signChar(d.negative, flags, false);

  if (base === 'f') {
    const p = precision === undefined ? 6 : precision;
    const { intPart, fracPart } = formatF(d.n, d.e, p);
    const showDot = p > 0 || flags.hash;
    const body = intPart + (showDot ? '.' + fracPart : '');
    return assembleFloat(sign, body, width, flags, true);
  }

  if (base === 'e') {
    const p = precision === undefined ? 6 : precision;
    const { digits, x } = formatSig(d.n, d.e, p + 1);
    const intPart = digits[0];
    const fracPart = digits.slice(1);
    const showDot = p > 0 || flags.hash;
    const mantissa = intPart + (showDot ? '.' + fracPart : '');
    const expSign = x < 0 ? '-' : '+';
    const expDigits = Math.abs(x).toString().padStart(2, '0');
    const eChar = upper ? 'E' : 'e';
    const body = mantissa + eChar + expSign + expDigits;
    return assembleFloat(sign, body, width, flags, true);
  }

  // g / G
  let p = precision === undefined ? 6 : precision;
  if (p === 0) p = 1;
  const { digits, x } = formatSig(d.n, d.e, p);

  let body: string;
  if (p > x && x >= -4) {
    let intPart: string;
    let fracPart: string;
    if (x >= 0) {
      intPart = digits.slice(0, x + 1);
      fracPart = digits.slice(x + 1);
    } else {
      intPart = '0';
      fracPart = '0'.repeat(-x - 1) + digits;
    }
    fracPart = trimTrailingZeros(fracPart, flags.hash);
    const showDot = fracPart.length > 0 || flags.hash;
    body = intPart + (showDot ? '.' + fracPart : '');
  } else {
    const intPart = digits[0];
    let fracPart = digits.slice(1);
    fracPart = trimTrailingZeros(fracPart, flags.hash);
    const showDot = fracPart.length > 0 || flags.hash;
    const eChar = upper ? 'E' : 'e';
    const expSign = x < 0 ? '-' : '+';
    const expDigits = Math.abs(x).toString().padStart(2, '0');
    body = intPart + (showDot ? '.' + fracPart : '') + eChar + expSign + expDigits;
  }

  return assembleFloat(sign, body, width, flags, true);
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let result = '';
  let argIndex = 0;
  const re = /%([-+ 0#]*)(\d*)(?:\.(\d*))?([diouxXeEfFgGsc%])/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = re.exec(fmt)) !== null) {
    result += fmt.slice(lastIndex, match.index);
    lastIndex = re.lastIndex;

    const [, flagsStr, widthStr, precisionStr, conv] = match;

    if (conv === '%') {
      result += '%';
      continue;
    }

    const flags = parseFlags(flagsStr);
    const width = widthStr === '' ? undefined : parseInt(widthStr, 10);
    const precision = precisionStr === undefined ? undefined : precisionStr === '' ? 0 : parseInt(precisionStr, 10);

    const arg = args[argIndex++];

    if (conv === 'd' || conv === 'i') {
      result += formatInt(toBigInt(arg as number | bigint), conv, flags, width, precision);
    } else if (conv === 'x' || conv === 'X' || conv === 'o') {
      result += formatInt(toBigInt(arg as number | bigint), conv, flags, width, precision);
    } else if (conv === 'e' || conv === 'E' || conv === 'f' || conv === 'F' || conv === 'g' || conv === 'G') {
      result += formatFloatConv(arg as number, conv, flags, width, precision);
    } else if (conv === 's') {
      let s = arg as string;
      if (precision !== undefined) s = s.slice(0, precision);
      if (width !== undefined && width > s.length) {
        const padLen = width - s.length;
        s = flags.minus ? s + ' '.repeat(padLen) : ' '.repeat(padLen) + s;
      }
      result += s;
    } else if (conv === 'c') {
      let s = arg as string;
      if (width !== undefined && width > s.length) {
        const padLen = width - s.length;
        s = flags.minus ? s + ' '.repeat(padLen) : ' '.repeat(padLen) + s;
      }
      result += s;
    }
  }

  result += fmt.slice(lastIndex);
  return result;
}
