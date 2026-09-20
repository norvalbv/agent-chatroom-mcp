type Flags = {
  minus: boolean;
  plus: boolean;
  space: boolean;
  zero: boolean;
  hash: boolean;
};

function decompose(x: number): { N: bigint; decExp: number } {
  const buf = new ArrayBuffer(8);
  const dv = new DataView(buf);
  dv.setFloat64(0, x);
  const hi = BigInt(dv.getUint32(0));
  const lo = BigInt(dv.getUint32(4));
  const bits = (hi << 32n) | lo;
  const exponentBits = Number((bits >> 52n) & 0x7ffn);
  const mantissaBits = bits & 0xfffffffffffffn;
  let M: bigint;
  let E: number;
  if (exponentBits === 0) {
    M = mantissaBits;
    E = -1074;
  } else {
    M = mantissaBits | (1n << 52n);
    E = exponentBits - 1075;
  }
  if (E >= 0) {
    return { N: M << BigInt(E), decExp: 0 };
  }
  return { N: M * 5n ** BigInt(-E), decExp: E };
}

function roundHalfEven(num: bigint, den: bigint): bigint {
  const q = num / den;
  const r = num % den;
  const twice = r * 2n;
  if (twice < den) return q;
  if (twice > den) return q + 1n;
  return q % 2n === 0n ? q : q + 1n;
}

function getFixedDigits(
  N: bigint,
  decExp: number,
  p: number
): { intPart: string; frac: string } {
  const shift = decExp + p;
  let scaled: bigint;
  if (shift >= 0) {
    scaled = N * 10n ** BigInt(shift);
  } else {
    scaled = roundHalfEven(N, 10n ** BigInt(-shift));
  }
  let s = scaled.toString();
  if (s.length <= p) {
    s = '0'.repeat(p - s.length + 1) + s;
  }
  const intPart = s.slice(0, s.length - p) || '0';
  const frac = p > 0 ? s.slice(s.length - p) : '';
  return { intPart, frac };
}

function getSciDigits(
  N: bigint,
  decExp: number,
  p: number
): { digit0: string; rest: string; exp: number } {
  const L = N.toString().length;
  const diff = L - 1 - p;
  let expGuess = L - 1 + decExp;
  let sig: bigint;
  if (diff <= 0) {
    sig = N * 10n ** BigInt(-diff);
  } else {
    sig = roundHalfEven(N, 10n ** BigInt(diff));
  }
  let sigStr = sig.toString();
  if (sigStr.length > p + 1) {
    expGuess += sigStr.length - (p + 1);
    sigStr = sigStr.slice(0, p + 1);
  } else if (sigStr.length < p + 1) {
    sigStr = sigStr.padStart(p + 1, '0');
  }
  return { digit0: sigStr[0], rest: sigStr.slice(1), exp: expGuess };
}

function padNumber(
  sign: string,
  prefix: string,
  digits: string,
  width: number,
  flags: Flags,
  zeroAllowed: boolean
): string {
  const content = sign + prefix + digits;
  const padLen = width - content.length;
  if (padLen <= 0) return content;
  if (flags.minus) return content + ' '.repeat(padLen);
  if (flags.zero && zeroAllowed) return sign + prefix + '0'.repeat(padLen) + digits;
  return ' '.repeat(padLen) + content;
}

function padText(text: string, width: number, flags: Flags): string {
  const padLen = width - text.length;
  if (padLen <= 0) return text;
  if (flags.minus) return text + ' '.repeat(padLen);
  return ' '.repeat(padLen) + text;
}

function numSign(neg: boolean, flags: Flags): string {
  if (neg) return '-';
  if (flags.plus) return '+';
  if (flags.space) return ' ';
  return '';
}

function formatIntLike(
  conv: string,
  flags: Flags,
  width: number,
  precision: number | null,
  arg: number | bigint
): string {
  const big = typeof arg === 'bigint' ? arg : BigInt(arg);

  if (conv === 'd' || conv === 'i') {
    const neg = big < 0n;
    const abs = neg ? -big : big;
    let digits: string;
    if (abs === 0n && precision === 0) {
      digits = '';
    } else {
      digits = abs.toString();
      if (precision !== null && digits.length < precision) {
        digits = '0'.repeat(precision - digits.length) + digits;
      }
    }
    const sign = numSign(neg, flags);
    const zeroAllowed = precision === null;
    return padNumber(sign, '', digits, width, flags, zeroAllowed);
  }

  // x, X, o : non-negative
  const radix = conv === 'o' ? 8 : 16;
  let digits = big.toString(radix);
  if (conv === 'X') digits = digits.toUpperCase();
  if (big === 0n && precision === 0) {
    digits = '';
  } else if (precision !== null && digits.length < precision) {
    digits = '0'.repeat(precision - digits.length) + digits;
  }

  let prefix = '';
  if (flags.hash) {
    if (conv === 'o') {
      if (digits.length === 0 || digits[0] !== '0') {
        digits = '0' + digits;
      }
    } else if (big !== 0n) {
      prefix = conv === 'X' ? '0X' : '0x';
    }
  }

  const zeroAllowed = precision === null;
  return padNumber('', prefix, digits, width, flags, zeroAllowed);
}

function formatFloatLike(
  conv: string,
  flags: Flags,
  width: number,
  precision: number | null,
  value: number
): string {
  const isUpper = conv === 'E' || conv === 'F' || conv === 'G';

  if (Number.isNaN(value)) {
    const text = isUpper ? 'NAN' : 'nan';
    return padNumber('', '', text, width, flags, false);
  }

  const neg = value < 0 || Object.is(value, -0);

  if (!Number.isFinite(value)) {
    const text = isUpper ? 'INF' : 'inf';
    const sign = numSign(neg, flags);
    return padNumber(sign, '', text, width, flags, false);
  }

  const sign = numSign(neg, flags);
  const absValue = Math.abs(value);

  if (conv === 'e' || conv === 'E') {
    const p = precision === null ? 6 : precision;
    let digit0: string, rest: string, exp: number;
    if (absValue === 0) {
      digit0 = '0';
      rest = '0'.repeat(p);
      exp = 0;
    } else {
      const { N, decExp } = decompose(absValue);
      const sci = getSciDigits(N, decExp, p);
      digit0 = sci.digit0;
      rest = sci.rest;
      exp = sci.exp;
    }
    const fracStr = p > 0 ? '.' + rest : flags.hash ? '.' : '';
    const expSign = exp < 0 ? '-' : '+';
    let expAbsStr = Math.abs(exp).toString();
    if (expAbsStr.length < 2) expAbsStr = '0' + expAbsStr;
    const letter = conv === 'E' ? 'E' : 'e';
    const digits = digit0 + fracStr + letter + expSign + expAbsStr;
    return padNumber(sign, '', digits, width, flags, true);
  }

  if (conv === 'f' || conv === 'F') {
    const p = precision === null ? 6 : precision;
    let intPart: string, frac: string;
    if (absValue === 0) {
      intPart = '0';
      frac = '0'.repeat(p);
    } else {
      const { N, decExp } = decompose(absValue);
      ({ intPart, frac } = getFixedDigits(N, decExp, p));
    }
    const fracStr = p > 0 ? '.' + frac : flags.hash ? '.' : '';
    const digits = intPart + fracStr;
    return padNumber(sign, '', digits, width, flags, true);
  }

  // g, G
  const P = precision === null ? 6 : precision === 0 ? 1 : precision;
  let sig: string;
  let X: number;
  if (absValue === 0) {
    sig = '0'.repeat(P);
    X = 0;
  } else {
    const { N, decExp } = decompose(absValue);
    const sci = getSciDigits(N, decExp, P - 1);
    sig = sci.digit0 + sci.rest;
    X = sci.exp;
  }

  let digits: string;
  const letter = conv === 'G' ? 'E' : 'e';
  if (P > X && X >= -4) {
    let intPart: string, fracPart: string;
    if (X >= 0) {
      intPart = sig.slice(0, X + 1);
      fracPart = sig.slice(X + 1);
    } else {
      intPart = '0';
      fracPart = '0'.repeat(-X - 1) + sig;
    }
    if (!flags.hash) {
      fracPart = fracPart.replace(/0+$/, '');
    }
    const fracStr = fracPart.length > 0 || flags.hash ? '.' + fracPart : '';
    digits = intPart + fracStr;
  } else {
    const digit0 = sig[0];
    let rest = sig.slice(1);
    if (!flags.hash) {
      rest = rest.replace(/0+$/, '');
    }
    const fracStr = rest.length > 0 || flags.hash ? '.' + rest : '';
    const expSign = X < 0 ? '-' : '+';
    let expAbsStr = Math.abs(X).toString();
    if (expAbsStr.length < 2) expAbsStr = '0' + expAbsStr;
    digits = digit0 + fracStr + letter + expSign + expAbsStr;
  }

  return padNumber(sign, '', digits, width, flags, true);
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let result = '';
  let argIndex = 0;
  let i = 0;
  const n = fmt.length;

  while (i < n) {
    const c = fmt[i];
    if (c !== '%') {
      result += c;
      i++;
      continue;
    }
    i++;
    if (fmt[i] === '%') {
      result += '%';
      i++;
      continue;
    }

    const flags: Flags = { minus: false, plus: false, space: false, zero: false, hash: false };
    while (i < n) {
      const ch = fmt[i];
      if (ch === '-') flags.minus = true;
      else if (ch === '+') flags.plus = true;
      else if (ch === ' ') flags.space = true;
      else if (ch === '0') flags.zero = true;
      else if (ch === '#') flags.hash = true;
      else break;
      i++;
    }

    let widthStr = '';
    while (i < n && fmt[i] >= '0' && fmt[i] <= '9') {
      widthStr += fmt[i];
      i++;
    }
    const width = widthStr ? parseInt(widthStr, 10) : 0;

    let precision: number | null = null;
    if (fmt[i] === '.') {
      i++;
      let precStr = '';
      while (i < n && fmt[i] >= '0' && fmt[i] <= '9') {
        precStr += fmt[i];
        i++;
      }
      precision = precStr ? parseInt(precStr, 10) : 0;
    }

    const conv = fmt[i];
    i++;
    const arg = args[argIndex++];

    switch (conv) {
      case 'd':
      case 'i':
      case 'x':
      case 'X':
      case 'o':
        result += formatIntLike(conv, flags, width, precision, arg as number | bigint);
        break;
      case 'e':
      case 'E':
      case 'f':
      case 'F':
      case 'g':
      case 'G':
        result += formatFloatLike(conv, flags, width, precision, arg as number);
        break;
      case 's': {
        let str = arg as string;
        if (precision !== null) str = str.slice(0, precision);
        result += padText(str, width, flags);
        break;
      }
      case 'c': {
        const str = arg as string;
        result += padText(str, width, flags);
        break;
      }
      default:
        break;
    }
  }

  return result;
}
