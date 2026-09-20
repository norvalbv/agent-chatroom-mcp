type Flags = {
  minus: boolean;
  plus: boolean;
  space: boolean;
  zero: boolean;
  hash: boolean;
};

function decomposeDouble(mag: number): { digits: bigint; pointPos: number } {
  if (mag === 0) return { digits: 0n, pointPos: 0 };
  const buf = new ArrayBuffer(8);
  const view = new DataView(buf);
  view.setFloat64(0, mag);
  const bits = view.getBigUint64(0);
  const expBits = Number((bits >> 52n) & 0x7ffn);
  const fracBits = bits & 0xfffffffffffffn;
  let mantissa: bigint;
  let exponent2: number;
  if (expBits === 0) {
    mantissa = fracBits;
    exponent2 = -1074;
  } else {
    mantissa = fracBits | (1n << 52n);
    exponent2 = expBits - 1075;
  }
  if (mantissa === 0n) return { digits: 0n, pointPos: 0 };
  if (exponent2 >= 0) {
    return { digits: mantissa << BigInt(exponent2), pointPos: 0 };
  }
  const k = -exponent2;
  return { digits: mantissa * 5n ** BigInt(k), pointPos: k };
}

// Rounds `digits * 10^shift` to the nearest integer, ties-to-even.
function roundToDigits(digits: bigint, shift: number): bigint {
  if (shift >= 0) return digits * 10n ** BigInt(shift);
  const divisor = 10n ** BigInt(-shift);
  const q = digits / divisor;
  const r = digits % divisor;
  const twice = r * 2n;
  if (twice < divisor) return q;
  if (twice > divisor) return q + 1n;
  return q % 2n === 0n ? q : q + 1n;
}

function roundSignificant(
  digits: bigint,
  pointPos: number,
  P: number
): { str: string; exp: number } {
  if (digits === 0n) return { str: '0'.repeat(P), exp: 0 };
  const L = digits.toString().length;
  const E0 = L - 1 - pointPos;
  let Rbig = roundToDigits(digits, P - L);
  let str = Rbig.toString();
  let exp = E0;
  if (str.length > P) {
    Rbig = Rbig / 10n;
    str = Rbig.toString();
    exp = E0 + 1;
  }
  if (str.length < P) str = str.padStart(P, '0');
  return { str, exp };
}

function pad(
  sign: string,
  prefix: string,
  digits: string,
  width: number,
  leftAlign: boolean,
  zeroPad: boolean
): string {
  const core = sign + prefix + digits;
  if (core.length >= width) return core;
  const padLen = width - core.length;
  if (leftAlign) return core + ' '.repeat(padLen);
  if (zeroPad) return sign + prefix + '0'.repeat(padLen) + digits;
  return ' '.repeat(padLen) + core;
}

function digitsWithPrecision(base: string, precision: number | undefined, isZero: boolean): string {
  if (precision === undefined) return base;
  if (precision === 0 && isZero) return '';
  if (base.length < precision) return '0'.repeat(precision - base.length) + base;
  return base;
}

function formatIntLike(
  conv: string,
  flags: Flags,
  width: number,
  precision: number | undefined,
  arg: number | bigint
): string {
  const isBig = typeof arg === 'bigint';
  if (conv === 'd' || conv === 'i') {
    const neg = isBig ? (arg as bigint) < 0n : (arg as number) < 0;
    const mag = isBig ? (neg ? -(arg as bigint) : (arg as bigint)) : Math.abs(arg as number);
    const isZero = isBig ? mag === 0n : mag === 0;
    const base = mag.toString();
    const digits = digitsWithPrecision(base, precision, isZero);
    const sign = neg ? '-' : flags.plus ? '+' : flags.space ? ' ' : '';
    const zeroPad = flags.zero && !flags.minus && precision === undefined;
    return pad(sign, '', digits, width, flags.minus, zeroPad);
  }
  // x, X, o
  const isZero = isBig ? (arg as bigint) === 0n : (arg as number) === 0;
  const radix = conv === 'o' ? 8 : 16;
  let base = arg.toString(radix);
  if (conv === 'X') base = base.toUpperCase();
  let digits = digitsWithPrecision(base, precision, isZero);
  if (conv === 'o' && flags.hash) {
    if (digits.length === 0 || digits[0] !== '0') digits = '0' + digits;
  }
  const prefix = (conv === 'x' || conv === 'X') && flags.hash && !isZero ? (conv === 'x' ? '0x' : '0X') : '';
  const zeroPad = flags.zero && !flags.minus && precision === undefined;
  return pad('', prefix, digits, width, flags.minus, zeroPad);
}

function formatFloatLike(
  conv: string,
  flags: Flags,
  width: number,
  precision: number | undefined,
  arg: number
): string {
  const upper = conv === 'E' || conv === 'F' || conv === 'G';
  const isNegative = Object.is(arg, -0) || arg < 0;

  if (Number.isNaN(arg)) {
    const body = upper ? 'NAN' : 'nan';
    return pad('', '', body, width, flags.minus, false);
  }

  const sign = isNegative ? '-' : flags.plus ? '+' : flags.space ? ' ' : '';

  if (!Number.isFinite(arg)) {
    const body = upper ? 'INF' : 'inf';
    return pad(sign, '', body, width, flags.minus, false);
  }

  const mag = Math.abs(arg);
  const { digits, pointPos } = decomposeDouble(mag);
  const zeroPad = flags.zero && !flags.minus;

  if (conv === 'f' || conv === 'F') {
    const p = precision === undefined ? 6 : precision;
    let s = roundToDigits(digits, p - pointPos).toString();
    if (s.length <= p) s = '0'.repeat(p - s.length + 1) + s;
    const intPart = s.slice(0, s.length - p);
    const fracPart = p > 0 ? s.slice(s.length - p) : '';
    const body = intPart + (p > 0 ? '.' + fracPart : flags.hash ? '.' : '');
    return pad(sign, '', body, width, flags.minus, zeroPad);
  }

  if (conv === 'e' || conv === 'E') {
    const p = precision === undefined ? 6 : precision;
    const P = p + 1;
    const { str, exp } = roundSignificant(digits, pointPos, P);
    const mantissa = str[0] + (p > 0 ? '.' + str.slice(1) : flags.hash ? '.' : '');
    const expSign = exp < 0 ? '-' : '+';
    let expAbs = Math.abs(exp).toString();
    if (expAbs.length < 2) expAbs = '0' + expAbs;
    const eLetter = conv === 'E' ? 'E' : 'e';
    const body = mantissa + eLetter + expSign + expAbs;
    return pad(sign, '', body, width, flags.minus, zeroPad);
  }

  // g, G
  let P = precision === undefined ? 6 : precision === 0 ? 1 : precision;
  const { str, exp } = roundSignificant(digits, pointPos, P);
  const useF = P > exp && exp >= -4;
  let intStr: string;
  let fracStr: string;
  let eLetter = '';
  let expSign = '';
  let expAbs = '';
  if (useF) {
    if (exp >= 0) {
      intStr = str.slice(0, exp + 1);
      fracStr = str.slice(exp + 1);
    } else {
      intStr = '0';
      fracStr = '0'.repeat(-exp - 1) + str;
    }
  } else {
    intStr = str[0];
    fracStr = str.slice(1);
    eLetter = conv === 'G' ? 'E' : 'e';
    expSign = exp < 0 ? '-' : '+';
    expAbs = Math.abs(exp).toString();
    if (expAbs.length < 2) expAbs = '0' + expAbs;
  }
  if (!flags.hash) fracStr = fracStr.replace(/0+$/, '');
  let body = intStr + (fracStr.length > 0 ? '.' + fracStr : flags.hash ? '.' : '');
  if (!useF) body += eLetter + expSign + expAbs;
  return pad(sign, '', body, width, flags.minus, zeroPad);
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let argIndex = 0;
  const spec = /%([-+0# ]*)(\d*)(\.\d*)?([diouxXeEfFgGsc%])/g;
  return fmt.replace(spec, (_match, flagsStr: string, widthStr: string, precStr: string | undefined, conv: string) => {
    if (conv === '%') return '%';

    const flags: Flags = {
      minus: flagsStr.includes('-'),
      plus: flagsStr.includes('+'),
      space: flagsStr.includes(' '),
      zero: flagsStr.includes('0'),
      hash: flagsStr.includes('#'),
    };
    const width = widthStr ? parseInt(widthStr, 10) : 0;
    const precision = precStr === undefined ? undefined : precStr.length === 1 ? 0 : parseInt(precStr.slice(1), 10);
    const arg = args[argIndex++];

    if (conv === 's') {
      let str = arg as string;
      if (precision !== undefined) str = str.slice(0, precision);
      return pad('', '', str, width, flags.minus, false);
    }
    if (conv === 'c') {
      return pad('', '', arg as string, width, flags.minus, false);
    }
    if (conv === 'd' || conv === 'i' || conv === 'x' || conv === 'X' || conv === 'o') {
      return formatIntLike(conv, flags, width, precision, arg as number | bigint);
    }
    return formatFloatLike(conv, flags, width, precision, arg as number);
  });
}
