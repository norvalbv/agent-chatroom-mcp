type Flags = {
  minus: boolean;
  plus: boolean;
  zero: boolean;
  hash: boolean;
  space: boolean;
};

type Piece = { prefix: string; digits: string; zeroPadAllowed: boolean };

function decompose(x: number): { M: bigint; E: number } {
  const buf = new ArrayBuffer(8);
  const dv = new DataView(buf);
  dv.setFloat64(0, x, false);
  const hi = dv.getUint32(0, false);
  const lo = dv.getUint32(4, false);
  const expBits = (hi >>> 20) & 0x7ff;
  const mantHi = BigInt(hi & 0xfffff);
  const mantLo = BigInt(lo >>> 0);
  const mantissa = (mantHi << 32n) | mantLo;
  if (expBits === 0) {
    return { M: mantissa, E: -1074 };
  }
  return { M: mantissa | (1n << 52n), E: expBits - 1075 };
}

function roundDiv(num: bigint, den: bigint): bigint {
  const q = num / den;
  const r = num % den;
  const twice = r * 2n;
  if (twice < den) return q;
  if (twice > den) return q + 1n;
  return q % 2n === 0n ? q : q + 1n;
}

function scaledRound(M: bigint, E: number, n: number): bigint {
  let num = M;
  let den = 1n;
  if (E >= 0) num <<= BigInt(E);
  else den <<= BigInt(-E);
  if (n >= 0) num *= 10n ** BigInt(n);
  else den *= 10n ** BigInt(-n);
  return roundDiv(num, den);
}

function expAndDigits(value: number, precision: number): { digits: string; exp: number } {
  if (value === 0) {
    return { digits: '0'.repeat(precision + 1), exp: 0 };
  }
  const { M, E } = decompose(value);
  let X = Math.floor(Math.log10(value));
  const lowBound = 10n ** BigInt(precision);
  const highBound = 10n ** BigInt(precision + 1);
  for (let i = 0; i < 8; i++) {
    const digitsBig = scaledRound(M, E, precision - X);
    if (digitsBig >= highBound) {
      X++;
      continue;
    }
    if (digitsBig < lowBound) {
      X--;
      continue;
    }
    return { digits: digitsBig.toString().padStart(precision + 1, '0'), exp: X };
  }
  throw new Error('failed to converge computing exponential digits');
}

function buildEBody(digits: string, exp: number, precision: number, hash: boolean, upper: boolean): string {
  let mantissa = digits[0];
  if (precision > 0 || hash) mantissa += '.' + digits.slice(1);
  const e = upper ? 'E' : 'e';
  const expSign = exp < 0 ? '-' : '+';
  const expDigits = Math.abs(exp).toString().padStart(2, '0');
  return mantissa + e + expSign + expDigits;
}

function buildFBody(value: number, precision: number, hash: boolean): string {
  const { M, E } = decompose(value);
  const digitsBig = scaledRound(M, E, precision);
  const full = digitsBig.toString().padStart(precision + 1, '0');
  const cut = full.length - precision;
  const intPart = full.slice(0, cut);
  const fracPart = full.slice(cut);
  if (precision > 0 || hash) return intPart + '.' + fracPart;
  return intPart;
}

function stripTrailingZerosMantissa(mantissa: string): string {
  if (!mantissa.includes('.')) return mantissa;
  mantissa = mantissa.replace(/0+$/, '');
  mantissa = mantissa.replace(/\.$/, '');
  return mantissa;
}

function signPrefix(neg: boolean, flags: Flags): string {
  if (neg) return '-';
  if (flags.plus) return '+';
  if (flags.space) return ' ';
  return '';
}

function toBigIntArg(arg: number | bigint | string): bigint {
  return typeof arg === 'bigint' ? arg : BigInt(arg as number);
}

function convertDI(arg: number | bigint | string, flags: Flags, precision: number | undefined): Piece {
  let isNeg: boolean;
  let mag: bigint;
  if (typeof arg === 'bigint') {
    isNeg = arg < 0n;
    mag = isNeg ? -arg : arg;
  } else {
    const n = arg as number;
    isNeg = n < 0;
    mag = BigInt(Math.abs(n));
  }
  let digits: string;
  if (precision === 0 && mag === 0n) {
    digits = '';
  } else if (precision !== undefined) {
    digits = mag.toString(10).padStart(precision, '0');
  } else {
    digits = mag.toString(10);
  }
  const prefix = signPrefix(isNeg, flags);
  const zeroPadAllowed = flags.zero && !flags.minus && precision === undefined;
  return { prefix, digits, zeroPadAllowed };
}

function convertXXO(arg: number | bigint | string, conv: 'x' | 'X' | 'o', flags: Flags, precision: number | undefined): Piece {
  const mag = toBigIntArg(arg);
  const base = conv === 'o' ? 8 : 16;
  let digits = mag.toString(base);
  if (conv === 'X') digits = digits.toUpperCase();
  if (precision === 0 && mag === 0n) {
    digits = '';
  } else if (precision !== undefined) {
    digits = digits.padStart(precision, '0');
  }
  if (conv === 'o' && flags.hash) {
    if (digits === '' || digits[0] !== '0') digits = '0' + digits;
  }
  let prefix = '';
  if ((conv === 'x' || conv === 'X') && flags.hash && mag !== 0n) {
    prefix = conv === 'x' ? '0x' : '0X';
  }
  const zeroPadAllowed = flags.zero && !flags.minus && precision === undefined;
  return { prefix, digits, zeroPadAllowed };
}

function convertFloat(
  arg: number | bigint | string,
  conv: 'e' | 'E' | 'f' | 'F' | 'g' | 'G',
  flags: Flags,
  precisionRaw: number | undefined
): Piece {
  const value = arg as number;
  const upper = conv === conv.toUpperCase();

  if (Number.isNaN(value)) {
    return { prefix: '', digits: upper ? 'NAN' : 'nan', zeroPadAllowed: false };
  }

  const neg = value < 0 || Object.is(value, -0);
  const prefix = signPrefix(neg, flags);

  if (!Number.isFinite(value)) {
    return { prefix, digits: upper ? 'INF' : 'inf', zeroPadAllowed: false };
  }

  const abs = Math.abs(value);
  const zeroPadAllowed = flags.zero && !flags.minus;

  if (conv === 'e' || conv === 'E') {
    const precision = precisionRaw === undefined ? 6 : precisionRaw;
    const { digits, exp } = expAndDigits(abs, precision);
    const body = buildEBody(digits, exp, precision, flags.hash, upper);
    return { prefix, digits: body, zeroPadAllowed };
  }

  if (conv === 'f' || conv === 'F') {
    const precision = precisionRaw === undefined ? 6 : precisionRaw;
    const body = buildFBody(abs, precision, flags.hash);
    return { prefix, digits: body, zeroPadAllowed };
  }

  // g, G
  const P = precisionRaw === undefined ? 6 : precisionRaw === 0 ? 1 : precisionRaw;
  const { exp: X } = expAndDigits(abs, P - 1);
  let body: string;
  if (P > X && X >= -4) {
    const p = P - 1 - X;
    body = buildFBody(abs, p, flags.hash);
  } else {
    const p = P - 1;
    const { digits } = expAndDigits(abs, p);
    body = buildEBody(digits, X, p, flags.hash, upper);
  }
  if (!flags.hash) {
    const eIdx = body.search(/[eE]/);
    if (eIdx === -1) {
      body = stripTrailingZerosMantissa(body);
    } else {
      body = stripTrailingZerosMantissa(body.slice(0, eIdx)) + body.slice(eIdx);
    }
  }
  return { prefix, digits: body, zeroPadAllowed };
}

function applyWidth(piece: Piece, width: number, minus: boolean): string {
  const full = piece.prefix + piece.digits;
  if (full.length >= width) return full;
  const padLen = width - full.length;
  if (minus) return full + ' '.repeat(padLen);
  if (piece.zeroPadAllowed) return piece.prefix + '0'.repeat(padLen) + piece.digits;
  return ' '.repeat(padLen) + full;
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let result = '';
  let argIndex = 0;
  const re = /%([-+0# ]*)(\d*)(?:\.(\d*))?([diouxXeEfFgGsc%])/g;
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(fmt)) !== null) {
    result += fmt.slice(lastIndex, m.index);
    lastIndex = re.lastIndex;
    const [, flagsStr, widthStr, precStr, conv] = m;

    if (conv === '%') {
      result += '%';
      continue;
    }

    const flags: Flags = {
      minus: flagsStr.includes('-'),
      plus: flagsStr.includes('+'),
      zero: flagsStr.includes('0'),
      hash: flagsStr.includes('#'),
      space: flagsStr.includes(' '),
    };
    const width = widthStr ? parseInt(widthStr, 10) : 0;
    const precision = precStr === undefined ? undefined : precStr === '' ? 0 : parseInt(precStr, 10);
    const arg = args[argIndex++];

    let piece: Piece;
    switch (conv) {
      case 'd':
      case 'i':
        piece = convertDI(arg, flags, precision);
        break;
      case 'x':
      case 'X':
      case 'o':
        piece = convertXXO(arg, conv, flags, precision);
        break;
      case 'e':
      case 'E':
      case 'f':
      case 'F':
      case 'g':
      case 'G':
        piece = convertFloat(arg, conv, flags, precision);
        break;
      case 's': {
        let s = arg as string;
        if (precision !== undefined) s = s.slice(0, precision);
        piece = { prefix: '', digits: s, zeroPadAllowed: false };
        break;
      }
      case 'c': {
        piece = { prefix: '', digits: arg as string, zeroPadAllowed: false };
        break;
      }
      default:
        throw new Error(`unsupported conversion: ${conv}`);
    }

    result += applyWidth(piece, width, flags.minus);
  }
  result += fmt.slice(lastIndex);
  return result;
}
