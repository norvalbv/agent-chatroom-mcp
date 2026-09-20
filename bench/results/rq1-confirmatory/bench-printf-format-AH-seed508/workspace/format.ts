type Flags = {
  minus: boolean;
  plus: boolean;
  space: boolean;
  zero: boolean;
  hash: boolean;
};

function pad(sign: string, prefix: string, digits: string, width: number, minus: boolean, zero: boolean): string {
  const bodyLen = sign.length + prefix.length + digits.length;
  if (bodyLen >= width) return sign + prefix + digits;
  const padLen = width - bodyLen;
  if (minus) return sign + prefix + digits + ' '.repeat(padLen);
  if (zero) return sign + prefix + '0'.repeat(padLen) + digits;
  return ' '.repeat(padLen) + sign + prefix + digits;
}

function padSimple(s: string, width: number, minus: boolean): string {
  if (s.length >= width) return s;
  const padLen = width - s.length;
  return minus ? s + ' '.repeat(padLen) : ' '.repeat(padLen) + s;
}

function decompose(x: number): { neg: boolean; mantissa: bigint; exp: number } {
  const buf = new ArrayBuffer(8);
  const dv = new DataView(buf);
  dv.setFloat64(0, x);
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const neg = (hi >>> 31) === 1;
  const expBits = (hi >>> 20) & 0x7ff;
  const fracHi = hi & 0xfffff;
  const fracBig = (BigInt(fracHi) << 32n) | BigInt(lo);
  let mantissa: bigint;
  let exp: number;
  if (expBits === 0) {
    mantissa = fracBig;
    exp = -1074;
  } else {
    mantissa = fracBig | (1n << 52n);
    exp = expBits - 1075;
  }
  return { neg, mantissa, exp };
}

// Returns round(mantissa * 2^exp * 10^shift), ties to even.
function roundExact(mantissa: bigint, exp: number, shift: number): bigint {
  if (mantissa === 0n) return 0n;
  let numerator = mantissa;
  let denominator = 1n;
  const netPow2 = exp + shift;
  if (netPow2 >= 0) numerator <<= BigInt(netPow2);
  else denominator <<= BigInt(-netPow2);
  if (shift >= 0) numerator *= 5n ** BigInt(shift);
  else denominator *= 5n ** BigInt(-shift);
  const q = numerator / denominator;
  const r = numerator % denominator;
  const twiceR = r * 2n;
  if (twiceR < denominator) return q;
  if (twiceR > denominator) return q + 1n;
  return q % 2n === 0n ? q : q + 1n;
}

function fixedDigits(mantissa: bigint, exp: number, P: number): { intPart: string; fracPart: string } {
  const N = roundExact(mantissa, exp, P);
  const digitsStr = N.toString().padStart(P + 1, '0');
  if (P === 0) return { intPart: digitsStr, fracPart: '' };
  return { intPart: digitsStr.slice(0, digitsStr.length - P), fracPart: digitsStr.slice(digitsStr.length - P) };
}

function expDigits(mantissa: bigint, exp: number, x: number, P: number): { first: string; rest: string; X: number } {
  const S = P + 1;
  if (mantissa === 0n) {
    return { first: '0', rest: '0'.repeat(P), X: 0 };
  }
  let X = Math.floor(Math.log10(Math.abs(x)));
  if (!Number.isFinite(X)) X = 0;
  for (let attempt = 0; attempt < 40; attempt++) {
    const shift = S - 1 - X;
    const N = roundExact(mantissa, exp, shift);
    const digitsStr = N.toString();
    if (digitsStr.length > S) {
      X += 1;
      continue;
    }
    if (digitsStr.length < S) {
      X -= 1;
      continue;
    }
    return { first: digitsStr[0], rest: digitsStr.slice(1), X };
  }
  const shift = S - 1 - X;
  const digitsStr = roundExact(mantissa, exp, shift).toString().padStart(S, '0');
  return { first: digitsStr[0], rest: digitsStr.slice(1), X };
}

function assembleWithDot(head: string, frac: string, hash: boolean): string {
  if (hash) return head + '.' + frac;
  const trimmed = frac.replace(/0+$/, '');
  return trimmed.length > 0 ? head + '.' + trimmed : head;
}

function fixedBody(mantissa: bigint, exp: number, P: number, hash: boolean): string {
  const { intPart, fracPart } = fixedDigits(mantissa, exp, P);
  return P > 0 || hash ? intPart + '.' + fracPart : intPart;
}

function expBody(mantissa: bigint, exp: number, x: number, P: number, hash: boolean, upper: boolean): string {
  const { first, rest, X } = expDigits(mantissa, exp, x, P);
  const head = P > 0 || hash ? first + '.' + rest : first;
  const eChar = upper ? 'E' : 'e';
  const expSign = X >= 0 ? '+' : '-';
  const expAbs = Math.abs(X).toString().padStart(2, '0');
  return head + eChar + expSign + expAbs;
}

function gBody(mantissa: bigint, exp: number, x: number, precision: number | null, hash: boolean, upper: boolean): string {
  const P = precision === null ? 6 : precision === 0 ? 1 : precision;
  const { first, rest, X } = expDigits(mantissa, exp, x, P - 1);
  if (P > X && X >= -4) {
    const fPrecision = P - 1 - X;
    const { intPart, fracPart } = fixedDigits(mantissa, exp, fPrecision);
    return assembleWithDot(intPart, fracPart, hash);
  }
  const eChar = upper ? 'E' : 'e';
  const expSign = X >= 0 ? '+' : '-';
  const expAbs = Math.abs(X).toString().padStart(2, '0');
  return assembleWithDot(first, rest, hash) + eChar + expSign + expAbs;
}

function signFor(neg: boolean, flags: Flags): string {
  if (neg) return '-';
  if (flags.plus) return '+';
  if (flags.space) return ' ';
  return '';
}

function formatInt(flags: Flags, width: number, precision: number | null, arg: number | bigint): string {
  const value = typeof arg === 'bigint' ? arg : BigInt(arg);
  const neg = value < 0n;
  const abs = neg ? -value : value;
  let digits: string;
  if (precision === 0 && abs === 0n) {
    digits = '';
  } else {
    digits = abs.toString();
    if (precision !== null && digits.length < precision) digits = digits.padStart(precision, '0');
  }
  const sign = signFor(neg, flags);
  const zero = flags.zero && precision === null;
  return pad(sign, '', digits, width, flags.minus, zero);
}

function formatHexOct(conv: 'x' | 'X' | 'o', flags: Flags, width: number, precision: number | null, arg: number | bigint): string {
  const value = typeof arg === 'bigint' ? arg : BigInt(arg);
  const base = conv === 'o' ? 8 : 16;
  let digits = value.toString(base);
  if (conv === 'X') digits = digits.toUpperCase();
  if (precision === 0 && value === 0n) {
    digits = '';
  } else if (precision !== null && digits.length < precision) {
    digits = digits.padStart(precision, '0');
  }
  let prefix = '';
  if (flags.hash) {
    if (conv === 'o') {
      if (digits.length === 0 || digits[0] !== '0') digits = '0' + digits;
    } else if (value !== 0n) {
      prefix = conv === 'x' ? '0x' : '0X';
    }
  }
  const zero = flags.zero && precision === null;
  return pad('', prefix, digits, width, flags.minus, zero);
}

function formatFloat(conv: string, flags: Flags, width: number, precision: number | null, x: number): string {
  const upper = conv === conv.toUpperCase();
  if (Number.isNaN(x)) {
    const text = upper ? 'NAN' : 'nan';
    return pad('', '', text, width, flags.minus, false);
  }
  const { neg, mantissa, exp } = decompose(x);
  if (!Number.isFinite(x)) {
    const sign = signFor(neg, flags);
    const text = upper ? 'INF' : 'inf';
    return pad(sign, '', text, width, flags.minus, false);
  }
  const sign = signFor(neg, flags);
  const lower = conv.toLowerCase();
  let body: string;
  if (lower === 'f') {
    const P = precision === null ? 6 : precision;
    body = fixedBody(mantissa, exp, P, flags.hash);
  } else if (lower === 'e') {
    const P = precision === null ? 6 : precision;
    body = expBody(mantissa, exp, x, P, flags.hash, upper);
  } else {
    body = gBody(mantissa, exp, x, precision, flags.hash, upper);
  }
  return pad(sign, '', body, width, flags.minus, flags.zero);
}

function formatStr(flags: Flags, width: number, precision: number | null, arg: string): string {
  const s = precision !== null ? arg.slice(0, precision) : arg;
  return padSimple(s, width, flags.minus);
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let out = '';
  let argIndex = 0;
  let i = 0;
  const n = fmt.length;
  while (i < n) {
    const ch = fmt[i];
    if (ch !== '%') {
      out += ch;
      i++;
      continue;
    }
    i++;
    if (fmt[i] === '%') {
      out += '%';
      i++;
      continue;
    }
    const flags: Flags = { minus: false, plus: false, space: false, zero: false, hash: false };
    while (true) {
      const c = fmt[i];
      if (c === '-') flags.minus = true;
      else if (c === '+') flags.plus = true;
      else if (c === ' ') flags.space = true;
      else if (c === '0') flags.zero = true;
      else if (c === '#') flags.hash = true;
      else break;
      i++;
    }
    let widthStr = '';
    while (fmt[i] >= '0' && fmt[i] <= '9') {
      widthStr += fmt[i];
      i++;
    }
    const width = widthStr ? parseInt(widthStr, 10) : 0;
    let precision: number | null = null;
    if (fmt[i] === '.') {
      i++;
      let precStr = '';
      while (fmt[i] >= '0' && fmt[i] <= '9') {
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
        out += formatInt(flags, width, precision, arg as number | bigint);
        break;
      case 'x':
      case 'X':
      case 'o':
        out += formatHexOct(conv, flags, width, precision, arg as number | bigint);
        break;
      case 'e':
      case 'E':
      case 'f':
      case 'F':
      case 'g':
      case 'G':
        out += formatFloat(conv, flags, width, precision, arg as number);
        break;
      case 's':
        out += formatStr(flags, width, precision, arg as string);
        break;
      case 'c':
        out += padSimple(arg as string, width, flags.minus);
        break;
      default:
        throw new Error(`unsupported conversion: %${conv}`);
    }
  }
  return out;
}
