type Flags = {
  minus: boolean;
  plus: boolean;
  space: boolean;
  zero: boolean;
  hash: boolean;
};

function decompose(value: number): { M: bigint; E: number } {
  const buf = new ArrayBuffer(8);
  const dv = new DataView(buf);
  dv.setFloat64(0, value);
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const exponentBits = (hi >>> 20) & 0x7ff;
  const mantissaHi = hi & 0xfffff;
  const mantissaBits = (BigInt(mantissaHi) << 32n) | BigInt(lo);
  if (exponentBits === 0) {
    return { M: mantissaBits, E: -1074 };
  }
  return { M: mantissaBits | (1n << 52n), E: exponentBits - 1075 };
}

// Returns round-half-to-even of M * 2^E * 10^k as a non-negative BigInt.
function scaleValue(M: bigint, E: number, k: number): bigint {
  const pow2 = E + k;
  let num = M;
  let den = 1n;
  if (k >= 0) {
    num *= 5n ** BigInt(k);
  } else {
    den = 5n ** BigInt(-k);
  }
  if (pow2 >= 0) {
    num <<= BigInt(pow2);
  } else {
    den <<= BigInt(-pow2);
  }
  let q = num / den;
  const r = num % den;
  const twiceR = r * 2n;
  if (twiceR > den) {
    q += 1n;
  } else if (twiceR === den) {
    if (q % 2n === 1n) q += 1n;
  }
  return q;
}

function toFixedDigits(M: bigint, E: number, p: number): { intPart: string; fracPart: string } {
  const scaled = scaleValue(M, E, p);
  let s = scaled.toString();
  if (p === 0) {
    return { intPart: s, fracPart: '' };
  }
  if (s.length <= p) {
    s = s.padStart(p + 1, '0');
  }
  return { intPart: s.slice(0, s.length - p), fracPart: s.slice(s.length - p) };
}

// Returns `precision + 1` significant digits and the decimal exponent of the
// leading digit, for a positive finite value M * 2^E.
function toExpDigits(M: bigint, E: number, precision: number): { digits: string; exp: number } {
  let X = Math.floor(Math.log10(Number(M)) + E * Math.log10(2));
  const target = precision + 1;
  for (let i = 0; i < 30; i++) {
    const k = precision - X;
    const scaled = scaleValue(M, E, k);
    const s = scaled.toString();
    if (s.length === target) {
      return { digits: s, exp: X };
    } else if (s.length === target + 1) {
      return { digits: s.slice(0, target), exp: X + 1 };
    } else if (s.length > target) {
      X += s.length - target;
    } else {
      X -= target - s.length;
    }
  }
  throw new Error('failed to converge');
}

function pad(body: string, width: number, leftAlign: boolean): string {
  if (body.length >= width) return body;
  const fill = ' '.repeat(width - body.length);
  return leftAlign ? body + fill : fill + body;
}

function padNumeric(prefix: string, rest: string, width: number, useZero: boolean, leftAlign: boolean): string {
  const total = prefix.length + rest.length;
  if (total >= width) return prefix + rest;
  const fillLen = width - total;
  if (leftAlign) return prefix + rest + ' '.repeat(fillLen);
  if (useZero) return prefix + '0'.repeat(fillLen) + rest;
  return ' '.repeat(fillLen) + prefix + rest;
}

function signFor(neg: boolean, flags: Flags): string {
  if (neg) return '-';
  if (flags.plus) return '+';
  if (flags.space) return ' ';
  return '';
}

function formatIntLike(value: number | bigint, flags: Flags, width: number, precision: number | undefined): string {
  const neg = value < 0;
  const abs = neg ? -BigInt(value) : BigInt(value);
  let digits: string;
  if (precision !== undefined) {
    if (precision === 0 && abs === 0n) {
      digits = '';
    } else {
      digits = abs.toString().padStart(precision, '0');
    }
  } else {
    digits = abs.toString();
  }
  const sign = signFor(neg, flags);
  const useZero = flags.zero && !flags.minus && precision === undefined;
  return padNumeric(sign, digits, width, useZero, flags.minus);
}

function formatBaseLike(
  value: number | bigint,
  conv: 'x' | 'X' | 'o',
  flags: Flags,
  width: number,
  precision: number | undefined
): string {
  const abs = BigInt(value);
  let digits = conv === 'o' ? abs.toString(8) : abs.toString(16);
  if (conv === 'X') digits = digits.toUpperCase();
  if (precision !== undefined) {
    if (precision === 0 && abs === 0n) {
      digits = '';
    } else {
      digits = digits.padStart(precision, '0');
    }
  }
  let prefix = '';
  if (flags.hash) {
    if (conv === 'o') {
      if (digits.length === 0 || digits[0] !== '0') digits = '0' + digits;
    } else if (abs !== 0n) {
      prefix = conv === 'X' ? '0X' : '0x';
    }
  }
  const useZero = flags.zero && !flags.minus && precision === undefined;
  return padNumeric(prefix, digits, width, useZero, flags.minus);
}

function formatFloatLike(
  value: number,
  conv: 'e' | 'E' | 'f' | 'F' | 'g' | 'G',
  flags: Flags,
  width: number,
  precision: number | undefined
): string {
  const upper = conv === 'E' || conv === 'F' || conv === 'G';

  if (Number.isNaN(value)) {
    const body = upper ? 'NAN' : 'nan';
    return pad(body, width, flags.minus);
  }

  const negSignBit = value < 0 || Object.is(value, -0);

  if (!Number.isFinite(value)) {
    const sign = signFor(negSignBit, flags);
    const body = upper ? 'INF' : 'inf';
    return pad(sign + body, width, flags.minus);
  }

  const sign = signFor(negSignBit, flags);
  const abs = Math.abs(value);
  const { M, E } = abs === 0 ? { M: 0n, E: 0 } : decompose(abs);
  const useZero = flags.zero && !flags.minus;

  if (conv === 'f' || conv === 'F') {
    const p = precision === undefined ? 6 : precision;
    const { intPart, fracPart } = toFixedDigits(M, E, p);
    const point = p > 0 || flags.hash ? '.' + fracPart : '';
    return padNumeric(sign, intPart + point, width, useZero, flags.minus);
  }

  if (conv === 'e' || conv === 'E') {
    const p = precision === undefined ? 6 : precision;
    let digits: string;
    let exp: number;
    if (abs === 0) {
      digits = '0'.repeat(p + 1);
      exp = 0;
    } else {
      const r = toExpDigits(M, E, p);
      digits = r.digits;
      exp = r.exp;
    }
    const first = digits[0];
    const frac = digits.slice(1);
    const point = p > 0 || flags.hash ? '.' + frac : '';
    const expSign = exp >= 0 ? '+' : '-';
    const expDigits = Math.abs(exp).toString().padStart(2, '0');
    const eLetter = upper ? 'E' : 'e';
    const body = first + point + eLetter + expSign + expDigits;
    return padNumeric(sign, body, width, useZero, flags.minus);
  }

  // g, G
  const P = precision === undefined ? 6 : precision === 0 ? 1 : precision;
  let digits: string;
  let X: number;
  if (abs === 0) {
    digits = '0'.repeat(P);
    X = 0;
  } else {
    const r = toExpDigits(M, E, P - 1);
    digits = r.digits;
    X = r.exp;
  }

  const useF = P > X && X >= -4;
  let body: string;
  if (useF) {
    let intPart: string;
    let fracPart: string;
    if (X >= 0) {
      intPart = digits.slice(0, X + 1);
      fracPart = digits.slice(X + 1);
    } else {
      intPart = '0';
      fracPart = '0'.repeat(-X - 1) + digits;
    }
    if (!flags.hash) {
      fracPart = fracPart.replace(/0+$/, '');
    }
    const point = fracPart.length > 0 || flags.hash ? '.' + fracPart : '';
    body = intPart + point;
  } else {
    const first = digits[0];
    let frac = digits.slice(1);
    if (!flags.hash) {
      frac = frac.replace(/0+$/, '');
    }
    const point = frac.length > 0 || flags.hash ? '.' + frac : '';
    const expSign = X >= 0 ? '+' : '-';
    const expDigits = Math.abs(X).toString().padStart(2, '0');
    const eLetter = upper ? 'E' : 'e';
    body = first + point + eLetter + expSign + expDigits;
  }
  return padNumeric(sign, body, width, useZero, flags.minus);
}

export function format(fmt: string, ...args: (number | bigint | string)[]): string {
  let out = '';
  let argIndex = 0;
  const re = /%([-+0# ]*)(\d*)(?:\.(\d*))?([diouxXeEfFgGsc%])/g;
  let lastEnd = 0;
  let match: RegExpExecArray | null;

  while ((match = re.exec(fmt)) !== null) {
    out += fmt.slice(lastEnd, match.index);
    lastEnd = re.lastIndex;

    const [, flagStr, widthStr, precStr, conv] = match;

    if (conv === '%') {
      out += '%';
      continue;
    }

    const flags: Flags = {
      minus: flagStr.includes('-'),
      plus: flagStr.includes('+'),
      space: flagStr.includes(' '),
      zero: flagStr.includes('0'),
      hash: flagStr.includes('#'),
    };
    const width = widthStr === '' ? 0 : parseInt(widthStr, 10);
    const precision = precStr === undefined ? undefined : precStr === '' ? 0 : parseInt(precStr, 10);

    const arg = args[argIndex++];

    switch (conv) {
      case 'd':
      case 'i':
        out += formatIntLike(arg as number | bigint, flags, width, precision);
        break;
      case 'x':
      case 'X':
      case 'o':
        out += formatBaseLike(arg as number | bigint, conv, flags, width, precision);
        break;
      case 'e':
      case 'E':
      case 'f':
      case 'F':
      case 'g':
      case 'G':
        out += formatFloatLike(arg as number, conv, flags, width, precision);
        break;
      case 's': {
        let s = arg as string;
        if (precision !== undefined) s = s.slice(0, precision);
        out += pad(s, width, flags.minus);
        break;
      }
      case 'c': {
        const s = arg as string;
        out += pad(s, width, flags.minus);
        break;
      }
    }
  }
  out += fmt.slice(lastEnd);
  return out;
}
