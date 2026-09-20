type Arg = number | bigint | string;

interface Flags {
  minus: boolean;
  plus: boolean;
  space: boolean;
  zero: boolean;
  hash: boolean;
}

function parseFlags(flagsStr: string): Flags {
  return {
    minus: flagsStr.includes('-'),
    plus: flagsStr.includes('+'),
    space: flagsStr.includes(' '),
    zero: flagsStr.includes('0'),
    hash: flagsStr.includes('#'),
  };
}

function padNum(
  sign: string,
  prefix: string,
  digits: string,
  width: number,
  useZero: boolean,
  minus: boolean
): string {
  const content = sign + prefix + digits;
  if (content.length >= width) return content;
  const padLen = width - content.length;
  if (minus) return content + ' '.repeat(padLen);
  if (useZero) return sign + prefix + '0'.repeat(padLen) + digits;
  return ' '.repeat(padLen) + content;
}

function padPlain(str: string, width: number, minus: boolean): string {
  if (str.length >= width) return str;
  const padLen = width - str.length;
  return minus ? str + ' '.repeat(padLen) : ' '.repeat(padLen) + str;
}

function signStr(isNegative: boolean, plus: boolean, space: boolean): string {
  return isNegative ? '-' : plus ? '+' : space ? ' ' : '';
}

function isNegativeValue(x: number): boolean {
  return x < 0 || Object.is(x, -0);
}

function toBigIntMag(value: number | bigint): { neg: boolean; mag: bigint } {
  if (typeof value === 'bigint') {
    return value < 0n ? { neg: true, mag: -value } : { neg: false, mag: value };
  }
  const neg = value < 0 || Object.is(value, -0);
  const mag = BigInt(Math.abs(value));
  return { neg, mag };
}

// Decomposes a finite, nonzero JS number into mantissaBig * 2^exp2 (mantissaBig > 0).
function decomposeDouble(x: number): { mantissaBig: bigint; exp2: number } {
  const buf = new ArrayBuffer(8);
  const view = new DataView(buf);
  view.setFloat64(0, x);
  const hi = view.getUint32(0);
  const lo = view.getUint32(4);
  const exponent = (hi >>> 20) & 0x7ff;
  const mantHi = hi & 0xfffff;
  const mantissaBits = (BigInt(mantHi) << 32n) | BigInt(lo >>> 0);
  if (exponent === 0) {
    return { mantissaBig: mantissaBits, exp2: -1074 };
  }
  return { mantissaBig: mantissaBits | (1n << 52n), exp2: exponent - 1023 - 52 };
}

// Computes round(mantissaBig * 2^exp2 * 10^k) with round-half-to-even, exact.
function roundToInt(mantissaBig: bigint, exp2: number, k: number): bigint {
  const e2 = exp2 + k;
  const e5 = k;
  let num = mantissaBig;
  let den = 1n;
  if (e2 >= 0) num *= 2n ** BigInt(e2);
  else den *= 2n ** BigInt(-e2);
  if (e5 >= 0) num *= 5n ** BigInt(e5);
  else den *= 5n ** BigInt(-e5);
  const q = num / den;
  const r = num % den;
  const twice = r * 2n;
  if (twice < den) return q;
  if (twice > den) return q + 1n;
  return q % 2n === 0n ? q : q + 1n;
}

// Rounds mantissaBig*2^exp2 (>0) to `sig` significant decimal digits.
function getSignificantDigits(
  mantissaBig: bigint,
  exp2: number,
  sig: number
): { digits: string; exp: number } {
  let X = Math.floor(Math.log10(Number(mantissaBig)) + exp2 * Math.log10(2));
  const lower = 10n ** BigInt(sig - 1);
  const upper = 10n ** BigInt(sig);
  for (;;) {
    const k = sig - 1 - X;
    const D = roundToInt(mantissaBig, exp2, k);
    if (D >= upper) {
      X += 1;
      continue;
    }
    if (D < lower) {
      X -= 1;
      continue;
    }
    return { digits: D.toString(), exp: X };
  }
}

function trimFrac(frac: string, hash: boolean): { dot: boolean; frac: string } {
  if (hash) return { dot: true, frac };
  const trimmed = frac.replace(/0+$/, '');
  return { dot: trimmed.length > 0, frac: trimmed };
}

function formatIntConv(
  conv: string,
  value: number | bigint,
  flags: Flags,
  width: number,
  precision: number | undefined
): string {
  const { neg, mag } = toBigIntMag(value);
  let base = 10;
  let upper = false;
  if (conv === 'x' || conv === 'X') base = 16;
  if (conv === 'o') base = 8;
  if (conv === 'X') upper = true;

  let digitsStr: string;
  if (precision !== undefined && precision === 0 && mag === 0n) {
    digitsStr = '';
  } else {
    digitsStr = mag.toString(base);
    if (upper) digitsStr = digitsStr.toUpperCase();
    if (precision !== undefined) digitsStr = digitsStr.padStart(precision, '0');
  }

  let sign = '';
  let prefix = '';
  if (conv === 'd' || conv === 'i') {
    sign = signStr(neg, flags.plus, flags.space);
  } else if (conv === 'x' || conv === 'X') {
    if (flags.hash && mag !== 0n) prefix = conv === 'X' ? '0X' : '0x';
  } else if (conv === 'o') {
    if (flags.hash) {
      if (digitsStr.length === 0 || digitsStr[0] !== '0') digitsStr = '0' + digitsStr;
    }
  }

  const useZero = flags.zero && !flags.minus && precision === undefined;
  return padNum(sign, prefix, digitsStr, width, useZero, flags.minus);
}

function formatFloatConv(
  conv: string,
  value: number,
  flags: Flags,
  width: number,
  precision: number | undefined
): string {
  const lower = conv.toLowerCase();
  const upperCase = conv !== lower;

  if (Number.isNaN(value)) {
    const text = upperCase ? 'NAN' : 'nan';
    return padPlain(text, width, flags.minus);
  }

  const neg = isNegativeValue(value);
  const sign = signStr(neg, flags.plus, flags.space);

  if (!Number.isFinite(value)) {
    const text = upperCase ? 'INF' : 'inf';
    return padNum(sign, '', text, width, false, flags.minus);
  }

  const useZero = flags.zero && !flags.minus;

  if (lower === 'f') {
    const P = precision !== undefined ? precision : 6;
    let intPart: string;
    let fracPart: string;
    if (value === 0) {
      intPart = '0';
      fracPart = '0'.repeat(P);
    } else {
      const { mantissaBig, exp2 } = decomposeDouble(Math.abs(value));
      const D = roundToInt(mantissaBig, exp2, P);
      let digitsStr = D.toString();
      if (P > 0) {
        digitsStr = digitsStr.padStart(P + 1, '0');
        intPart = digitsStr.slice(0, digitsStr.length - P);
        fracPart = digitsStr.slice(digitsStr.length - P);
      } else {
        intPart = digitsStr;
        fracPart = '';
      }
    }
    const dot = P > 0 || flags.hash;
    const body = intPart + (dot ? '.' : '') + fracPart;
    return padNum(sign, '', body, width, useZero, flags.minus);
  }

  if (lower === 'e') {
    const P = precision !== undefined ? precision : 6;
    const sig = P + 1;
    let digits: string;
    let X: number;
    if (value === 0) {
      digits = '0'.repeat(sig);
      X = 0;
    } else {
      const { mantissaBig, exp2 } = decomposeDouble(Math.abs(value));
      const res = getSignificantDigits(mantissaBig, exp2, sig);
      digits = res.digits;
      X = res.exp;
    }
    const first = digits[0];
    const rest = digits.slice(1);
    const dot = P > 0 || flags.hash;
    const expLetter = upperCase ? 'E' : 'e';
    const expSign = X >= 0 ? '+' : '-';
    const expAbs = Math.abs(X).toString().padStart(2, '0');
    const body = first + (dot ? '.' : '') + rest + expLetter + expSign + expAbs;
    return padNum(sign, '', body, width, useZero, flags.minus);
  }

  // g, G
  const Pin = precision !== undefined ? precision : 6;
  const Peff = Pin === 0 ? 1 : Pin;
  let digits: string;
  let X: number;
  if (value === 0) {
    digits = '0'.repeat(Peff);
    X = 0;
  } else {
    const { mantissaBig, exp2 } = decomposeDouble(Math.abs(value));
    const res = getSignificantDigits(mantissaBig, exp2, Peff);
    digits = res.digits;
    X = res.exp;
  }

  let body: string;
  if (Peff > X && X >= -4) {
    let intPart: string;
    let fracPartFull: string;
    if (X >= 0) {
      intPart = digits.slice(0, X + 1);
      fracPartFull = digits.slice(X + 1);
    } else {
      intPart = '0';
      fracPartFull = '0'.repeat(-X - 1) + digits;
    }
    const { dot, frac } = trimFrac(fracPartFull, flags.hash);
    body = intPart + (dot ? '.' : '') + frac;
  } else {
    const first = digits[0];
    const restFull = digits.slice(1);
    const { dot, frac } = trimFrac(restFull, flags.hash);
    const expLetter = upperCase ? 'E' : 'e';
    const expSign = X >= 0 ? '+' : '-';
    const expAbs = Math.abs(X).toString().padStart(2, '0');
    body = first + (dot ? '.' : '') + frac + expLetter + expSign + expAbs;
  }
  return padNum(sign, '', body, width, useZero, flags.minus);
}

export function format(fmt: string, ...args: Arg[]): string {
  const re = /%([-+0 #]*)(\d*)(?:\.(\d*))?([diouxXeEfFgGsc%])/g;
  let result = '';
  let lastIndex = 0;
  let argIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = re.exec(fmt)) !== null) {
    result += fmt.slice(lastIndex, match.index);
    lastIndex = re.lastIndex;

    const [, flagsStr, widthStr, precStr, conv] = match;

    if (conv === '%') {
      result += '%';
      continue;
    }

    const flags = parseFlags(flagsStr);
    const width = widthStr === '' ? 0 : parseInt(widthStr, 10);
    const precision = precStr === undefined ? undefined : precStr === '' ? 0 : parseInt(precStr, 10);

    const arg = args[argIndex++];

    if (conv === 'd' || conv === 'i' || conv === 'x' || conv === 'X' || conv === 'o') {
      result += formatIntConv(conv, arg as number | bigint, flags, width, precision);
    } else if (
      conv === 'e' ||
      conv === 'E' ||
      conv === 'f' ||
      conv === 'F' ||
      conv === 'g' ||
      conv === 'G'
    ) {
      result += formatFloatConv(conv, arg as number, flags, width, precision);
    } else if (conv === 's') {
      let str = arg as string;
      if (precision !== undefined) str = str.slice(0, precision);
      result += padPlain(str, width, flags.minus);
    } else if (conv === 'c') {
      const str = arg as string;
      result += padPlain(str, width, flags.minus);
    }
  }

  result += fmt.slice(lastIndex);
  return result;
}
