type Flags = {
  minus: boolean;
  plus: boolean;
  space: boolean;
  zero: boolean;
  hash: boolean;
};

// Rounds the decimal digit string `full` (no sign, no point) to its `keepLen`
// most significant digits using round-half-to-even, based on the exact value.
// Returns a digit string of length keepLen, or keepLen+1 if rounding carried
// (e.g. "999" rounded to 3 digits carrying becomes "1000").
function roundAt(full: string, keepLen: number): string {
  const L = full.length;
  if (keepLen >= L) {
    return full + '0'.repeat(keepLen - L);
  }
  const dropLen = L - keepLen;
  const divisor = 10n ** BigInt(dropLen);
  const big = BigInt(full);
  let q = big / divisor;
  const r = big % divisor;
  const half = 5n * 10n ** BigInt(dropLen - 1);
  if (r > half) {
    q += 1n;
  } else if (r === half) {
    if (q % 2n === 1n) q += 1n;
  }
  let qs = q.toString();
  if (qs.length < keepLen) qs = qs.padStart(keepLen, '0');
  return qs;
}

function decodeDouble(x: number): { m: bigint; e: number } {
  const buf = new ArrayBuffer(8);
  const dv = new DataView(buf);
  dv.setFloat64(0, Math.abs(x));
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const expBits = (hi >>> 20) & 0x7ff;
  const mantHigh = hi & 0xfffff;
  const mantissa = (BigInt(mantHigh) << 32n) | BigInt(lo);
  if (expBits === 0) {
    return { m: mantissa, e: -1074 };
  }
  return { m: mantissa | (1n << 52n), e: expBits - 1075 };
}

// Exact decimal expansion of m * 2^e (finite, since denominator is a power of two).
function exactDecimal(m: bigint, e: number): { intPart: string; fracPart: string } {
  if (m === 0n) return { intPart: '0', fracPart: '' };
  if (e >= 0) {
    return { intPart: (m << BigInt(e)).toString(), fracPart: '' };
  }
  const k = -e;
  const n = m * 5n ** BigInt(k);
  let s = n.toString();
  if (s.length <= k) s = s.padStart(k + 1, '0');
  return { intPart: s.slice(0, s.length - k), fracPart: s.slice(s.length - k) };
}

function formatFixed(
  intPart: string,
  fracPart: string,
  precision: number
): { intOut: string; fracOut: string } {
  const full = intPart + fracPart;
  const keepLen = intPart.length + precision;
  const rounded = roundAt(full, keepLen);
  const fracOut = precision > 0 ? rounded.slice(rounded.length - precision) : '';
  const intOut = rounded.slice(0, rounded.length - precision);
  return { intOut, fracOut };
}

function formatExp(
  intPart: string,
  fracPart: string,
  precision: number
): { digit0: string; fracDigits: string; exponent: number } {
  const full = intPart + fracPart;
  let idx = -1;
  for (let i = 0; i < full.length; i++) {
    if (full[i] !== '0') {
      idx = i;
      break;
    }
  }
  if (idx === -1) {
    return { digit0: '0', fracDigits: '0'.repeat(precision), exponent: 0 };
  }
  let exponent = intPart.length - 1 - idx;
  const sub = full.slice(idx);
  const keepLen = precision + 1;
  const rounded = roundAt(sub, keepLen);
  if (rounded.length > keepLen) {
    exponent += rounded.length - keepLen;
  }
  const digits = rounded.slice(0, keepLen);
  return { digit0: digits[0], fracDigits: digits.slice(1), exponent };
}

function padNum(
  sign: string,
  prefix: string,
  digits: string,
  width: number,
  zeroFlag: boolean,
  minusFlag: boolean
): string {
  const content = sign + prefix + digits;
  if (content.length >= width) return content;
  const padLen = width - content.length;
  if (minusFlag) return content + ' '.repeat(padLen);
  if (zeroFlag) return sign + prefix + '0'.repeat(padLen) + digits;
  return ' '.repeat(padLen) + content;
}

function padText(text: string, width: number, minusFlag: boolean): string {
  if (text.length >= width) return text;
  const padLen = width - text.length;
  return minusFlag ? text + ' '.repeat(padLen) : ' '.repeat(padLen) + text;
}

function signFor(neg: boolean, flags: Flags): string {
  if (neg) return '-';
  if (flags.plus) return '+';
  if (flags.space) return ' ';
  return '';
}

function expString(exponent: number, upper: boolean): string {
  const expSign = exponent < 0 ? '-' : '+';
  const expAbs = Math.abs(exponent).toString().padStart(2, '0');
  return (upper ? 'E' : 'e') + expSign + expAbs;
}

function formatIntLike(
  conv: string,
  arg: number | bigint,
  flags: Flags,
  width: number,
  precision: number | undefined
): string {
  if (conv === 'd' || conv === 'i') {
    let neg: boolean;
    let magnitude: bigint;
    if (typeof arg === 'bigint') {
      neg = arg < 0n;
      magnitude = neg ? -arg : arg;
    } else {
      neg = arg < 0;
      magnitude = BigInt(Math.abs(arg));
    }
    let digits = magnitude.toString(10);
    if (precision !== undefined) {
      digits = precision === 0 && magnitude === 0n ? '' : digits.padStart(precision, '0');
    }
    const sign = signFor(neg, flags);
    const zeroFlag = flags.zero && precision === undefined;
    return padNum(sign, '', digits, width, zeroFlag, flags.minus);
  }

  // x, X, o
  const v: bigint = typeof arg === 'bigint' ? arg : BigInt(Math.trunc(arg as number));
  let digits = v.toString(conv === 'o' ? 8 : 16);
  if (conv === 'X') digits = digits.toUpperCase();
  if (precision !== undefined) {
    digits = precision === 0 && v === 0n ? '' : digits.padStart(precision, '0');
  }
  let prefix = '';
  if (flags.hash) {
    if ((conv === 'x' || conv === 'X') && v !== 0n) {
      prefix = conv === 'x' ? '0x' : '0X';
    } else if (conv === 'o' && (digits === '' || digits[0] !== '0')) {
      digits = '0' + digits;
    }
  }
  const zeroFlag = flags.zero && precision === undefined;
  return padNum('', prefix, digits, width, zeroFlag, flags.minus);
}

function formatFloatLike(
  conv: string,
  arg: number,
  flags: Flags,
  width: number,
  precisionArg: number | undefined
): string {
  const upper = conv === conv.toUpperCase();
  const lower = conv.toLowerCase();

  if (Number.isNaN(arg)) {
    const text = upper ? 'NAN' : 'nan';
    return padText(text, width, flags.minus);
  }
  if (!Number.isFinite(arg)) {
    const neg = arg < 0;
    const sign = signFor(neg, flags);
    const text = sign + (upper ? 'INF' : 'inf');
    return padText(text, width, flags.minus);
  }

  const neg = arg < 0 || Object.is(arg, -0);
  const sign = signFor(neg, flags);
  const { m, e } = decodeDouble(arg);
  const { intPart, fracPart } = exactDecimal(m, e);

  let body: string;

  if (lower === 'f') {
    const precision = precisionArg === undefined ? 6 : precisionArg;
    const { intOut, fracOut } = formatFixed(intPart, fracPart, precision);
    body = intOut + (precision > 0 || flags.hash ? '.' + fracOut : '');
  } else if (lower === 'e') {
    const precision = precisionArg === undefined ? 6 : precisionArg;
    const { digit0, fracDigits, exponent } = formatExp(intPart, fracPart, precision);
    body =
      digit0 +
      (precision > 0 || flags.hash ? '.' + fracDigits : '') +
      expString(exponent, upper);
  } else {
    // g, G
    const pg = precisionArg === undefined ? 6 : precisionArg === 0 ? 1 : precisionArg;
    const { digit0, fracDigits, exponent } = formatExp(intPart, fracPart, pg - 1);
    if (pg > exponent && exponent >= -4) {
      const fPrec = pg - 1 - exponent;
      const { intOut, fracOut } = formatFixed(intPart, fracPart, fPrec);
      let frac = fracOut;
      if (!flags.hash) frac = frac.replace(/0+$/, '');
      body = intOut + (frac.length > 0 ? '.' + frac : flags.hash ? '.' : '');
    } else {
      let frac = fracDigits;
      if (!flags.hash) frac = frac.replace(/0+$/, '');
      body =
        digit0 +
        (frac.length > 0 ? '.' + frac : flags.hash ? '.' : '') +
        expString(exponent, upper);
    }
  }

  return padNum(sign, '', body, width, flags.zero, flags.minus);
}

function formatOne(
  flagsStr: string,
  widthStr: string,
  precStr: string | undefined,
  conv: string,
  arg: number | bigint | string
): string {
  const flags: Flags = {
    minus: flagsStr.includes('-'),
    plus: flagsStr.includes('+'),
    space: flagsStr.includes(' '),
    zero: flagsStr.includes('0'),
    hash: flagsStr.includes('#'),
  };
  const width = widthStr ? parseInt(widthStr, 10) : 0;
  const precision = precStr === undefined ? undefined : precStr === '' ? 0 : parseInt(precStr, 10);

  if (conv === 'd' || conv === 'i' || conv === 'x' || conv === 'X' || conv === 'o') {
    return formatIntLike(conv, arg as number | bigint, flags, width, precision);
  }
  if (
    conv === 'e' ||
    conv === 'E' ||
    conv === 'f' ||
    conv === 'F' ||
    conv === 'g' ||
    conv === 'G'
  ) {
    return formatFloatLike(conv, arg as number, flags, width, precision);
  }
  if (conv === 's') {
    let text = arg as string;
    if (precision !== undefined) text = text.slice(0, precision);
    return padText(text, width, flags.minus);
  }
  if (conv === 'c') {
    return padText(arg as string, width, flags.minus);
  }
  throw new Error(`unsupported conversion: ${conv}`);
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  const re = /%([-+0 #]*)(\d*)(?:\.(\d*))?([a-zA-Z%])/g;
  let result = '';
  let lastIndex = 0;
  let argIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(fmt))) {
    result += fmt.slice(lastIndex, m.index);
    lastIndex = re.lastIndex;
    const [, flagsStr, widthStr, precStr, conv] = m;
    if (conv === '%') {
      result += '%';
      continue;
    }
    const arg = args[argIndex++];
    result += formatOne(flagsStr, widthStr, precStr, conv, arg);
  }
  result += fmt.slice(lastIndex);
  return result;
}
