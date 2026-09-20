type Flags = {
  minus: boolean;
  plus: boolean;
  space: boolean;
  zero: boolean;
  hash: boolean;
};

function signStr(negative: boolean, flags: Flags): string {
  return negative ? '-' : flags.plus ? '+' : flags.space ? ' ' : '';
}

function padNumeric(
  sign: string,
  prefix: string,
  digits: string,
  width: number,
  leftAlign: boolean,
  zeroPad: boolean,
): string {
  const core = sign + prefix + digits;
  if (core.length >= width) return core;
  const padLen = width - core.length;
  if (leftAlign) return core + ' '.repeat(padLen);
  if (zeroPad) return sign + prefix + '0'.repeat(padLen) + digits;
  return ' '.repeat(padLen) + core;
}

function toBigInt(arg: number | bigint | string): bigint {
  return typeof arg === 'bigint' ? arg : BigInt(arg as number);
}

// Exact decimal decomposition of a finite double: |x| == numerator / 10^scale.
function decompose(x: number): { negative: boolean; numerator: bigint; scale: number } {
  const negative = x < 0 || Object.is(x, -0);
  const buf = new ArrayBuffer(8);
  new Float64Array(buf)[0] = Math.abs(x);
  const bits = new BigUint64Array(buf)[0];
  const expBits = Number((bits >> 52n) & 0x7ffn);
  const fracBits = bits & 0xfffffffffffffn;
  let mantissa: bigint;
  let e: number;
  if (expBits === 0) {
    mantissa = fracBits;
    e = -1074;
  } else {
    mantissa = fracBits | (1n << 52n);
    e = expBits - 1075;
  }
  if (mantissa === 0n) {
    return { negative, numerator: 0n, scale: 0 };
  }
  let numerator: bigint;
  let scale: number;
  if (e >= 0) {
    numerator = mantissa << BigInt(e);
    scale = 0;
  } else {
    numerator = mantissa * 5n ** BigInt(-e);
    scale = -e;
  }
  return { negative, numerator, scale };
}

// Round numerator/10^scale to targetScale fractional digits (half-to-even), returning
// the integer M such that value ~= M / 10^targetScale.
function roundToScale(numerator: bigint, scale: number, targetScale: number): bigint {
  if (targetScale >= scale) {
    return numerator * 10n ** BigInt(targetScale - scale);
  }
  const D = 10n ** BigInt(scale - targetScale);
  const q = numerator / D;
  const r = numerator % D;
  const twice = r * 2n;
  if (twice < D) return q;
  if (twice > D) return q + 1n;
  return q % 2n === 0n ? q : q + 1n;
}

// Round numerator/10^scale to (p+1) significant digits, half-to-even.
// Returns the digit string (length p+1) and the base-10 exponent of the leading digit.
function eStyleDigits(numerator: bigint, scale: number, p: number): { digits: string; exp: number } {
  const targetDigits = p + 1;
  if (numerator === 0n) {
    return { digits: '0'.repeat(targetDigits), exp: 0 };
  }
  const L = numerator.toString().length;
  let X = L - 1 - scale;
  const targetScale = p - X;
  let M = roundToScale(numerator, scale, targetScale);
  let digits = M.toString();
  if (digits.length > targetDigits) {
    const extra = digits.length - targetDigits;
    X += extra;
    M = M / 10n ** BigInt(extra);
    digits = M.toString();
  }
  digits = digits.padStart(targetDigits, '0');
  return { digits, exp: X };
}

function formatExponent(exp: number): string {
  const expSign = exp < 0 ? '-' : '+';
  return expSign + Math.abs(exp).toString().padStart(2, '0');
}

function fmtDI(flags: Flags, width: number, precision: number | undefined, arg: number | bigint): string {
  const value = toBigInt(arg);
  const negative = value < 0n;
  const magnitude = negative ? -value : value;
  let digits = magnitude.toString();
  const hasPrecision = precision !== undefined;
  if (hasPrecision) {
    if (precision === 0 && magnitude === 0n) {
      digits = '';
    } else {
      digits = digits.padStart(precision, '0');
    }
  }
  const sign = negative ? '-' : flags.plus ? '+' : flags.space ? ' ' : '';
  const zeroPad = flags.zero && !flags.minus && !hasPrecision;
  return padNumeric(sign, '', digits, width, flags.minus, zeroPad);
}

function fmtXXO(
  conv: 'x' | 'X' | 'o',
  flags: Flags,
  width: number,
  precision: number | undefined,
  arg: number | bigint,
): string {
  const value = toBigInt(arg);
  let digits = value.toString(conv === 'o' ? 8 : 16);
  if (conv === 'X') digits = digits.toUpperCase();
  const hasPrecision = precision !== undefined;
  if (hasPrecision) {
    if (precision === 0 && value === 0n) {
      digits = '';
    } else {
      digits = digits.padStart(precision, '0');
    }
  }
  let prefix = '';
  if (flags.hash) {
    if (conv === 'o') {
      if (digits.length === 0 || digits[0] !== '0') digits = '0' + digits;
    } else if (value !== 0n) {
      prefix = conv === 'x' ? '0x' : '0X';
    }
  }
  const zeroPad = flags.zero && !flags.minus && !hasPrecision;
  return padNumeric('', prefix, digits, width, flags.minus, zeroPad);
}

function fmtF(
  upper: boolean,
  flags: Flags,
  width: number,
  precision: number | undefined,
  arg: number,
): string {
  const p = precision !== undefined ? precision : 6;
  const negative = arg < 0 || Object.is(arg, -0);
  if (Number.isNaN(arg)) {
    return padNumeric('', '', upper ? 'NAN' : 'nan', width, flags.minus, false);
  }
  if (!Number.isFinite(arg)) {
    return padNumeric(signStr(negative, flags), '', upper ? 'INF' : 'inf', width, flags.minus, false);
  }
  const { numerator, scale } = decompose(arg);
  const M = roundToScale(numerator, scale, p);
  const scaleFactor = 10n ** BigInt(p);
  const intPart = p === 0 ? M : M / scaleFactor;
  const fracPart = p === 0 ? '' : (M % scaleFactor).toString().padStart(p, '0');
  const bodyStr = intPart.toString() + ((p > 0 || flags.hash) ? '.' + fracPart : '');
  const sign = signStr(negative, flags);
  const zeroPad = flags.zero && !flags.minus;
  return padNumeric(sign, '', bodyStr, width, flags.minus, zeroPad);
}

function fmtE(
  upper: boolean,
  flags: Flags,
  width: number,
  precision: number | undefined,
  arg: number,
): string {
  const p = precision !== undefined ? precision : 6;
  const negative = arg < 0 || Object.is(arg, -0);
  if (Number.isNaN(arg)) {
    return padNumeric('', '', upper ? 'NAN' : 'nan', width, flags.minus, false);
  }
  if (!Number.isFinite(arg)) {
    return padNumeric(signStr(negative, flags), '', upper ? 'INF' : 'inf', width, flags.minus, false);
  }
  const { numerator, scale } = decompose(arg);
  const { digits, exp } = eStyleDigits(numerator, scale, p);
  const rest = digits.slice(1);
  const mantissa = digits[0] + ((p > 0 || flags.hash) ? '.' + rest : '');
  const letter = upper ? 'E' : 'e';
  const bodyStr = mantissa + letter + formatExponent(exp);
  const sign = signStr(negative, flags);
  const zeroPad = flags.zero && !flags.minus;
  return padNumeric(sign, '', bodyStr, width, flags.minus, zeroPad);
}

function fmtG(
  upper: boolean,
  flags: Flags,
  width: number,
  precision: number | undefined,
  arg: number,
): string {
  let P = precision !== undefined ? precision : 6;
  if (P === 0) P = 1;
  const negative = arg < 0 || Object.is(arg, -0);
  if (Number.isNaN(arg)) {
    return padNumeric('', '', upper ? 'NAN' : 'nan', width, flags.minus, false);
  }
  if (!Number.isFinite(arg)) {
    return padNumeric(signStr(negative, flags), '', upper ? 'INF' : 'inf', width, flags.minus, false);
  }
  const { numerator, scale } = decompose(arg);
  let X: number;
  if (numerator === 0n) {
    X = 0;
  } else {
    X = eStyleDigits(numerator, scale, P - 1).exp;
  }
  const sign = signStr(negative, flags);
  let bodyStr: string;
  if (P > X && X >= -4) {
    const fp = P - 1 - X;
    const M = roundToScale(numerator, scale, fp);
    const scaleFactor = 10n ** BigInt(fp);
    const intPart = fp === 0 ? M : M / scaleFactor;
    let fracPart = fp === 0 ? '' : (M % scaleFactor).toString().padStart(fp, '0');
    if (!flags.hash) fracPart = fracPart.replace(/0+$/, '');
    bodyStr = intPart.toString() + ((fracPart.length > 0 || flags.hash) ? '.' + fracPart : '');
  } else {
    const ep = P - 1;
    const { digits, exp } = eStyleDigits(numerator, scale, ep);
    let rest = digits.slice(1);
    if (!flags.hash) rest = rest.replace(/0+$/, '');
    const mantissa = digits[0] + ((rest.length > 0 || flags.hash) ? '.' + rest : '');
    const letter = upper ? 'E' : 'e';
    bodyStr = mantissa + letter + formatExponent(exp);
  }
  const zeroPad = flags.zero && !flags.minus;
  return padNumeric(sign, '', bodyStr, width, flags.minus, zeroPad);
}

function fmtS(flags: Flags, width: number, precision: number | undefined, arg: string): string {
  let s = arg;
  if (precision !== undefined) s = s.slice(0, precision);
  return padNumeric('', '', s, width, flags.minus, false);
}

function fmtC(flags: Flags, width: number, arg: string): string {
  return padNumeric('', '', arg, width, flags.minus, false);
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let result = '';
  let argIndex = 0;
  const re = /%([-+ 0#]*)(\d*)(?:\.(\d*))?([diouxXeEfFgGsc%])/g;
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
      space: flagsStr.includes(' '),
      zero: flagsStr.includes('0'),
      hash: flagsStr.includes('#'),
    };
    const width = widthStr ? parseInt(widthStr, 10) : 0;
    const precision = precStr !== undefined ? (precStr === '' ? 0 : parseInt(precStr, 10)) : undefined;
    const arg = args[argIndex++];
    switch (conv) {
      case 'd':
      case 'i':
        result += fmtDI(flags, width, precision, arg as number | bigint);
        break;
      case 'x':
      case 'X':
      case 'o':
        result += fmtXXO(conv, flags, width, precision, arg as number | bigint);
        break;
      case 'f':
      case 'F':
        result += fmtF(conv === 'F', flags, width, precision, arg as number);
        break;
      case 'e':
      case 'E':
        result += fmtE(conv === 'E', flags, width, precision, arg as number);
        break;
      case 'g':
      case 'G':
        result += fmtG(conv === 'G', flags, width, precision, arg as number);
        break;
      case 's':
        result += fmtS(flags, width, precision, arg as string);
        break;
      case 'c':
        result += fmtC(flags, width, arg as string);
        break;
    }
  }
  result += fmt.slice(lastIndex);
  return result;
}
