type Flags = { minus: boolean; plus: boolean; space: boolean; zero: boolean; hash: boolean };

function parseFlags(s: string): Flags {
  return {
    minus: s.includes('-'),
    plus: s.includes('+'),
    space: s.includes(' '),
    zero: s.includes('0'),
    hash: s.includes('#'),
  };
}

function incrementDecimalString(s: string): string {
  const arr = s.split('');
  let i = arr.length - 1;
  while (i >= 0) {
    if (arr[i] === '9') {
      arr[i] = '0';
      i--;
    } else {
      arr[i] = String(Number(arr[i]) + 1);
      return arr.join('');
    }
  }
  return '1' + arr.join('');
}

// Round intPart.fracPart (exact decimal digit strings) to `precision` fractional digits,
// using round-half-to-even on the exact value.
function roundFixed(intPart: string, fracPart: string, precision: number): { intPart: string; fracPart: string } {
  if (fracPart.length <= precision) {
    return { intPart, fracPart: fracPart.padEnd(precision, '0') };
  }
  const kept = fracPart.slice(0, precision);
  const rest = fracPart.slice(precision);
  let roundUp = false;
  const firstRest = rest[0];
  if (firstRest > '5') {
    roundUp = true;
  } else if (firstRest === '5') {
    if (/[1-9]/.test(rest.slice(1))) {
      roundUp = true;
    } else {
      const lastDigit = precision > 0 ? kept[precision - 1] : intPart[intPart.length - 1];
      roundUp = Number(lastDigit) % 2 === 1;
    }
  }
  let combined = intPart + kept;
  if (roundUp) combined = incrementDecimalString(combined);
  const newFrac = precision > 0 ? combined.slice(combined.length - precision) : '';
  const newInt = precision > 0 ? combined.slice(0, combined.length - precision) : combined;
  return { intPart: newInt.length ? newInt : '0', fracPart: newFrac };
}

// Round a significant-digit string to P digits, round-half-to-even. Returns the possibly
// carried digits (always length P) plus an exponent adjustment (0 or 1).
function roundSignificant(digits: string, P: number): { digits: string; expAdjust: number } {
  if (digits.length <= P) {
    return { digits: digits.padEnd(P, '0'), expAdjust: 0 };
  }
  const kept = digits.slice(0, P);
  const rest = digits.slice(P);
  let roundUp = false;
  const firstRest = rest[0];
  if (firstRest > '5') {
    roundUp = true;
  } else if (firstRest === '5') {
    if (/[1-9]/.test(rest.slice(1))) {
      roundUp = true;
    } else {
      roundUp = Number(kept[P - 1]) % 2 === 1;
    }
  }
  if (!roundUp) return { digits: kept, expAdjust: 0 };
  const combined = incrementDecimalString(kept);
  if (combined.length > P) {
    return { digits: combined.slice(0, P), expAdjust: 1 };
  }
  return { digits: combined, expAdjust: 0 };
}

const dvBuf = new ArrayBuffer(8);
const dv = new DataView(dvBuf);

// Exact decimal digits of |x| for a finite, nonzero double x.
function bigDecimalAbs(x: number): { intPart: string; fracPart: string } {
  dv.setFloat64(0, Math.abs(x));
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const expBits = (hi >>> 20) & 0x7ff;
  const hiFrac = hi & 0xfffff;
  const fracBig = (BigInt(hiFrac) << 32n) | BigInt(lo >>> 0);
  let mantissa: bigint;
  let e2: number;
  if (expBits === 0) {
    mantissa = fracBig;
    e2 = 1 - 1023 - 52;
  } else {
    mantissa = (1n << 52n) | fracBig;
    e2 = expBits - 1023 - 52;
  }
  let N: bigint;
  let k: number;
  if (e2 >= 0) {
    N = mantissa << BigInt(e2);
    k = 0;
  } else {
    const m = -e2;
    N = mantissa * 5n ** BigInt(m);
    k = m;
  }
  const s = N.toString();
  if (k === 0) return { intPart: s, fracPart: '' };
  if (s.length > k) return { intPart: s.slice(0, s.length - k), fracPart: s.slice(s.length - k) };
  return { intPart: '0', fracPart: '0'.repeat(k - s.length) + s };
}

// Normalized significant digits of |x| (x finite, nonzero): value = 0.d1d2... * 10^(E+1)
function normalizedDigits(x: number): { digits: string; E: number } {
  const { intPart, fracPart } = bigDecimalAbs(x);
  if (intPart !== '0') {
    return { digits: intPart + fracPart, E: intPart.length - 1 };
  }
  const idx = fracPart.search(/[1-9]/);
  if (idx === -1) return { digits: '0', E: 0 };
  return { digits: fracPart.slice(idx), E: -(idx + 1) };
}

function isNegative(x: number): boolean {
  return x < 0 || Object.is(x, -0);
}

type Piece = { signPrefix: string; body: string; zeroEligible: boolean };

function pad(piece: Piece, width: number, flags: Flags): string {
  const core = piece.signPrefix + piece.body;
  if (core.length >= width) return core;
  const padLen = width - core.length;
  if (flags.minus) return core + ' '.repeat(padLen);
  if (flags.zero && piece.zeroEligible) return piece.signPrefix + '0'.repeat(padLen) + piece.body;
  return ' '.repeat(padLen) + core;
}

function signPrefixFor(negative: boolean, flags: Flags): string {
  if (negative) return '-';
  if (flags.plus) return '+';
  if (flags.space) return ' ';
  return '';
}

function fmtDI(value: number | bigint, flags: Flags, precision: number | null): Piece {
  let neg: boolean;
  let mag: bigint;
  if (typeof value === 'bigint') {
    neg = value < 0n;
    mag = neg ? -value : value;
  } else {
    neg = value < 0;
    mag = BigInt(Math.abs(value));
  }
  let digits: string;
  if (precision === 0 && mag === 0n) {
    digits = '';
  } else {
    digits = mag.toString();
    if (precision !== null) digits = digits.padStart(precision, '0');
  }
  return { signPrefix: signPrefixFor(neg, flags), body: digits, zeroEligible: precision === null };
}

function fmtXXO(value: number | bigint, conv: 'x' | 'X' | 'o', flags: Flags, precision: number | null): Piece {
  const mag = typeof value === 'bigint' ? value : BigInt(value);
  const base = conv === 'o' ? 8 : 16;
  let digits = mag.toString(base);
  if (conv === 'X') digits = digits.toUpperCase();
  if (precision === 0 && mag === 0n) {
    digits = '';
  } else if (precision !== null) {
    digits = digits.padStart(precision, '0');
  }
  let prefix = '';
  if (flags.hash) {
    if ((conv === 'x' || conv === 'X') && mag !== 0n) {
      prefix = conv === 'x' ? '0x' : '0X';
    } else if (conv === 'o') {
      if (digits.length === 0 || digits[0] !== '0') digits = '0' + digits;
    }
  }
  return { signPrefix: prefix, body: digits, zeroEligible: precision === null };
}

function fmtE(value: number, conv: 'e' | 'E', flags: Flags, precision: number | null): Piece {
  const upper = conv === 'E';
  if (Number.isNaN(value)) {
    return { signPrefix: '', body: upper ? 'NAN' : 'nan', zeroEligible: false };
  }
  const negative = isNegative(value);
  if (!Number.isFinite(value)) {
    return { signPrefix: signPrefixFor(negative, flags), body: upper ? 'INF' : 'inf', zeroEligible: false };
  }
  const P = precision === null ? 6 : precision;
  const { digits, E } = normalizedDigits(value);
  const { digits: rd, expAdjust } = roundSignificant(digits, P + 1);
  const X = E + expAdjust;
  const fracDigits = rd.slice(1);
  const mantissa = rd[0] + (P > 0 || flags.hash ? '.' + fracDigits : '');
  const expSign = X >= 0 ? '+' : '-';
  const expAbs = Math.abs(X).toString().padStart(2, '0');
  const body = mantissa + (upper ? 'E' : 'e') + expSign + expAbs;
  return { signPrefix: signPrefixFor(negative, flags), body, zeroEligible: true };
}

function fmtF(value: number, conv: 'f' | 'F', flags: Flags, precision: number | null): Piece {
  const upper = conv === 'F';
  if (Number.isNaN(value)) {
    return { signPrefix: '', body: upper ? 'NAN' : 'nan', zeroEligible: false };
  }
  const negative = isNegative(value);
  if (!Number.isFinite(value)) {
    return { signPrefix: signPrefixFor(negative, flags), body: upper ? 'INF' : 'inf', zeroEligible: false };
  }
  const P = precision === null ? 6 : precision;
  const { intPart, fracPart } = bigDecimalAbs(value);
  const { intPart: ri, fracPart: rf } = roundFixed(intPart, fracPart, P);
  const body = ri + (P > 0 || flags.hash ? '.' + rf : '');
  return { signPrefix: signPrefixFor(negative, flags), body, zeroEligible: true };
}

function fmtG(value: number, conv: 'g' | 'G', flags: Flags, precision: number | null): Piece {
  const upper = conv === 'G';
  if (Number.isNaN(value)) {
    return { signPrefix: '', body: upper ? 'NAN' : 'nan', zeroEligible: false };
  }
  const negative = isNegative(value);
  if (!Number.isFinite(value)) {
    return { signPrefix: signPrefixFor(negative, flags), body: upper ? 'INF' : 'inf', zeroEligible: false };
  }
  let P = precision === null ? 6 : precision;
  if (P === 0) P = 1;
  const { digits, E } = normalizedDigits(value);
  const { digits: rd, expAdjust } = roundSignificant(digits, P);
  const X = E + expAdjust;
  let body: string;
  if (P > X && X >= -4) {
    const fprecision = P - 1 - X;
    let intPart: string;
    let fracPart: string;
    if (X >= 0) {
      intPart = rd.slice(0, X + 1);
      fracPart = rd.slice(X + 1);
    } else {
      intPart = '0';
      fracPart = '0'.repeat(-X - 1) + rd;
    }
    fracPart = fracPart.padEnd(fprecision, '0').slice(0, fprecision);
    if (!flags.hash) fracPart = fracPart.replace(/0+$/, '');
    body = intPart + (fracPart.length > 0 || flags.hash ? '.' + fracPart : '');
  } else {
    let fracDigits = rd.slice(1);
    if (!flags.hash) fracDigits = fracDigits.replace(/0+$/, '');
    const mantissa = rd[0] + (fracDigits.length > 0 || flags.hash ? '.' + fracDigits : '');
    const expSign = X >= 0 ? '+' : '-';
    const expAbs = Math.abs(X).toString().padStart(2, '0');
    body = mantissa + (upper ? 'E' : 'e') + expSign + expAbs;
  }
  return { signPrefix: signPrefixFor(negative, flags), body, zeroEligible: true };
}

function fmtS(value: string, precision: number | null): Piece {
  const body = precision !== null ? value.slice(0, precision) : value;
  return { signPrefix: '', body, zeroEligible: false };
}

function fmtC(value: string): Piece {
  return { signPrefix: '', body: value, zeroEligible: false };
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let result = '';
  let argIndex = 0;
  let lastIndex = 0;
  const re = /%([-+0# ]*)(\d*)(\.\d*)?([diouxXeEfFgGsc%])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(fmt)) !== null) {
    result += fmt.slice(lastIndex, m.index);
    lastIndex = re.lastIndex;
    const [, flagsStr, widthStr, precStr, conv] = m;
    if (conv === '%') {
      result += '%';
      continue;
    }
    const flags = parseFlags(flagsStr);
    const width = widthStr ? parseInt(widthStr, 10) : 0;
    const precision = precStr === undefined ? null : precStr === '.' ? 0 : parseInt(precStr.slice(1), 10);
    const arg = args[argIndex++];
    let piece: Piece;
    switch (conv) {
      case 'd':
      case 'i':
        piece = fmtDI(arg as number | bigint, flags, precision);
        break;
      case 'x':
      case 'X':
      case 'o':
        piece = fmtXXO(arg as number | bigint, conv, flags, precision);
        break;
      case 'e':
      case 'E':
        piece = fmtE(arg as number, conv, flags, precision);
        break;
      case 'f':
      case 'F':
        piece = fmtF(arg as number, conv, flags, precision);
        break;
      case 'g':
      case 'G':
        piece = fmtG(arg as number, conv, flags, precision);
        break;
      case 's':
        piece = fmtS(arg as string, precision);
        break;
      case 'c':
        piece = fmtC(arg as string);
        break;
      default:
        throw new Error(`Unsupported conversion: ${conv}`);
    }
    result += pad(piece, width, flags);
  }
  result += fmt.slice(lastIndex);
  return result;
}
