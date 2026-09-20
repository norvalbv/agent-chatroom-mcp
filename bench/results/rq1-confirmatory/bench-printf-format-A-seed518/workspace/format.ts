// Exact decimal representation of a positive finite double as M * 10^-k,
// where M is an integer (BigInt) and k >= 0, derived from the IEEE-754 bits.
function splitExact(x: number): { M: bigint; k: number } {
  const buf = new ArrayBuffer(8);
  const dv = new DataView(buf);
  dv.setFloat64(0, x);
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const exponentBits = (hi >>> 20) & 0x7ff;
  const mantHi = BigInt(hi & 0xfffff);
  const mantLo = BigInt(lo >>> 0);
  const mantissa = (mantHi << 32n) | mantLo;
  let m: bigint;
  let e: number;
  if (exponentBits === 0) {
    m = mantissa;
    e = -1074;
  } else {
    m = mantissa | (1n << 52n);
    e = exponentBits - 1023 - 52;
  }
  if (e >= 0) {
    return { M: m << BigInt(e), k: 0 };
  }
  const k = -e;
  return { M: m * 5n ** BigInt(k), k };
}

// Divides M by 10^dropDigits with round-half-to-even (dropDigits may be
// negative, in which case it multiplies by 10^-dropDigits instead).
function roundHalfEvenDiv(M: bigint, dropDigits: number): bigint {
  if (dropDigits <= 0) return M * 10n ** BigInt(-dropDigits);
  const p = 10n ** BigInt(dropDigits);
  const q = M / p;
  const r = M % p;
  const twice = r * 2n;
  if (twice > p) return q + 1n;
  if (twice < p) return q;
  return q % 2n === 0n ? q : q + 1n;
}

function isNegativeZero(x: number): boolean {
  return x === 0 && 1 / x < 0;
}

function signBit(x: number): boolean {
  return x < 0 || isNegativeZero(x);
}

function padSimple(text: string, width: number, leftAlign: boolean): string {
  if (text.length >= width) return text;
  const pad = ' '.repeat(width - text.length);
  return leftAlign ? text + pad : pad + text;
}

// sign + prefix + digits, padded to width; '0' flag zero-pads between
// sign/prefix and digits, '-' flag left-aligns with spaces.
function padNumeric(
  sign: string,
  prefix: string,
  digits: string,
  width: number,
  flags: string
): string {
  const body = sign + prefix + digits;
  if (body.length >= width) return body;
  const padLen = width - body.length;
  if (flags.includes('-')) return body + ' '.repeat(padLen);
  if (flags.includes('0')) return sign + prefix + '0'.repeat(padLen) + digits;
  return ' '.repeat(padLen) + body;
}

function formatIntLike(
  conv: string,
  flags: string,
  width: number,
  precision: number | null,
  arg: number | bigint | string
): string {
  const value = BigInt(arg as number | bigint);
  if (conv === 'd' || conv === 'i') {
    const neg = value < 0n;
    const mag = neg ? -value : value;
    let digits = mag.toString();
    if (precision !== null) {
      digits = precision === 0 && mag === 0n ? '' : digits.padStart(precision, '0');
    }
    const sign = neg ? '-' : flags.includes('+') ? '+' : flags.includes(' ') ? ' ' : '';
    const effFlags = precision !== null ? flags.replace(/0/g, '') : flags;
    return padNumeric(sign, '', digits, width, effFlags);
  }

  // x, X, o
  const base = conv === 'o' ? 8 : 16;
  let digits = value.toString(base);
  if (precision !== null) {
    digits = precision === 0 && value === 0n ? '' : digits.padStart(precision, '0');
  }
  if (flags.includes('#')) {
    if (conv === 'o') {
      if (digits.length === 0 || digits[0] !== '0') digits = '0' + digits;
    }
  }
  let prefix = '';
  if (conv !== 'o' && flags.includes('#') && value !== 0n) {
    prefix = conv === 'X' ? '0X' : '0x';
  }
  if (conv === 'X') digits = digits.toUpperCase();
  const effFlags = precision !== null ? flags.replace(/0/g, '') : flags;
  return padNumeric('', prefix, digits, width, effFlags);
}

interface FStyle {
  intPart: string;
  fracDigits: string;
}

function fStyleDigits(M: bigint, k: number, fp: number): FStyle {
  const R = roundHalfEvenDiv(M, k - fp);
  const Rstr = R.toString().padStart(fp + 1, '0');
  if (fp === 0) return { intPart: Rstr, fracDigits: '' };
  return {
    intPart: Rstr.slice(0, Rstr.length - fp),
    fracDigits: Rstr.slice(Rstr.length - fp),
  };
}

interface EStyle {
  intPart: string;
  fracDigits: string;
  exp: number;
}

function eStyleDigits(M: bigint, len: number, exp0: number, ep: number): EStyle {
  const sigWanted = ep + 1;
  const dropCount = len - sigWanted;
  const R = roundHalfEvenDiv(M, dropCount);
  let Rstr = R.toString();
  let exp = exp0;
  if (Rstr.length > sigWanted) {
    exp += 1;
    Rstr = Rstr.slice(0, sigWanted);
  }
  return { intPart: Rstr[0], fracDigits: Rstr.slice(1), exp };
}

function formatFloatLike(
  conv: string,
  flags: string,
  width: number,
  precision: number | null,
  arg: number | bigint | string
): string {
  const x = arg as number;
  const upper = conv === 'E' || conv === 'F' || conv === 'G';

  if (Number.isNaN(x)) {
    const text = upper ? 'NAN' : 'nan';
    return padSimple(text, width, flags.includes('-'));
  }
  if (!Number.isFinite(x)) {
    const sign = x < 0 ? '-' : flags.includes('+') ? '+' : flags.includes(' ') ? ' ' : '';
    const text = upper ? 'INF' : 'inf';
    const effFlags = flags.replace(/0/g, '');
    return padNumeric(sign, '', text, width, effFlags);
  }

  const sign = signBit(x) ? '-' : flags.includes('+') ? '+' : flags.includes(' ') ? ' ' : '';
  const magnitude = Math.abs(x);
  const hasHash = flags.includes('#');

  let digitsFull: string;

  if (conv === 'e' || conv === 'E') {
    const prec = precision === null ? 6 : precision;
    let intPart: string, fracDigits: string, exp: number;
    if (magnitude === 0) {
      intPart = '0';
      fracDigits = '0'.repeat(prec);
      exp = 0;
    } else {
      const { M, k } = splitExact(magnitude);
      const digits = M.toString();
      const len = digits.length;
      const exp0 = len - 1 - k;
      ({ intPart, fracDigits, exp } = eStyleDigits(M, len, exp0, prec));
    }
    const fracPart = prec === 0 ? (hasHash ? '.' : '') : '.' + fracDigits;
    const eChar = conv === 'E' ? 'E' : 'e';
    const expSign = exp >= 0 ? '+' : '-';
    const expAbs = Math.abs(exp).toString().padStart(2, '0');
    digitsFull = intPart + fracPart + eChar + expSign + expAbs;
  } else if (conv === 'f' || conv === 'F') {
    const prec = precision === null ? 6 : precision;
    let intPart: string, fracDigits: string;
    if (magnitude === 0) {
      intPart = '0';
      fracDigits = '0'.repeat(prec);
    } else {
      const { M, k } = splitExact(magnitude);
      ({ intPart, fracDigits } = fStyleDigits(M, k, prec));
    }
    const fracPart = prec === 0 ? (hasHash ? '.' : '') : '.' + fracDigits;
    digitsFull = intPart + fracPart;
  } else {
    // g, G
    let P = precision === null ? 6 : precision;
    if (P === 0) P = 1;
    let intPart: string, fracDigits: string, useE: boolean, exp = 0;

    if (magnitude === 0) {
      useE = false;
      intPart = '0';
      fracDigits = '0'.repeat(P - 1);
    } else {
      const { M, k } = splitExact(magnitude);
      const digits = M.toString();
      const len = digits.length;
      const exp0 = len - 1 - k;

      const e = eStyleDigits(M, len, exp0, P - 1);
      const X = e.exp;

      if (P > X && X >= -4) {
        useE = false;
        const fp = P - 1 - X;
        ({ intPart, fracDigits } = fStyleDigits(M, k, fp));
      } else {
        useE = true;
        intPart = e.intPart;
        fracDigits = e.fracDigits;
        exp = e.exp;
      }
    }

    if (!hasHash) {
      fracDigits = fracDigits.replace(/0+$/, '');
    }
    const fracPart = fracDigits.length === 0 ? (hasHash ? '.' : '') : '.' + fracDigits;

    if (useE) {
      const eChar = conv === 'G' ? 'E' : 'e';
      const expSign = exp >= 0 ? '+' : '-';
      const expAbs = Math.abs(exp).toString().padStart(2, '0');
      digitsFull = intPart + fracPart + eChar + expSign + expAbs;
    } else {
      digitsFull = intPart + fracPart;
    }
  }

  return padNumeric(sign, '', digitsFull, width, flags);
}

function formatSpec(
  conv: string,
  flags: string,
  width: number,
  precision: number | null,
  arg: number | bigint | string
): string {
  switch (conv) {
    case 'd':
    case 'i':
    case 'x':
    case 'X':
    case 'o':
      return formatIntLike(conv, flags, width, precision, arg);
    case 'e':
    case 'E':
    case 'f':
    case 'F':
    case 'g':
    case 'G':
      return formatFloatLike(conv, flags, width, precision, arg);
    case 's': {
      let text = arg as string;
      if (precision !== null) text = text.slice(0, precision);
      return padSimple(text, width, flags.includes('-'));
    }
    case 'c': {
      const text = arg as string;
      return padSimple(text, width, flags.includes('-'));
    }
    default:
      throw new Error(`unsupported conversion: ${conv}`);
  }
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let out = '';
  let argi = 0;
  let i = 0;
  const n = fmt.length;
  while (i < n) {
    const c = fmt[i];
    if (c !== '%') {
      out += c;
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
      out += '%';
      i = j;
      continue;
    }
    const width = widthStr ? parseInt(widthStr, 10) : 0;
    const precision = precStr !== null ? (precStr === '' ? 0 : parseInt(precStr, 10)) : null;
    const arg = args[argi++];
    out += formatSpec(conv, flags, width, precision, arg);
    i = j;
  }
  return out;
}
