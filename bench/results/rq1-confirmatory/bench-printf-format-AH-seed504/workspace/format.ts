export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let result = '';
  let argIdx = 0;
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
    if (fmt[j] === '%') {
      result += '%';
      i = j + 1;
      continue;
    }

    let flags = '';
    while (j < n && '-+0 #'.includes(fmt[j])) {
      flags += fmt[j];
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

    const arg = args[argIdx++];
    result += formatOne(conv, flags, width, precision, arg);
    i = j;
  }

  return result;
}

function pad(sign: string, prefix: string, digits: string, width: number, flags: string, zeroPadAllowed: boolean): string {
  const content = sign + prefix + digits;
  const padLen = width - content.length;
  if (padLen <= 0) return content;
  if (flags.includes('-')) return content + ' '.repeat(padLen);
  if (zeroPadAllowed && flags.includes('0')) return sign + prefix + '0'.repeat(padLen) + digits;
  return ' '.repeat(padLen) + content;
}

function toBig(arg: number | bigint): bigint {
  return typeof arg === 'bigint' ? arg : BigInt(Math.trunc(arg));
}

function formatOne(conv: string, flags: string, width: number, precision: number | null, arg: number | bigint | string): string {
  switch (conv) {
    case 'd':
    case 'i':
      return fmtDI(flags, width, precision, arg as number | bigint);
    case 'x':
      return fmtHexOct(flags, width, precision, arg as number | bigint, 16, false);
    case 'X':
      return fmtHexOct(flags, width, precision, arg as number | bigint, 16, true);
    case 'o':
      return fmtHexOct(flags, width, precision, arg as number | bigint, 8, false);
    case 'e':
    case 'E':
    case 'f':
    case 'F':
    case 'g':
    case 'G':
      return fmtFloat(conv, flags, width, precision, arg as number);
    case 's': {
      let str = arg as string;
      if (precision !== null) str = str.slice(0, precision);
      return pad('', '', str, width, flags, false);
    }
    case 'c':
      return pad('', '', arg as string, width, flags, false);
    default:
      throw new Error(`unsupported conversion: %${conv}`);
  }
}

function fmtDI(flags: string, width: number, precision: number | null, arg: number | bigint): string {
  let big = toBig(arg);
  const neg = big < 0n;
  if (neg) big = -big;
  let digits = big.toString();
  if (precision !== null) {
    digits = precision === 0 && big === 0n ? '' : digits.padStart(precision, '0');
  }
  const sign = neg ? '-' : flags.includes('+') ? '+' : flags.includes(' ') ? ' ' : '';
  return pad(sign, '', digits, width, flags, precision === null);
}

function fmtHexOct(flags: string, width: number, precision: number | null, arg: number | bigint, base: 16 | 8, upper: boolean): string {
  const big = toBig(arg);
  let digits = big.toString(base);
  if (upper) digits = digits.toUpperCase();
  if (precision !== null) {
    digits = precision === 0 && big === 0n ? '' : digits.padStart(precision, '0');
  }
  let prefix = '';
  if (base === 8) {
    if (flags.includes('#') && (digits.length === 0 || digits[0] !== '0')) {
      digits = '0' + digits;
    }
  } else {
    if (flags.includes('#') && big !== 0n) {
      prefix = upper ? '0X' : '0x';
    }
  }
  return pad('', prefix, digits, width, flags, precision === null);
}

interface Decomposed {
  neg: boolean;
  N: bigint;
  E: number;
}

function decompose(x: number): Decomposed {
  const neg = x < 0 || Object.is(x, -0);
  const abs = Math.abs(x);
  const buf = new ArrayBuffer(8);
  const dv = new DataView(buf);
  dv.setFloat64(0, abs, false);
  const bits = dv.getBigUint64(0, false);
  const expBits = (bits >> 52n) & 0x7ffn;
  const fracBits = bits & 0xfffffffffffffn;

  let mantissa: bigint;
  let exp: number;
  if (expBits === 0n) {
    mantissa = fracBits;
    exp = -1074;
  } else {
    mantissa = fracBits + (1n << 52n);
    exp = Number(expBits) - 1075;
  }

  let N: bigint;
  let E: number;
  if (mantissa === 0n) {
    N = 0n;
    E = 0;
  } else if (exp >= 0) {
    N = mantissa << BigInt(exp);
    E = 0;
  } else {
    N = mantissa * 5n ** BigInt(-exp);
    E = exp;
  }

  return { neg, N, E };
}

function scaleRound(N: bigint, shift: number): bigint {
  if (shift <= 0) return N * 10n ** BigInt(-shift);
  const divisor = 10n ** BigInt(shift);
  const q = N / divisor;
  const r = N % divisor;
  const twice = r * 2n;
  if (twice > divisor) return q + 1n;
  if (twice === divisor && q % 2n !== 0n) return q + 1n;
  return q;
}

function genFixedDigits(N: bigint, E: number, k: number): { intPart: string; fracPart: string } {
  const M = scaleRound(N, -E - k);
  let s = M.toString();
  if (s.length < k + 1) s = s.padStart(k + 1, '0');
  const intPart = k > 0 ? s.slice(0, s.length - k) : s;
  const fracPart = k > 0 ? s.slice(s.length - k) : '';
  return { intPart, fracPart };
}

function genExpDigits(N: bigint, E: number, sig: number): { digits: string; X: number } {
  if (N === 0n) {
    return { digits: '0'.repeat(sig), X: 0 };
  }
  const Ndigits = N.toString();
  const L = Ndigits.length;
  const X0 = L - 1 + E;
  const shift = L - sig;
  const M = scaleRound(N, shift);
  const Mdigits = M.toString();
  if (Mdigits.length > sig) {
    return { digits: Mdigits.slice(0, sig), X: X0 + 1 };
  }
  return { digits: Mdigits.padStart(sig, '0'), X: X0 };
}

function fmtFloat(conv: string, flags: string, width: number, precision: number | null, x: number): string {
  const isUpper = conv === 'E' || conv === 'F' || conv === 'G';
  const hasHash = flags.includes('#');

  if (Number.isNaN(x)) {
    return pad('', '', isUpper ? 'NAN' : 'nan', width, flags, false);
  }

  const negForSign = x < 0 || Object.is(x, -0);
  if (!Number.isFinite(x)) {
    const sign = negForSign ? '-' : flags.includes('+') ? '+' : flags.includes(' ') ? ' ' : '';
    return pad(sign, '', isUpper ? 'INF' : 'inf', width, flags, false);
  }

  const { neg, N, E } = decompose(x);
  const sign = neg ? '-' : flags.includes('+') ? '+' : flags.includes(' ') ? ' ' : '';
  const eLetter = conv === 'E' || conv === 'G' ? 'E' : 'e';

  let digitsPart: string;

  switch (conv.toLowerCase()) {
    case 'f': {
      const k = precision === null ? 6 : precision;
      const { intPart, fracPart } = genFixedDigits(N, E, k);
      digitsPart = intPart + (k > 0 ? '.' + fracPart : hasHash ? '.' : '');
      break;
    }
    case 'e': {
      const p = precision === null ? 6 : precision;
      const { digits, X } = genExpDigits(N, E, p + 1);
      const rest = digits.slice(1);
      const mantissaStr = digits[0] + (p > 0 ? '.' + rest : hasHash ? '.' : '');
      const expSign = X < 0 ? '-' : '+';
      const expAbs = Math.abs(X).toString().padStart(2, '0');
      digitsPart = mantissaStr + eLetter + expSign + expAbs;
      break;
    }
    case 'g': {
      let p = precision === null ? 6 : precision;
      if (p === 0) p = 1;
      const { digits, X } = genExpDigits(N, E, p);
      if (X >= -4 && X < p) {
        const k = p - 1 - X;
        const { intPart, fracPart } = genFixedDigits(N, E, k);
        let frac = fracPart;
        if (!hasHash) frac = frac.replace(/0+$/, '');
        digitsPart = intPart + (frac.length > 0 ? '.' + frac : hasHash ? '.' : '');
      } else {
        let mant = digits.slice(1);
        if (!hasHash) mant = mant.replace(/0+$/, '');
        const mantissaStr = digits[0] + (mant.length > 0 ? '.' + mant : hasHash ? '.' : '');
        const expSign = X < 0 ? '-' : '+';
        const expAbs = Math.abs(X).toString().padStart(2, '0');
        digitsPart = mantissaStr + eLetter + expSign + expAbs;
      }
      break;
    }
    default:
      throw new Error(`unsupported conversion: %${conv}`);
  }

  return pad(sign, '', digitsPart, width, flags, true);
}
