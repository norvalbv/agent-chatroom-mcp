function decompose(absX: number): { M: bigint; E: number } {
  const buf = new ArrayBuffer(8);
  const view = new DataView(buf);
  view.setFloat64(0, absX);
  const bits = view.getBigUint64(0);
  const exponentBits = Number((bits >> 52n) & 0x7ffn);
  const mantissaBits = bits & 0xfffffffffffffn;
  if (exponentBits === 0) {
    return { M: mantissaBits, E: -1074 };
  }
  return { M: mantissaBits | (1n << 52n), E: exponentBits - 1075 };
}

// Rounds M * 2^E * 10^k to the nearest integer, ties to even.
function scaledRound(M: bigint, E: number, k: number): bigint {
  const a = E + k;
  const b = k;
  const numerator =
    M *
    (a >= 0 ? 2n ** BigInt(a) : 1n) *
    (b >= 0 ? 5n ** BigInt(b) : 1n);
  const denominator =
    (a < 0 ? 2n ** BigInt(-a) : 1n) * (b < 0 ? 5n ** BigInt(-b) : 1n);
  if (denominator === 1n) return numerator;
  let q = numerator / denominator;
  const r = numerator % denominator;
  const twiceR = r * 2n;
  if (twiceR > denominator || (twiceR === denominator && q % 2n === 1n)) {
    q += 1n;
  }
  return q;
}

function significantDigits(
  absX: number,
  M: bigint,
  E: number,
  P: number
): { digits: string; X: number } {
  let X = Math.floor(Math.log10(absX));
  for (let guard = 0; guard < 20; guard++) {
    const val = scaledRound(M, E, P - 1 - X);
    const s = val.toString();
    if (s.length === P) return { digits: s, X };
    if (s.length > P) {
      X += s.length - P;
    } else {
      X -= P - s.length;
    }
  }
  const val = scaledRound(M, E, P - 1 - X);
  return { digits: val.toString(), X };
}

function padNumeric(
  sign: string,
  prefix: string,
  digits: string,
  width: number,
  flags: string,
  zeroAllowed: boolean
): string {
  const body = sign + prefix + digits;
  if (body.length >= width) return body;
  const pad = width - body.length;
  if (flags.includes('-')) return body + ' '.repeat(pad);
  if (flags.includes('0') && zeroAllowed) {
    return sign + prefix + '0'.repeat(pad) + digits;
  }
  return ' '.repeat(pad) + body;
}

function signOf(flags: string, negative: boolean): string {
  if (negative) return '-';
  if (flags.includes('+')) return '+';
  if (flags.includes(' ')) return ' ';
  return '';
}

function formatInt(
  arg: number | bigint,
  flags: string,
  width: number,
  precisionGiven: boolean,
  precision: number
): string {
  let negative: boolean;
  let mag: bigint;
  if (typeof arg === 'bigint') {
    negative = arg < 0n;
    mag = negative ? -arg : arg;
  } else {
    negative = arg < 0;
    mag = BigInt(Math.abs(arg));
  }
  let digits: string;
  if (precisionGiven) {
    digits = precision === 0 && mag === 0n ? '' : mag.toString().padStart(precision, '0');
  } else {
    digits = mag.toString();
  }
  const sign = signOf(flags, negative);
  return padNumeric(sign, '', digits, width, flags, !precisionGiven);
}

function formatHexOct(
  arg: number | bigint,
  conv: 'x' | 'X' | 'o',
  flags: string,
  width: number,
  precisionGiven: boolean,
  precision: number
): string {
  const mag = typeof arg === 'bigint' ? arg : BigInt(arg);
  const base = conv === 'o' ? 8 : 16;
  let digits: string;
  if (precisionGiven) {
    digits = precision === 0 && mag === 0n ? '' : mag.toString(base).padStart(precision, '0');
  } else {
    digits = mag.toString(base);
  }
  if (conv === 'X') digits = digits.toUpperCase();
  let prefix = '';
  if (flags.includes('#')) {
    if (conv === 'o') {
      if (digits === '' || digits[0] !== '0') digits = '0' + digits;
    } else if (mag !== 0n) {
      prefix = conv === 'X' ? '0X' : '0x';
    }
  }
  return padNumeric('', prefix, digits, width, flags, !precisionGiven);
}

function buildExpBody(
  digits: string,
  X: number,
  prec: number,
  hasHash: boolean,
  upper: boolean
): string {
  const dot = prec === 0 ? (hasHash ? '.' : '') : '.';
  const mantissa = digits[0] + dot + digits.slice(1);
  const expSign = X >= 0 ? '+' : '-';
  const expDigits = String(Math.abs(X)).padStart(2, '0');
  return mantissa + (upper ? 'E' : 'e') + expSign + expDigits;
}

function formatFloat(
  arg: number,
  conv: string,
  flags: string,
  width: number,
  precisionGiven: boolean,
  precision: number
): string {
  const negative = arg < 0 || Object.is(arg, -0);
  const upper = conv === 'F' || conv === 'E' || conv === 'G';
  const hasHash = flags.includes('#');

  if (Number.isNaN(arg)) {
    const text = upper ? 'NAN' : 'nan';
    return padNumeric('', '', text, width, flags, false);
  }
  if (!Number.isFinite(arg)) {
    const sign = signOf(flags, negative);
    const text = upper ? 'INF' : 'inf';
    return padNumeric(sign, '', text, width, flags, false);
  }

  const sign = signOf(flags, negative);
  const abs = Math.abs(arg);

  if (conv === 'f' || conv === 'F') {
    const prec = precisionGiven ? precision : 6;
    let intPart: string;
    let fracPart: string;
    if (abs === 0) {
      intPart = '0';
      fracPart = '0'.repeat(prec);
    } else {
      const { M, E } = decompose(abs);
      const whole = scaledRound(M, E, prec);
      let s = whole.toString();
      if (s.length <= prec) s = s.padStart(prec + 1, '0');
      intPart = prec === 0 ? s : s.slice(0, s.length - prec);
      fracPart = prec === 0 ? '' : s.slice(s.length - prec);
    }
    const dot = prec === 0 ? (hasHash ? '.' : '') : '.';
    const body = intPart + dot + fracPart;
    return padNumeric(sign, '', body, width, flags, true);
  }

  if (conv === 'e' || conv === 'E') {
    const prec = precisionGiven ? precision : 6;
    let digits: string;
    let X: number;
    if (abs === 0) {
      digits = '0'.repeat(prec + 1);
      X = 0;
    } else {
      const { M, E } = decompose(abs);
      ({ digits, X } = significantDigits(abs, M, E, prec + 1));
    }
    const body = buildExpBody(digits, X, prec, hasHash, conv === 'E');
    return padNumeric(sign, '', body, width, flags, true);
  }

  // g, G
  let P = precisionGiven ? precision : 6;
  if (P === 0) P = 1;
  let digits: string;
  let X: number;
  if (abs === 0) {
    digits = '0'.repeat(P);
    X = 0;
  } else {
    const { M, E } = decompose(abs);
    ({ digits, X } = significantDigits(abs, M, E, P));
  }
  const useFixed = P > X && X >= -4;
  let intPart: string;
  let fracPart: string;
  let effPrec: number;
  let body: string;
  if (useFixed) {
    if (X >= 0) {
      intPart = digits.slice(0, X + 1);
      fracPart = digits.slice(X + 1);
    } else {
      intPart = '0';
      fracPart = '0'.repeat(-X - 1) + digits;
    }
    effPrec = P - 1 - X;
    let dot = effPrec === 0 ? (hasHash ? '.' : '') : '.';
    if (!hasHash) {
      fracPart = fracPart.replace(/0+$/, '');
      if (fracPart === '') dot = '';
    }
    body = intPart + dot + fracPart;
  } else {
    intPart = digits[0];
    fracPart = digits.slice(1);
    effPrec = P - 1;
    let dot = effPrec === 0 ? (hasHash ? '.' : '') : '.';
    if (!hasHash) {
      fracPart = fracPart.replace(/0+$/, '');
      if (fracPart === '') dot = '';
    }
    const mantissa = intPart + dot + fracPart;
    const expSign = X >= 0 ? '+' : '-';
    const expDigits = String(Math.abs(X)).padStart(2, '0');
    body = mantissa + (conv === 'G' ? 'E' : 'e') + expSign + expDigits;
  }
  return padNumeric(sign, '', body, width, flags, true);
}

function formatString(
  arg: string,
  flags: string,
  width: number,
  precisionGiven: boolean,
  precision: number
): string {
  let text = precisionGiven ? arg.slice(0, precision) : arg;
  if (text.length >= width) return text;
  const pad = ' '.repeat(width - text.length);
  return flags.includes('-') ? text + pad : pad + text;
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let argIndex = 0;
  const re = /%%|%([-+ 0#]*)(\d*)(?:\.(\d*))?([diouxXeEfFgGsc])/g;
  return fmt.replace(re, (match, flagsG, widthG, precG, convG) => {
    if (match === '%%') return '%';
    const flags: string = flagsG;
    const width = widthG ? parseInt(widthG, 10) : 0;
    const precisionGiven = precG !== undefined;
    const precision = precisionGiven ? (precG === '' ? 0 : parseInt(precG, 10)) : 0;
    const conv: string = convG;
    const arg = args[argIndex++];

    if (conv === 'd' || conv === 'i') {
      return formatInt(arg as number | bigint, flags, width, precisionGiven, precision);
    }
    if (conv === 'x' || conv === 'X' || conv === 'o') {
      return formatHexOct(arg as number | bigint, conv, flags, width, precisionGiven, precision);
    }
    if (
      conv === 'e' ||
      conv === 'E' ||
      conv === 'f' ||
      conv === 'F' ||
      conv === 'g' ||
      conv === 'G'
    ) {
      return formatFloat(arg as number, conv, flags, width, precisionGiven, precision);
    }
    if (conv === 's') {
      return formatString(arg as string, flags, width, precisionGiven, precision);
    }
    if (conv === 'c') {
      return formatString(arg as string, flags, width, false, 0);
    }
    return match;
  });
}
