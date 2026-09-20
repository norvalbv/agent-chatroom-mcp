type Flags = {
  minus: boolean;
  plus: boolean;
  space: boolean;
  zero: boolean;
  hash: boolean;
};

function decomposeDouble(x: number): { N: bigint; k: number } {
  const ax = Math.abs(x);
  const buf = new ArrayBuffer(8);
  const dv = new DataView(buf);
  dv.setFloat64(0, ax);
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const expBits = (hi >>> 20) & 0x7ff;
  const mantHi = hi & 0xfffff;
  const mantissa = (BigInt(mantHi) << 32n) | BigInt(lo);
  let mantissa53: bigint;
  let e: number;
  if (expBits === 0) {
    mantissa53 = mantissa;
    e = -1074;
  } else {
    mantissa53 = mantissa | (1n << 52n);
    e = expBits - 1075;
  }
  if (e >= 0) {
    return { N: mantissa53 << BigInt(e), k: 0 };
  }
  const k = -e;
  return { N: mantissa53 * 5n ** BigInt(k), k };
}

// Rounds N * 10^shift to the nearest integer, ties to even.
function roundScaled(N: bigint, shift: number): bigint {
  if (shift >= 0) return N * 10n ** BigInt(shift);
  const divisor = 10n ** BigInt(-shift);
  const q = N / divisor;
  const r = N % divisor;
  const twice = r * 2n;
  if (twice < divisor) return q;
  if (twice > divisor) return q + 1n;
  return q % 2n === 0n ? q : q + 1n;
}

function fParts(N: bigint, k: number, precision: number): { intPart: string; fracPart: string } {
  const shift = precision - k;
  const M = roundScaled(N, shift);
  let s = M.toString();
  const totalLen = precision + 1;
  if (s.length < totalLen) s = '0'.repeat(totalLen - s.length) + s;
  const intPart = precision > 0 ? s.slice(0, s.length - precision) : s;
  const fracPart = precision > 0 ? s.slice(s.length - precision) : '';
  return { intPart, fracPart };
}

function eParts(N: bigint, k: number, precision: number): { digit0: string; frac: string; E: number } {
  if (N === 0n) {
    return { digit0: '0', frac: '0'.repeat(precision), E: 0 };
  }
  const d = N.toString().length;
  let E = d - 1 - k;
  const shift = precision - d + 1;
  const M = roundScaled(N, shift);
  let s = M.toString();
  if (s.length === precision + 2) {
    E += 1;
    s = '1' + '0'.repeat(precision);
  } else if (s.length < precision + 1) {
    s = '0'.repeat(precision + 1 - s.length) + s;
  }
  return { digit0: s[0], frac: s.slice(1), E };
}

function expString(E: number): string {
  const sign = E < 0 ? '-' : '+';
  const abs = Math.abs(E).toString();
  const digits = abs.length < 2 ? '0'.repeat(2 - abs.length) + abs : abs;
  return sign + digits;
}

function fBody(N: bigint, k: number, precision: number, hash: boolean): string {
  const { intPart, fracPart } = fParts(N, k, precision);
  const dot = precision > 0 || hash ? '.' : '';
  return intPart + dot + fracPart;
}

function eBody(N: bigint, k: number, precision: number, hash: boolean, upper: boolean): string {
  const { digit0, frac, E } = eParts(N, k, precision);
  const dot = precision > 0 || hash ? '.' : '';
  return digit0 + dot + frac + (upper ? 'E' : 'e') + expString(E);
}

function gBody(N: bigint, k: number, P: number, hash: boolean, upper: boolean): string {
  const P2 = P === 0 ? 1 : P;
  const trial = eParts(N, k, P2 - 1);
  const X = trial.E;
  if (P2 > X && X >= -4) {
    const prec = P2 - 1 - X;
    const { intPart, fracPart } = fParts(N, k, prec);
    if (hash) {
      return intPart + (prec > 0 ? '.' + fracPart : '.');
    }
    const frac = fracPart.replace(/0+$/, '');
    return frac.length > 0 ? intPart + '.' + frac : intPart;
  }
  const { digit0, frac: frac0, E } = trial;
  let mantissa: string;
  if (hash) {
    mantissa = frac0.length > 0 ? digit0 + '.' + frac0 : digit0 + '.';
  } else {
    const frac = frac0.replace(/0+$/, '');
    mantissa = frac.length > 0 ? digit0 + '.' + frac : digit0;
  }
  return mantissa + (upper ? 'E' : 'e') + expString(E);
}

function applyPrecision(raw: string, precision: number | undefined, isZero: boolean): string {
  if (precision === undefined) return raw;
  if (precision === 0 && isZero) return '';
  if (raw.length < precision) return '0'.repeat(precision - raw.length) + raw;
  return raw;
}

function padNumeric(
  sign: string,
  prefix: string,
  digits: string,
  width: number,
  minus: boolean,
  zero: boolean
): string {
  const body = sign + prefix + digits;
  if (body.length >= width) return body;
  if (minus) return body + ' '.repeat(width - body.length);
  if (zero) return sign + prefix + '0'.repeat(width - body.length) + digits;
  return ' '.repeat(width - body.length) + body;
}

function padGeneral(str: string, width: number, minus: boolean): string {
  if (str.length >= width) return str;
  return minus ? str + ' '.repeat(width - str.length) : ' '.repeat(width - str.length) + str;
}

function convertOne(
  conv: string,
  flags: Flags,
  width: number,
  precision: number | undefined,
  arg: number | bigint | string
): string {
  switch (conv) {
    case 'd':
    case 'i': {
      const big = typeof arg === 'bigint' ? arg : BigInt(arg as number);
      const neg = big < 0n;
      const mag = neg ? -big : big;
      const raw = mag.toString(10);
      const digits = applyPrecision(raw, precision, mag === 0n);
      const sign = neg ? '-' : flags.plus ? '+' : flags.space ? ' ' : '';
      const zeroFlag = flags.zero && !flags.minus && precision === undefined;
      return padNumeric(sign, '', digits, width, flags.minus, zeroFlag);
    }
    case 'x':
    case 'X':
    case 'o': {
      const mag = typeof arg === 'bigint' ? arg : BigInt(arg as number);
      const base = conv === 'o' ? 8 : 16;
      let raw = mag.toString(base);
      if (conv === 'X') raw = raw.toUpperCase();
      let digits = applyPrecision(raw, precision, mag === 0n);
      let prefix = '';
      if (flags.hash) {
        if (conv === 'o') {
          if (digits.length === 0 || digits[0] !== '0') {
            digits = applyPrecision(raw, digits.length + 1, mag === 0n);
          }
        } else if (mag !== 0n) {
          prefix = conv === 'X' ? '0X' : '0x';
        }
      }
      const zeroFlag = flags.zero && !flags.minus && precision === undefined;
      return padNumeric('', prefix, digits, width, flags.minus, zeroFlag);
    }
    case 's': {
      let str = arg as string;
      if (precision !== undefined) str = str.slice(0, precision);
      return padGeneral(str, width, flags.minus);
    }
    case 'c': {
      return padGeneral(arg as string, width, flags.minus);
    }
    case 'e':
    case 'E':
    case 'f':
    case 'F':
    case 'g':
    case 'G': {
      const x = arg as number;
      const upper = conv === 'E' || conv === 'F' || conv === 'G';
      if (Number.isNaN(x)) {
        return padGeneral(upper ? 'NAN' : 'nan', width, flags.minus);
      }
      const negBit = x < 0 || Object.is(x, -0);
      if (!Number.isFinite(x)) {
        const sign = negBit ? '-' : flags.plus ? '+' : flags.space ? ' ' : '';
        return padGeneral(sign + (upper ? 'INF' : 'inf'), width, flags.minus);
      }
      const { N, k } = decomposeDouble(x);
      const sign = negBit ? '-' : flags.plus ? '+' : flags.space ? ' ' : '';
      let bodyDigits: string;
      if (conv === 'f' || conv === 'F') {
        bodyDigits = fBody(N, k, precision === undefined ? 6 : precision, flags.hash);
      } else if (conv === 'e' || conv === 'E') {
        bodyDigits = eBody(N, k, precision === undefined ? 6 : precision, flags.hash, upper);
      } else {
        bodyDigits = gBody(N, k, precision === undefined ? 6 : precision, flags.hash, upper);
      }
      const zeroFlag = flags.zero && !flags.minus;
      return padNumeric(sign, '', bodyDigits, width, flags.minus, zeroFlag);
    }
    default:
      throw new Error(`unsupported conversion: ${conv}`);
  }
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  const specRe = /%([-+ 0#]*)(\d*)(?:\.(\d*))?([diouxXeEfFgGsc%])/g;
  let result = '';
  let last = 0;
  let argi = 0;
  let m: RegExpExecArray | null;
  while ((m = specRe.exec(fmt))) {
    result += fmt.slice(last, m.index);
    last = specRe.lastIndex;
    const [, flagsStr, widthStr, precStr, conv] = m;
    if (conv === '%') {
      result += '%';
      continue;
    }
    const flags: Flags = {
      minus: flagsStr.includes('-'),
      plus: flagsStr.includes('+'),
      space: flagsStr.includes(' '),
      zero: flagsStr.includes('0'),
      hash: flagsStr.includes('#'),
    };
    const width = widthStr ? parseInt(widthStr, 10) : 0;
    const precision = precStr !== undefined ? (precStr === '' ? 0 : parseInt(precStr, 10)) : undefined;
    const arg = args[argi++];
    result += convertOne(conv, flags, width, precision, arg);
  }
  result += fmt.slice(last);
  return result;
}
