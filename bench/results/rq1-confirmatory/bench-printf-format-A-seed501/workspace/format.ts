type Flags = {
  minus: boolean;
  plus: boolean;
  space: boolean;
  zero: boolean;
  hash: boolean;
};

function decompose(absX: number): { numerator: bigint; fracDigits: number } {
  if (absX === 0) return { numerator: 0n, fracDigits: 0 };
  const buf = new ArrayBuffer(8);
  const view = new DataView(buf);
  view.setFloat64(0, absX);
  const bits = view.getBigUint64(0);
  const exponentBits = (bits >> 52n) & 0x7ffn;
  const mantissaBits = bits & 0xfffffffffffffn;
  let mantissa: bigint;
  let exp2: number;
  if (exponentBits === 0n) {
    mantissa = mantissaBits;
    exp2 = -1074;
  } else {
    mantissa = mantissaBits | (1n << 52n);
    exp2 = Number(exponentBits) - 1075;
  }
  let numerator: bigint;
  let fracDigits: number;
  if (exp2 >= 0) {
    numerator = mantissa << BigInt(exp2);
    fracDigits = 0;
  } else {
    numerator = mantissa * 5n ** BigInt(-exp2);
    fracDigits = -exp2;
  }
  return { numerator, fracDigits };
}

// Rounds numerator/10^fracDigits to targetFrac fractional digits, round-half-to-even.
// Returns a nonnegative BigInt representing value * 10^targetFrac.
function roundToFractionDigits(
  numerator: bigint,
  fracDigits: number,
  targetFrac: number
): bigint {
  if (targetFrac >= fracDigits) {
    return numerator * 10n ** BigInt(targetFrac - fracDigits);
  }
  const d = fracDigits - targetFrac;
  const divisor = 10n ** BigInt(d);
  let q = numerator / divisor;
  const r = numerator % divisor;
  const twice = r * 2n;
  if (twice > divisor) {
    q += 1n;
  } else if (twice === divisor) {
    if (q % 2n === 1n) q += 1n;
  }
  return q;
}

function formatFixed(absX: number, precision: number): { intPart: string; fracPart: string } {
  const { numerator, fracDigits } = decompose(absX);
  const q = roundToFractionDigits(numerator, fracDigits, precision);
  let qStr = q.toString();
  if (qStr.length <= precision) qStr = qStr.padStart(precision + 1, '0');
  const intPart = qStr.slice(0, qStr.length - precision) || '0';
  const fracPart = precision > 0 ? qStr.slice(qStr.length - precision) : '';
  return { intPart, fracPart };
}

function formatExp(absX: number, precision: number): { digits: string; exp: number } {
  if (absX === 0) {
    return { digits: '0'.repeat(precision + 1), exp: 0 };
  }
  const { numerator, fracDigits } = decompose(absX);
  const L = numerator.toString().length;
  let E = L - 1 - fracDigits;
  const targetFrac = fracDigits - L + precision + 1;
  const q = roundToFractionDigits(numerator, fracDigits, targetFrac);
  let qStr = q.toString();
  if (qStr.length > precision + 1) {
    E += qStr.length - (precision + 1);
    qStr = qStr.slice(0, precision + 1);
  } else if (qStr.length < precision + 1) {
    qStr = qStr.padEnd(precision + 1, '0');
  }
  return { digits: qStr, exp: E };
}

function padWithPrefix(
  prefix: string,
  body: string,
  width: number | undefined,
  minus: boolean,
  zero: boolean
): string {
  const full = prefix + body;
  if (width === undefined || full.length >= width) return full;
  const padLen = width - full.length;
  if (minus) return full + ' '.repeat(padLen);
  if (zero) return prefix + '0'.repeat(padLen) + body;
  return ' '.repeat(padLen) + full;
}

function padPlain(body: string, width: number | undefined, minus: boolean): string {
  if (width === undefined || body.length >= width) return body;
  const padLen = width - body.length;
  return minus ? body + ' '.repeat(padLen) : ' '.repeat(padLen) + body;
}

function signFor(negative: boolean, flags: Flags): string {
  if (negative) return '-';
  if (flags.plus) return '+';
  if (flags.space) return ' ';
  return '';
}

function isNegativeNumber(x: number): boolean {
  return x < 0 || Object.is(x, -0);
}

function formatIntLike(
  value: bigint,
  width: number | undefined,
  precision: number | undefined,
  flags: Flags,
  conv: string
): string {
  let sign = '';
  let prefix = '';
  let abs: bigint;
  if (conv === 'd' || conv === 'i') {
    const negative = value < 0n;
    abs = negative ? -value : value;
    sign = signFor(negative, flags);
  } else {
    abs = value;
  }

  let digits: string;
  if (conv === 'x' || conv === 'X') {
    digits = abs.toString(16);
    if (conv === 'X') digits = digits.toUpperCase();
  } else if (conv === 'o') {
    digits = abs.toString(8);
  } else {
    digits = abs.toString(10);
  }

  if (precision !== undefined) {
    if (abs === 0n && precision === 0) {
      digits = '';
    } else {
      digits = digits.padStart(precision, '0');
    }
  }

  if (conv === 'o' && flags.hash) {
    if (digits.length === 0 || digits[0] !== '0') digits = '0' + digits;
  }

  if ((conv === 'x' || conv === 'X') && flags.hash && abs !== 0n) {
    prefix = conv === 'x' ? '0x' : '0X';
  }

  const zeroEffective = flags.zero && !flags.minus && precision === undefined;
  return padWithPrefix(sign + prefix, digits, width, flags.minus, zeroEffective);
}

function stripTrailingZerosFrac(frac: string, hash: boolean): string {
  if (hash) return frac;
  return frac.replace(/0+$/, '');
}

function formatFloatLike(
  x: number,
  width: number | undefined,
  precisionGiven: number | undefined,
  flags: Flags,
  conv: string
): string {
  const upper = conv === 'F' || conv === 'E' || conv === 'G';

  if (Number.isNaN(x)) {
    const word = upper ? 'NAN' : 'nan';
    return padWithPrefix('', word, width, flags.minus, false);
  }

  const negative = isNegativeNumber(x);
  const sign = signFor(negative, flags);

  if (!Number.isFinite(x)) {
    const word = upper ? 'INF' : 'inf';
    return padWithPrefix(sign, word, width, flags.minus, false);
  }

  const absX = Math.abs(x);
  const kind = conv.toLowerCase();

  if (kind === 'f') {
    const precision = precisionGiven ?? 6;
    const { intPart, fracPart } = formatFixed(absX, precision);
    let frac = fracPart;
    const body = intPart + (precision > 0 || flags.hash ? '.' + frac : '');
    const zeroEffective = flags.zero && !flags.minus;
    return padWithPrefix(sign, body, width, flags.minus, zeroEffective);
  }

  if (kind === 'e') {
    const precision = precisionGiven ?? 6;
    const { digits, exp } = formatExp(absX, precision);
    const expLetter = upper ? 'E' : 'e';
    const expSign = exp >= 0 ? '+' : '-';
    const expDigits = Math.abs(exp).toString().padStart(2, '0');
    const mantissaFrac = digits.slice(1);
    const body =
      digits[0] +
      (precision > 0 || flags.hash ? '.' + mantissaFrac : '') +
      expLetter +
      expSign +
      expDigits;
    const zeroEffective = flags.zero && !flags.minus;
    return padWithPrefix(sign, body, width, flags.minus, zeroEffective);
  }

  // g / G
  const P = precisionGiven === 0 ? 1 : precisionGiven ?? 6;
  const { digits, exp: X } = formatExp(absX, P - 1);
  let body: string;
  if (P > X && X >= -4) {
    const prec = P - 1 - X;
    const { intPart, fracPart } = formatFixed(absX, prec);
    const frac = stripTrailingZerosFrac(fracPart, flags.hash);
    body = intPart + (frac.length > 0 || flags.hash ? '.' + frac : '');
  } else {
    const expLetter = upper ? 'E' : 'e';
    const expSign = X >= 0 ? '+' : '-';
    const expDigits = Math.abs(X).toString().padStart(2, '0');
    let mantissaFrac = digits.slice(1);
    mantissaFrac = stripTrailingZerosFrac(mantissaFrac, flags.hash);
    body =
      digits[0] +
      (mantissaFrac.length > 0 || flags.hash ? '.' + mantissaFrac : '') +
      expLetter +
      expSign +
      expDigits;
  }
  const zeroEffective = flags.zero && !flags.minus;
  return padWithPrefix(sign, body, width, flags.minus, zeroEffective);
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let result = '';
  let argIndex = 0;
  const re = /%([-+ 0#]*)(\d*)(\.\d*)?([diouxXeEfFgGsc%])/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = re.exec(fmt)) !== null) {
    result += fmt.slice(lastIndex, match.index);
    lastIndex = re.lastIndex;

    const [, flagsStr, widthStr, precGroup, conv] = match;

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
    const width = widthStr === '' ? undefined : parseInt(widthStr, 10);
    const precision =
      precGroup === undefined
        ? undefined
        : precGroup.length === 1
        ? 0
        : parseInt(precGroup.slice(1), 10);

    const arg = args[argIndex++];

    if (conv === 'd' || conv === 'i') {
      const value = typeof arg === 'bigint' ? arg : BigInt(arg as number);
      result += formatIntLike(value, width, precision, flags, conv);
    } else if (conv === 'x' || conv === 'X' || conv === 'o') {
      const value = typeof arg === 'bigint' ? arg : BigInt(arg as number);
      result += formatIntLike(value, width, precision, flags, conv);
    } else if (
      conv === 'e' ||
      conv === 'E' ||
      conv === 'f' ||
      conv === 'F' ||
      conv === 'g' ||
      conv === 'G'
    ) {
      result += formatFloatLike(arg as number, width, precision, flags, conv);
    } else if (conv === 's') {
      let s = arg as string;
      if (precision !== undefined) s = s.slice(0, precision);
      result += padPlain(s, width, flags.minus);
    } else if (conv === 'c') {
      const s = arg as string;
      result += padPlain(s, width, flags.minus);
    }
  }

  result += fmt.slice(lastIndex);
  return result;
}
