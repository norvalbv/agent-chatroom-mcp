type Flags = {
  minus: boolean;
  plus: boolean;
  space: boolean;
  zero: boolean;
  hash: boolean;
};

type Piece = {
  sign: string;
  prefix: string;
  digits: string;
  zeroOk: boolean;
};

// --- Exact decimal expansion of a finite non-negative double -------------

function exactDigits(x: number): { intPart: string; fracPart: string } {
  if (x === 0) return { intPart: '0', fracPart: '' };
  const buf = new ArrayBuffer(8);
  const view = new DataView(buf);
  view.setFloat64(0, x);
  const hi = view.getUint32(0);
  const lo = view.getUint32(4);
  const expBits = (hi >>> 20) & 0x7ff;
  const mantHi = hi & 0xfffff;
  let mantissa = (BigInt(mantHi) << 32n) | BigInt(lo);
  let exponent: number;
  if (expBits === 0) {
    exponent = -1074;
  } else {
    mantissa |= 1n << 52n;
    exponent = expBits - 1075;
  }
  if (mantissa === 0n) return { intPart: '0', fracPart: '' };
  if (exponent >= 0) {
    const intVal = mantissa << BigInt(exponent);
    return { intPart: intVal.toString(), fracPart: '' };
  }
  const k = -exponent;
  const scaled = mantissa * 5n ** BigInt(k);
  let s = scaled.toString();
  if (s.length <= k) s = s.padStart(k + 1, '0');
  const intPart = s.slice(0, s.length - k);
  const fracPart = s.slice(s.length - k);
  return { intPart, fracPart };
}

function decideRoundUp(rest: string, tieBreakerDigit: string): boolean {
  if (rest.length === 0) return false;
  const midpoint = '5' + '0'.repeat(rest.length - 1);
  if (rest > midpoint) return true;
  if (rest < midpoint) return false;
  return parseInt(tieBreakerDigit, 10) % 2 === 1;
}

// Round the exact decimal intPart.fracPart to P digits after the point.
function roundFixed(intPart: string, fracPart: string, P: number): { intPart: string; fracPart: string } {
  if (fracPart.length <= P) {
    return { intPart, fracPart: fracPart.padEnd(P, '0') };
  }
  const keep = fracPart.slice(0, P);
  const rest = fracPart.slice(P);
  const tieBreaker = P > 0 ? keep[P - 1] : intPart[intPart.length - 1];
  const roundUp = decideRoundUp(rest, tieBreaker);
  if (!roundUp) {
    return { intPart, fracPart: keep };
  }
  const combined = BigInt(intPart + keep) + 1n;
  let combinedStr = combined.toString().padStart(intPart.length + P, '0');
  const newIntLen = combinedStr.length - P;
  return {
    intPart: combinedStr.slice(0, newIntLen),
    fracPart: P > 0 ? combinedStr.slice(newIntLen) : '',
  };
}

// Round the exact decimal value to P+1 significant digits (scientific form).
function toExpDigits(intPart: string, fracPart: string, P: number): { digits: string; exp: number } {
  const D = intPart + fracPart;
  const firstNonZero = D.search(/[1-9]/);
  if (firstNonZero === -1) {
    return { digits: '0'.repeat(P + 1), exp: 0 };
  }
  let exp = intPart.length - 1 - firstNonZero;
  let sig = D.slice(firstNonZero);
  if (sig.length < P + 1) sig = sig.padEnd(P + 1, '0');
  const keep = sig.slice(0, P + 1);
  const rest = sig.slice(P + 1);
  const tieBreaker = keep[keep.length - 1];
  const roundUp = decideRoundUp(rest, tieBreaker);
  if (!roundUp) {
    return { digits: keep, exp };
  }
  let combined = (BigInt(keep) + 1n).toString();
  if (combined.length > keep.length) {
    exp += 1;
    combined = combined.slice(0, P + 1);
  } else {
    combined = combined.padStart(keep.length, '0');
  }
  return { digits: combined, exp };
}

// --- Width / sign / prefix assembly ---------------------------------------

function applyWidth(sign: string, prefix: string, digits: string, width: number, flags: Flags, zeroOk: boolean): string {
  const core = sign + prefix + digits;
  if (width <= core.length) return core;
  const padLen = width - core.length;
  if (flags.minus) return core + ' '.repeat(padLen);
  if (flags.zero && zeroOk) return sign + prefix + '0'.repeat(padLen) + digits;
  return ' '.repeat(padLen) + core;
}

function signFor(isNeg: boolean, flags: Flags): string {
  if (isNeg) return '-';
  if (flags.plus) return '+';
  if (flags.space) return ' ';
  return '';
}

// --- Integer conversions ---------------------------------------------------

function formatSignedInt(value: number | bigint, flags: Flags, precision: number | undefined): Piece {
  const n = typeof value === 'bigint' ? value : BigInt(value);
  const neg = n < 0n;
  const abs = neg ? -n : n;
  let digits = abs.toString();
  if (precision !== undefined) {
    digits = precision === 0 && abs === 0n ? '' : digits.padStart(precision, '0');
  }
  return { sign: signFor(neg, flags), prefix: '', digits, zeroOk: precision === undefined };
}

function formatUnsignedInt(value: number | bigint, conv: 'x' | 'X' | 'o', flags: Flags, precision: number | undefined): Piece {
  const n = typeof value === 'bigint' ? value : BigInt(value);
  let digits = conv === 'o' ? n.toString(8) : n.toString(16);
  if (conv === 'X') digits = digits.toUpperCase();
  if (precision !== undefined) {
    digits = precision === 0 && n === 0n ? '' : digits.padStart(precision, '0');
  }
  let prefix = '';
  if (flags.hash) {
    if ((conv === 'x' || conv === 'X') && n !== 0n) {
      prefix = conv === 'x' ? '0x' : '0X';
    }
    if (conv === 'o' && digits[0] !== '0') {
      digits = '0' + digits;
    }
  }
  return { sign: '', prefix, digits, zeroOk: precision === undefined };
}

// --- Floating point conversions ---------------------------------------------

function specialFloat(value: number, conv: string, flags: Flags): Piece | null {
  const upper = conv === conv.toUpperCase();
  if (Number.isNaN(value)) {
    return { sign: '', prefix: '', digits: upper ? 'NAN' : 'nan', zeroOk: false };
  }
  if (!Number.isFinite(value)) {
    const isNeg = value < 0;
    return { sign: signFor(isNeg, flags), prefix: '', digits: upper ? 'INF' : 'inf', zeroOk: false };
  }
  return null;
}

function formatExp(value: number, conv: 'e' | 'E', flags: Flags, precision: number): Piece {
  const special = specialFloat(value, conv, flags);
  if (special) return special;
  const isNeg = value < 0 || Object.is(value, -0);
  const { intPart, fracPart } = exactDigits(Math.abs(value));
  const { digits: sig, exp } = toExpDigits(intPart, fracPart, precision);
  const frac = sig.slice(1);
  const mantissa = sig[0] + (precision > 0 || flags.hash ? '.' + frac : '');
  const expSign = exp < 0 ? '-' : '+';
  const expAbs = Math.abs(exp).toString().padStart(2, '0');
  const digits = mantissa + (conv === 'E' ? 'E' : 'e') + expSign + expAbs;
  return { sign: signFor(isNeg, flags), prefix: '', digits, zeroOk: true };
}

function formatFixed(value: number, conv: 'f' | 'F', flags: Flags, precision: number): Piece {
  const special = specialFloat(value, conv, flags);
  if (special) return special;
  const isNeg = value < 0 || Object.is(value, -0);
  const { intPart, fracPart } = exactDigits(Math.abs(value));
  const rounded = roundFixed(intPart, fracPart, precision);
  const digits = rounded.intPart + (precision > 0 || flags.hash ? '.' + rounded.fracPart : '');
  return { sign: signFor(isNeg, flags), prefix: '', digits, zeroOk: true };
}

function formatG(value: number, conv: 'g' | 'G', flags: Flags, precision: number): Piece {
  const special = specialFloat(value, conv, flags);
  if (special) return special;
  const isNeg = value < 0 || Object.is(value, -0);
  const upper = conv === 'G';
  const P = precision === 0 ? 1 : precision;
  const { intPart, fracPart } = exactDigits(Math.abs(value));
  const { digits: sig, exp: X } = toExpDigits(intPart, fracPart, P - 1);
  const useF = P > X && X >= -4;
  let digits: string;
  if (useF) {
    const fPrec = P - 1 - X;
    const rounded = roundFixed(intPart, fracPart, fPrec);
    const fp = flags.hash ? rounded.fracPart : rounded.fracPart.replace(/0+$/, '');
    digits = rounded.intPart + (flags.hash ? '.' + fp : fp.length > 0 ? '.' + fp : '');
  } else {
    const frac = flags.hash ? sig.slice(1) : sig.slice(1).replace(/0+$/, '');
    const mantStr = sig[0] + (flags.hash ? '.' + frac : frac.length > 0 ? '.' + frac : '');
    const expSign = X < 0 ? '-' : '+';
    const expAbs = Math.abs(X).toString().padStart(2, '0');
    digits = mantStr + (upper ? 'E' : 'e') + expSign + expAbs;
  }
  return { sign: signFor(isNeg, flags), prefix: '', digits, zeroOk: true };
}

// --- Main entry point --------------------------------------------------------

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let argIndex = 0;
  const re = /%([-+0 #]*)(\d*)(?:\.(\d*))?([diouxXeEfFgGsc%])/g;

  return fmt.replace(re, (_match, flagsStr: string, widthStr: string, precStr: string | undefined, conv: string) => {
    if (conv === '%') return '%';

    const arg = args[argIndex++];
    const flags: Flags = {
      minus: flagsStr.includes('-'),
      plus: flagsStr.includes('+'),
      space: flagsStr.includes(' '),
      zero: flagsStr.includes('0'),
      hash: flagsStr.includes('#'),
    };
    const width = widthStr ? parseInt(widthStr, 10) : 0;
    const precision = precStr !== undefined ? (precStr === '' ? 0 : parseInt(precStr, 10)) : undefined;

    let piece: Piece;
    switch (conv) {
      case 'd':
      case 'i':
        piece = formatSignedInt(arg as number | bigint, flags, precision);
        break;
      case 'x':
      case 'X':
      case 'o':
        piece = formatUnsignedInt(arg as number | bigint, conv, flags, precision);
        break;
      case 'e':
      case 'E':
        piece = formatExp(arg as number, conv, flags, precision ?? 6);
        break;
      case 'f':
      case 'F':
        piece = formatFixed(arg as number, conv, flags, precision ?? 6);
        break;
      case 'g':
      case 'G':
        piece = formatG(arg as number, conv, flags, precision ?? 6);
        break;
      case 's': {
        const str = arg as string;
        piece = { sign: '', prefix: '', digits: precision !== undefined ? str.slice(0, precision) : str, zeroOk: false };
        break;
      }
      case 'c':
        piece = { sign: '', prefix: '', digits: arg as string, zeroOk: false };
        break;
      default:
        piece = { sign: '', prefix: '', digits: '', zeroOk: false };
    }

    return applyWidth(piece.sign, piece.prefix, piece.digits, width, flags, piece.zeroOk);
  });
}
