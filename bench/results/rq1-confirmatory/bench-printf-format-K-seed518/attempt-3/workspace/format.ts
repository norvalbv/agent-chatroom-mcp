type Flags = {
  minus: boolean;
  plus: boolean;
  space: boolean;
  zero: boolean;
  hash: boolean;
};

function decompose(absX: number): { mantissa: bigint; exp: number } {
  const buf = new ArrayBuffer(8);
  const dv = new DataView(buf);
  dv.setFloat64(0, absX);
  const bits = dv.getBigUint64(0);
  const expBits = (bits >> 52n) & 0x7ffn;
  const mantBits = bits & 0xfffffffffffffn;
  if (expBits === 0n) {
    return { mantissa: mantBits, exp: -1074 };
  }
  return { mantissa: mantBits | (1n << 52n), exp: Number(expBits) - 1075 };
}

function roundQuotient(num: bigint, den: bigint): bigint {
  if (den === 1n) return num;
  const q = num / den;
  const r = num % den;
  const twice = r * 2n;
  if (twice < den) return q;
  if (twice > den) return q + 1n;
  return q % 2n === 0n ? q : q + 1n;
}

// round(|x| * 10^fracDigits) as an exact BigInt, ties to even, using the exact
// binary value of x (mantissa * 2^exp).
function scaleValue(mantissa: bigint, exp: number, fracDigits: number): bigint {
  if (mantissa === 0n) return 0n;
  const e2 = exp + fracDigits;
  const e5 = fracDigits;
  let numerator = mantissa;
  let denominator = 1n;
  if (e2 >= 0) numerator *= 2n ** BigInt(e2);
  else denominator *= 2n ** BigInt(-e2);
  if (e5 >= 0) numerator *= 5n ** BigInt(e5);
  else denominator *= 5n ** BigInt(-e5);
  return roundQuotient(numerator, denominator);
}

// Compute the f-style digits: integer part and P-digit fractional part for
// round(|x|, fracDigits).
function fDigitsOf(
  mantissa: bigint,
  exp: number,
  fracDigits: number
): { intPart: string; fracPart: string } {
  const digits = scaleValue(mantissa, exp, fracDigits).toString().padStart(fracDigits + 1, '0');
  if (fracDigits === 0) return { intPart: digits, fracPart: '' };
  return {
    intPart: digits.slice(0, digits.length - fracDigits),
    fracPart: digits.slice(digits.length - fracDigits),
  };
}

// Compute the e-style significant digits: P+1 digits total and decimal exponent X,
// such that |x| ~= 0.digits[0] . digits[1:] * 10^X.
function eDigitsOf(
  absX: number,
  mantissa: bigint,
  exp: number,
  P: number
): { digits: string; X: number } {
  if (mantissa === 0n) {
    return { digits: '0'.repeat(P + 1), X: 0 };
  }
  let X = Math.floor(Math.log10(absX));
  let digitsStr = scaleValue(mantissa, exp, P - X).toString();
  let guard = 0;
  while (digitsStr.length !== P + 1 && guard < 1100) {
    if (digitsStr.length > P + 1) X += 1;
    else X -= 1;
    digitsStr = scaleValue(mantissa, exp, P - X).toString();
    guard++;
  }
  return { digits: digitsStr, X };
}

// Plain e/f style: dot is omitted only when there are no fractional digits
// (i.e. precision 0) and the # flag is absent. No trimming of zeros.
function plainFrac(frac: string, hash: boolean): string {
  if (frac.length === 0) return hash ? '.' : '';
  return '.' + frac;
}

// g style: trailing zeros of the fractional part are removed unless # is present.
function fracToDot(frac: string, hash: boolean): string {
  if (hash) return '.' + frac;
  const trimmed = frac.replace(/0+$/, '');
  return trimmed.length > 0 ? '.' + trimmed : '';
}

function signOf(negative: boolean, flags: Flags): string {
  if (negative) return '-';
  if (flags.plus) return '+';
  if (flags.space) return ' ';
  return '';
}

function padNumeric(sign: string, prefix: string, digits: string, width: number, flags: Flags): string {
  const bodyLen = sign.length + prefix.length + digits.length;
  if (bodyLen >= width) return sign + prefix + digits;
  const padLen = width - bodyLen;
  if (flags.minus) return sign + prefix + digits + ' '.repeat(padLen);
  if (flags.zero) return sign + prefix + '0'.repeat(padLen) + digits;
  return ' '.repeat(padLen) + sign + prefix + digits;
}

function padText(text: string, width: number, minus: boolean): string {
  if (text.length >= width) return text;
  const padLen = width - text.length;
  return minus ? text + ' '.repeat(padLen) : ' '.repeat(padLen) + text;
}

function toBigIntArg(arg: number | bigint | string): bigint {
  return typeof arg === 'bigint' ? arg : BigInt(arg as number);
}

function formatIntDigits(magnitude: bigint, precision: number | null, base = 10): string {
  if (precision === 0 && magnitude === 0n) return '';
  const digits = magnitude.toString(base);
  if (precision === null) return digits;
  return digits.padStart(precision, '0');
}

function formatDI(arg: number | bigint, flags: Flags, width: number, precision: number | null): string {
  const big = toBigIntArg(arg);
  const negative = big < 0n;
  const magnitude = negative ? -big : big;
  const digits = formatIntDigits(magnitude, precision);
  const sign = signOf(negative, flags);
  const effFlags: Flags = { ...flags, zero: flags.zero && precision === null };
  return padNumeric(sign, '', digits, width, effFlags);
}

function formatXO(
  arg: number | bigint,
  conv: 'x' | 'X' | 'o',
  flags: Flags,
  width: number,
  precision: number | null
): string {
  const magnitude = toBigIntArg(arg);
  const base = conv === 'o' ? 8 : 16;
  let digits = formatIntDigits(magnitude, precision, base);
  if (conv === 'X') digits = digits.toUpperCase();
  let prefix = '';
  if (flags.hash) {
    if (conv === 'x' && magnitude !== 0n) prefix = '0x';
    else if (conv === 'X' && magnitude !== 0n) prefix = '0X';
    else if (conv === 'o') {
      if (digits.length === 0 || digits[0] !== '0') digits = '0' + digits;
    }
  }
  const effFlags: Flags = { ...flags, zero: flags.zero && precision === null };
  return padNumeric('', prefix, digits, width, effFlags);
}

function formatFloat(
  arg: number,
  conv: 'e' | 'E' | 'f' | 'F' | 'g' | 'G',
  flags: Flags,
  width: number,
  precision: number | null
): string {
  const negative = arg < 0 || Object.is(arg, -0);
  const absX = Math.abs(arg);

  if (Number.isNaN(arg)) {
    const text = conv === conv.toUpperCase() ? 'NAN' : 'nan';
    return padNumeric('', '', text, width, { ...flags, zero: false });
  }
  if (!Number.isFinite(arg)) {
    const text = conv === conv.toUpperCase() ? 'INF' : 'inf';
    const sign = signOf(negative, flags);
    return padNumeric(sign, '', text, width, { ...flags, zero: false });
  }

  const { mantissa, exp } = decompose(absX);
  const sign = signOf(negative, flags);

  if (conv === 'f' || conv === 'F') {
    const P = precision === null ? 6 : precision;
    const { intPart, fracPart } = fDigitsOf(mantissa, exp, P);
    const digits = intPart + plainFrac(fracPart, flags.hash);
    return padNumeric(sign, '', digits, width, flags);
  }

  if (conv === 'e' || conv === 'E') {
    const P = precision === null ? 6 : precision;
    const { digits: sig, X } = eDigitsOf(absX, mantissa, exp, P);
    const first = sig[0];
    const rest = sig.slice(1);
    const expLetter = conv === 'E' ? 'E' : 'e';
    const expSign = X < 0 ? '-' : '+';
    const expDigits = Math.abs(X).toString().padStart(2, '0');
    const digits = first + plainFrac(rest, flags.hash) + expLetter + expSign + expDigits;
    return padNumeric(sign, '', digits, width, flags);
  }

  // g, G
  let P = precision === null ? 6 : precision;
  if (P === 0) P = 1;
  const { digits: sig, X } = eDigitsOf(absX, mantissa, exp, P - 1);
  let digits: string;
  if (P > X && X >= -4) {
    const fracDigits = P - 1 - X;
    const { intPart, fracPart } = fDigitsOf(mantissa, exp, fracDigits);
    digits = intPart + fracToDot(fracPart, flags.hash);
  } else {
    const first = sig[0];
    const rest = sig.slice(1);
    const expLetter = conv === 'G' ? 'E' : 'e';
    const expSign = X < 0 ? '-' : '+';
    const expDigits = Math.abs(X).toString().padStart(2, '0');
    digits = first + fracToDot(rest, flags.hash) + expLetter + expSign + expDigits;
  }
  return padNumeric(sign, '', digits, width, flags);
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  const specRe = /%([-+0 #]*)(\d*)(?:\.(\d*))?([diouxXeEfFgGsc%])/g;
  let result = '';
  let lastIndex = 0;
  let argIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = specRe.exec(fmt)) !== null) {
    result += fmt.slice(lastIndex, match.index);
    lastIndex = specRe.lastIndex;

    const [, flagStr, widthStr, precStr, conv] = match;

    if (conv === '%') {
      result += '%';
      continue;
    }

    const flags: Flags = {
      minus: flagStr.includes('-'),
      plus: flagStr.includes('+'),
      space: flagStr.includes(' '),
      zero: flagStr.includes('0'),
      hash: flagStr.includes('#'),
    };
    const width = widthStr ? parseInt(widthStr, 10) : 0;
    const precision = precStr !== undefined ? (precStr === '' ? 0 : parseInt(precStr, 10)) : null;

    const arg = args[argIndex++];

    switch (conv) {
      case 'd':
      case 'i':
        result += formatDI(arg as number | bigint, flags, width, precision);
        break;
      case 'x':
      case 'X':
      case 'o':
        result += formatXO(arg as number | bigint, conv, flags, width, precision);
        break;
      case 'e':
      case 'E':
      case 'f':
      case 'F':
      case 'g':
      case 'G':
        result += formatFloat(arg as number, conv, flags, width, precision);
        break;
      case 's': {
        let text = arg as string;
        if (precision !== null) text = text.slice(0, precision);
        result += padText(text, width, flags.minus);
        break;
      }
      case 'c': {
        const text = arg as string;
        result += padText(text, width, flags.minus);
        break;
      }
    }
  }

  result += fmt.slice(lastIndex);
  return result;
}
