type Flags = {
  minus: boolean;
  plus: boolean;
  space: boolean;
  zero: boolean;
  hash: boolean;
};

function parseFlags(s: string): Flags {
  return {
    minus: s.indexOf('-') !== -1,
    plus: s.indexOf('+') !== -1,
    space: s.indexOf(' ') !== -1,
    zero: s.indexOf('0') !== -1,
    hash: s.indexOf('#') !== -1,
  };
}

function padNumber(
  signPrefix: string,
  digits: string,
  width: number | undefined,
  flags: Flags,
  zeroPadAllowed: boolean
): string {
  const body = signPrefix + digits;
  if (width === undefined || body.length >= width) return body;
  const padLen = width - body.length;
  if (flags.minus) return body + ' '.repeat(padLen);
  if (flags.zero && zeroPadAllowed) return signPrefix + '0'.repeat(padLen) + digits;
  return ' '.repeat(padLen) + body;
}

// x = m * 2^e, m a nonnegative integer, e an integer. Valid for finite, nonnegative doubles.
function doubleBits(x: number): { mantissa: bigint; exp: number } {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, x, false);
  const bits = dv.getBigUint64(0, false);
  const exponentBits = (bits >> 52n) & 0x7ffn;
  const mantissaBits = bits & 0xfffffffffffffn;
  if (exponentBits === 0n) {
    return { mantissa: mantissaBits, exp: -1074 };
  }
  return { mantissa: mantissaBits | (1n << 52n), exp: Number(exponentBits) - 1075 };
}

// Exact round(mantissa * 2^exp * 10^k) to nearest integer, ties to even. Returns a nonnegative bigint.
function roundDigits(mantissa: bigint, exp: number, k: number): bigint {
  if (mantissa === 0n) return 0n;
  let N = mantissa;
  let D = 1n;
  if (k >= 0) N *= 5n ** BigInt(k);
  else D *= 5n ** BigInt(-k);
  const e2 = exp + k;
  if (e2 >= 0) N <<= BigInt(e2);
  else D <<= BigInt(-e2);
  let q = N / D;
  const r = N % D;
  const twice = r * 2n;
  if (twice > D || (twice === D && (q & 1n) === 1n)) q += 1n;
  return q;
}

// Returns the decimal exponent X and the (p+1)-digit rounded significant digit string.
function computeSci(mantissa: bigint, exp: number, p: number): { X: number; digits: string } {
  if (mantissa === 0n) {
    return { X: 0, digits: '0'.repeat(p + 1) };
  }
  let X = Math.floor(exp * Math.log10(2) + Math.log10(Number(mantissa)));
  for (let iter = 0; iter < 8; iter++) {
    const k = p - X;
    const q = roundDigits(mantissa, exp, k);
    const s = q.toString();
    if (s.length > p + 1) {
      X += s.length - (p + 1);
      continue;
    }
    if (s.length < p + 1) {
      X -= p + 1 - s.length;
      continue;
    }
    return { X, digits: s };
  }
  const k = p - X;
  const q = roundDigits(mantissa, exp, k);
  return { X, digits: q.toString().padStart(p + 1, '0') };
}

function computeFixed(mantissa: bigint, exp: number, p: number): { intPart: string; fracPart: string } {
  const q = roundDigits(mantissa, exp, p);
  const s = q.toString().padStart(p + 1, '0');
  const intPart = p > 0 ? s.slice(0, s.length - p) : s;
  const fracPart = p > 0 ? s.slice(s.length - p) : '';
  return { intPart: intPart === '' ? '0' : intPart, fracPart };
}

function stripTrailingZeros(s: string): string {
  return s.replace(/0+$/, '');
}

function formatIntConv(
  value: bigint,
  flags: Flags,
  width: number | undefined,
  precision: number | undefined,
  conv: string
): string {
  const negative = value < 0n;
  const mag = negative ? -value : value;

  let radix = 10;
  let upper = false;
  if (conv === 'x') radix = 16;
  else if (conv === 'X') {
    radix = 16;
    upper = true;
  } else if (conv === 'o') radix = 8;

  let digits = mag.toString(radix);
  if (upper) digits = digits.toUpperCase();

  if (precision !== undefined) {
    if (precision === 0 && mag === 0n) digits = '';
    else digits = digits.padStart(precision, '0');
  }

  let prefix = '';
  if (conv === 'x' || conv === 'X') {
    if (flags.hash && mag !== 0n) prefix = conv === 'x' ? '0x' : '0X';
  }
  if (conv === 'o' && flags.hash) {
    if (digits === '' || digits[0] !== '0') digits = '0' + digits;
  }

  let sign = '';
  if (conv === 'd' || conv === 'i') {
    sign = negative ? '-' : flags.plus ? '+' : flags.space ? ' ' : '';
  }

  const zeroPadAllowed = precision === undefined;
  return padNumber(sign + prefix, digits, width, flags, zeroPadAllowed);
}

function formatFloatConv(
  value: number,
  flags: Flags,
  width: number | undefined,
  precision: number | undefined,
  conv: string
): string {
  const isUpper = conv === 'F' || conv === 'E' || conv === 'G';
  const negative = value < 0 || Object.is(value, -0);
  const isNaN = Number.isNaN(value);
  const isInf = !Number.isFinite(value) && !isNaN;

  let sign = '';
  if (!isNaN) {
    sign = negative ? '-' : flags.plus ? '+' : flags.space ? ' ' : '';
  }

  if (isNaN) {
    return padNumber('', isUpper ? 'NAN' : 'nan', width, flags, false);
  }
  if (isInf) {
    return padNumber(sign, isUpper ? 'INF' : 'inf', width, flags, false);
  }

  const { mantissa, exp } = doubleBits(Math.abs(value));

  let digitsBody: string;
  if (conv === 'f' || conv === 'F') {
    const p = precision === undefined ? 6 : precision;
    const { intPart, fracPart } = computeFixed(mantissa, exp, p);
    const dot = fracPart.length > 0 || flags.hash ? '.' : '';
    digitsBody = intPart + dot + fracPart;
  } else if (conv === 'e' || conv === 'E') {
    const p = precision === undefined ? 6 : precision;
    const { X, digits } = computeSci(mantissa, exp, p);
    const d1 = digits[0];
    const rest = digits.slice(1);
    const dot = rest.length > 0 || flags.hash ? '.' : '';
    const expSign = X < 0 ? '-' : '+';
    const expAbs = Math.abs(X).toString().padStart(2, '0');
    digitsBody = d1 + dot + rest + (conv === 'E' ? 'E' : 'e') + expSign + expAbs;
  } else {
    // g, G
    const P = precision === undefined ? 6 : precision === 0 ? 1 : precision;
    const p = P - 1;
    const { X, digits } = computeSci(mantissa, exp, p);
    if (P > X && X >= -4) {
      const fp = P - 1 - X;
      const { intPart, fracPart: fracPartRaw } = computeFixed(mantissa, exp, fp);
      const fracPart = flags.hash ? fracPartRaw : stripTrailingZeros(fracPartRaw);
      const dot = fracPart.length > 0 || flags.hash ? '.' : '';
      digitsBody = intPart + dot + fracPart;
    } else {
      const d1 = digits[0];
      const restRaw = digits.slice(1);
      const rest = flags.hash ? restRaw : stripTrailingZeros(restRaw);
      const dot = rest.length > 0 || flags.hash ? '.' : '';
      const expSign = X < 0 ? '-' : '+';
      const expAbs = Math.abs(X).toString().padStart(2, '0');
      digitsBody = d1 + dot + rest + (conv === 'G' ? 'E' : 'e') + expSign + expAbs;
    }
  }

  return padNumber(sign, digitsBody, width, flags, true);
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  const re = /%([-+0 #]*)(\d*)(?:\.(\d*))?(%|[diouxXeEfFgGsc])/g;
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
    const width = widthStr === '' ? undefined : parseInt(widthStr, 10);
    const precision = precStr === undefined ? undefined : precStr === '' ? 0 : parseInt(precStr, 10);

    const arg = args[argIndex++];

    if (conv === 'd' || conv === 'i' || conv === 'x' || conv === 'X' || conv === 'o') {
      const bigValue = typeof arg === 'bigint' ? arg : BigInt(arg as number);
      result += formatIntConv(bigValue, flags, width, precision, conv);
    } else if (
      conv === 'e' ||
      conv === 'E' ||
      conv === 'f' ||
      conv === 'F' ||
      conv === 'g' ||
      conv === 'G'
    ) {
      result += formatFloatConv(arg as number, flags, width, precision, conv);
    } else if (conv === 's') {
      let text = arg as string;
      if (precision !== undefined) text = text.slice(0, precision);
      result += padNumber('', text, width, flags, false);
    } else if (conv === 'c') {
      result += padNumber('', arg as string, width, flags, false);
    }
  }

  result += fmt.slice(lastIndex);
  return result;
}
